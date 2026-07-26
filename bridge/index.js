/* FARMA 18 — čítačka WhatsAppu (bridge, Fáza 3)
 *
 * Čo to robí: je prihlásená do WhatsAppu tým istým číslom ako eSIM v telefóne
 * (WhatsApp dovolí až 4 prepojené zariadenia), počúva správy v skupinách, ktoré
 * admin v appke zapol, a posiela ich text serveru na spracovanie.
 *
 * Čo to NEROBÍ a robiť nesmie:
 *   - nikdy nič nepošle do WhatsAppu (v celom súbore nie je jediné sendMessage),
 *   - nikdy nič nezapíše do rozpisu — to robí server a iba po potvrdení adminom,
 *   - nečíta skupiny, ktoré nie sú zapnuté; ich text ani neopustí tento stroj.
 *
 * Môžu bežať dve naraz (napr. Fly.io + naska) na tom istom čísle. Server pozná
 * ID správy, takže tú istú správu spracuje iba raz. Preto keď jedna vypadne,
 * nič sa nestratí.
 *
 * Premenné prostredia:
 *   API_BASE    – napr. https://api.kartmanko.cc
 *   HOOK_SECRET – to isté tajomstvo, aké má Worker (Cloudflare secret)
 *   BRIDGE_ID   – "fly" alebo "nas"; iba na rozlíšenie v appke
 *   AUTH_DIR    – priečinok na trvalom disku, kde sa drží prihlásenie
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const API_BASE = (process.env.API_BASE || "").replace(/\/$/, "");
const HOOK_SECRET = process.env.HOOK_SECRET || "";
const BRIDGE_ID = process.env.BRIDGE_ID || "bridge";
const AUTH_DIR = process.env.AUTH_DIR || "./auth";
const VERZIA = "1.0.0";

if (!API_BASE || !HOOK_SECRET) {
  console.error("Chýba API_BASE alebo HOOK_SECRET. Bez nich sa nedá nič posielať.");
  process.exit(1);
}

const log = pino({ level: process.env.LOG_LEVEL || "info" });

/* Ktoré chaty sú zapnuté. Server to povie v odpovedi na ohlásenie sa (ping).
   Kým sa neozve, je zoznam prázdny a bridge nepošle nikam nič — to je zámer:
   radšej nech sa správa stratí, než aby sa čítalo niečo nezapnuté. */
let povoleneChaty = new Set();

/* Názvy skupín (id -> názov). Držíme ich, aby sa v appke pri správe ukázalo,
   z ktorej skupiny prišla. Obnovujú sa pri každom ohlásení sa. */
const nazvyChatov = new Map();

async function serverPost(cesta, telo) {
  const res = await fetch(API_BASE + cesta, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hook-Secret": HOOK_SECRET },
    body: JSON.stringify(telo),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* server vrátil niečo, čo nie je JSON */ }
  if (!res.ok) throw new Error(`server ${res.status}: ${text.slice(0, 200)}`);
  return data || {};
}

/** Z WhatsApp správy vytiahne obyčajný text. Čo nie je text, ignorujeme. */
function textSpravy(msg) {
  const m = msg?.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    ""
  );
}

/** Telefónne číslo odosielateľa bez @s.whatsapp.net a bez prípadného :zariadenia. */
function cisloOdosielatela(msg) {
  const jid = msg?.key?.participant || msg?.key?.remoteJid || "";
  const holy = String(jid).split("@")[0].split(":")[0];
  return holy ? "+" + holy : "";
}

/** Zoznam skupín, ktoré toto zariadenie vidí — server si z neho spraví ponuku pre admina. */
async function zoznamSkupin(sock) {
  try {
    const skupiny = await sock.groupFetchAllParticipating();
    const out = Object.values(skupiny || {})
      .map((g) => ({ id: g.id, nazov: g.subject || "" }))
      .slice(0, 200);
    out.forEach((s) => nazvyChatov.set(s.id, s.nazov));
    return out;
  } catch (e) {
    log.warn({ e: e.message }, "nepodarilo sa načítať zoznam skupín");
    return [];
  }
}

async function ohlasSa(sock, stav) {
  try {
    const odpoved = await serverPost("/bridge/ping", {
      bridgeId: BRIDGE_ID,
      stav,
      verzia: VERZIA,
      cislo: sock?.user?.id ? "+" + String(sock.user.id).split("@")[0].split(":")[0] : "",
      skupiny: stav === "beží" ? await zoznamSkupin(sock) : [],
    });
    if (Array.isArray(odpoved.povoleneChaty)) {
      povoleneChaty = new Set(odpoved.povoleneChaty);
      log.info({ pocet: povoleneChaty.size }, "zapnuté chaty");
    }
  } catch (e) {
    log.warn({ e: e.message }, "ohlásenie sa serveru zlyhalo");
  }
}

/* ---------- strážca ----------
   Keby sa spojenie na WhatsApp rozpadlo tak nešikovne, že by proces nemal čo robiť,
   node by sa jednoducho ukončil — a to potichu, s nulou, takže by to vyzeralo ako
   normálne skončenie a nikto by si nevšimol, že čítačka nebeží. Strážca to nedovolí:
   drží proces pri živote a keď spojenie nedrží dlhšie ako 10 minút, ukončí sa
   s chybou, aby ho Fly.io (alebo docker restart: unless-stopped) naštartoval znova. */
const MRTVY_PO_MS = 10 * 60 * 1000;
let poslednePripojenie = Date.now();

setInterval(() => {
  const ticho = Date.now() - poslednePripojenie;
  if (ticho > MRTVY_PO_MS) {
    log.error({ minut: Math.round(ticho / 60000) }, "čítačka sa dlho nepripojila — reštartujem sa");
    process.exit(1);
  }
}, 30_000);

process.on("unhandledRejection", (e) => log.error({ e: String(e) }, "neošetrená chyba"));
process.on("uncaughtException", (e) => {
  log.error({ e: String(e) }, "pád — reštartujem sa");
  process.exit(1);
});

async function spusti() {
  log.info({ bridgeId: BRIDGE_ID, api: API_BASE, authDir: AUTH_DIR }, "čítačka sa spúšťa");
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: log.child({ modul: "baileys" }),
    // NEHLÁS SA ako online — nech to na telefóne nevyzerá, že je používateľ pri appke
    markOnlineOnConnect: false,
    // ani potvrdenia o prečítaní neposielame
    syncFullHistory: false,
    browser: ["FARMA 18 rozpis", "Chrome", VERZIA],
  });

  sock.ev.on("creds.update", saveCreds);

  // pri opätovnom pripájaní musí starý časovač zaniknúť, inak by sa hromadili
  let casovac = null;
  const stopCasovac = () => { if (casovac) { clearInterval(casovac); casovac = null; } };

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      console.log("\n=== Naskenuj tento QR kód vo WhatsApp → Prepojené zariadenia ===\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      poslednePripojenie = Date.now();
      log.info("pripojené k WhatsAppu");
      ohlasSa(sock, "beží");
      // raz za minútu: "žijem" + aktuálny zoznam skupín + čerstvý zoznam zapnutých chatov
      stopCasovac();
      casovac = setInterval(() => ohlasSa(sock, "beží"), 60_000);
    }

    if (connection === "close") {
      stopCasovac();
      const kod = lastDisconnect?.error?.output?.statusCode;
      const odhlasene = kod === DisconnectReason.loggedOut;
      log.warn({ kod }, odhlasene ? "odhlásené — treba znova naskenovať QR" : "spojenie spadlo, skúšam znova");
      if (!odhlasene) setTimeout(() => spusti().catch((e) => log.error(e)), 5000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // "notify" = nová správa. Ostatné typy sú dosynchrovanie histórie — tie preskoč.
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (msg.key?.fromMe) continue; // vlastné správy nečítame
        const chatId = msg.key?.remoteJid || "";
        if (!chatId || chatId === "status@broadcast") continue;

        // Z nezapnutého chatu neodíde zo stroja ani písmeno.
        if (!povoleneChaty.has(chatId)) continue;

        const text = textSpravy(msg);
        if (!text.trim()) continue;

        const odpoved = await serverPost("/hook", {
          bridgeId: BRIDGE_ID,
          msgId: msg.key?.id || "",
          chatId,
          chatName: nazvyChatov.get(chatId) || "",
          phone: cisloOdosielatela(msg),
          sender: msg.pushName || "",
          text,
        });
        log.info({ chatId, odpoved }, "správa odoslaná serveru");
      } catch (e) {
        log.error({ e: e.message }, "správu sa nepodarilo spracovať");
      }
    }
  });
}

spusti().catch((e) => {
  log.error(e, "bridge sa nepodarilo spustiť");
  process.exit(1);
});
