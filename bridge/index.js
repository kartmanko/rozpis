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
 *   PAIR_NUMBER – nepovinné: číslo eSIM v tvare 421901234567 (bez + a bez medzier).
 *                 Keď je vyplnené, čítačka si namiesto QR kódu vypýta osemznakový
 *                 párovací kód, ktorý sa v telefóne iba prepíše. Hodí sa, keď je
 *                 eSIM v tom istom telefóne, ktorým by sa QR skenoval.
 */

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { rm } from "node:fs/promises";

const API_BASE = (process.env.API_BASE || "").replace(/\/$/, "");
const HOOK_SECRET = process.env.HOOK_SECRET || "";
const BRIDGE_ID = process.env.BRIDGE_ID || "bridge";
const AUTH_DIR = process.env.AUTH_DIR || "./auth";
/* Číslo eSIM pre párovanie kódom. Necháme z neho iba číslice — ľudia to píšu
   raz s plusom, raz s medzerami a WhatsApp by to inak odmietol. */
const PAIR_NUMBER = (process.env.PAIR_NUMBER || "").replace(/\D/g, "");
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

/* Nedokončené prihlásenie sa musí zahodiť. Keď párovanie zlyhá v polovici,
   ostanú na disku kľúče z pokusu, ktorý WhatsApp neschválil — a s nimi zlyhá aj
   ďalší pokus, hoci by inak prešiel. Zahadzujeme iba nedokončené: hotové
   prihlásenie má registered = true a toho sa nedotkneme nikdy. */
async function pripravAuth() {
  let { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  if (PAIR_NUMBER && !state.creds?.registered) {
    await rm(AUTH_DIR, { recursive: true, force: true });
    ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
    log.info("nedokončené prihlásenie som zahodil, párujem odznova");
  }
  return { state, saveCreds };
}

async function spusti() {
  log.info({ bridgeId: BRIDGE_ID, api: API_BASE, authDir: AUTH_DIR }, "čítačka sa spúšťa");
  const { state, saveCreds } = await pripravAuth();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: log.child({ modul: "baileys" }),
    // NEHLÁS SA ako online — nech to na telefóne nevyzerá, že je používateľ pri appke
    markOnlineOnConnect: false,
    // ani potvrdenia o prečítaní neposielame
    syncFullHistory: false,
    /* Ako sa čítačka predstaví. Pri párovaní kódom to NIE JE kozmetika: WhatsApp
       vydá párovací kód, ale prepojenie potom odmietne ("Nepodarilo sa prepojiť
       zariadenie"), keď sa klient hlási vlastným vymysleným názvom. Pri kóde teda
       ideme na overenú kombináciu Ubuntu/Chrome; v telefóne sa to potom v zozname
       prepojených zariadení volá "Ubuntu". Pri QR na názve nezáleží, tam si
       necháme svoj. */
    browser: PAIR_NUMBER ? Browsers.ubuntu("Chrome") : ["FARMA 18 rozpis", "Chrome", VERZIA],
  });

  sock.ev.on("creds.update", saveCreds);

  /* Párovanie kódom namiesto QR. Keď eSIM sedí v tom istom telefóne, ktorým by sa
     QR skenoval, nie je čím skenovať — tak si vypýtame osemznakový kód a ten sa
     v telefóne iba prepíše (WhatsApp → Prepojené zariadenia → Prepojiť zariadenie
     → Prepojiť pomocou telefónneho čísla). Pýtame ho iba raz, pri prvom prihlásení;
     keď už je prihlásenie na disku, tento blok sa preskočí. Krátke počkanie je
     naschvál — Baileys musí najprv nadviazať spojenie, inak kód nevydá. */
  let parovanie = null;
  const stopParovanie = () => { if (parovanie) { clearInterval(parovanie); parovanie = null; } };

  async function vypytajKod() {
    if (sock.authState?.creds?.registered) return stopParovanie();
    try {
      const kod = await sock.requestPairingCode(PAIR_NUMBER);
      const pekne = String(kod).match(/.{1,4}/g).join("-");
      console.log("\n=== PÁROVACÍ KÓD: " + pekne + " ===");
      console.log("Prepíš ho v telefóne: WhatsApp → Nastavenia → Prepojené zariadenia");
      console.log("→ Prepojiť zariadenie → Prepojiť pomocou telefónneho čísla.");
      console.log("Platí necelé tri minúty. Keď vyprší, o chvíľu sa tu objaví nový —");
      console.log("nič nereštartuj, iba počkaj a prepíš ten posledný.\n");
    } catch (e) {
      log.error({ e: e.message }, "párovací kód sa nepodarilo vypýtať — použi QR nižšie");
    }
  }

  if (PAIR_NUMBER && !sock.authState?.creds?.registered) {
    setTimeout(() => {
      vypytajKod();
      /* Kód od WhatsAppu vydrží asi tri minúty. Keď ho človek nestihne prepísať,
         nemá zmysel nechať ho v logoch svietiť ako platný — radšej si pýtame nový,
         kým sa prihlásenie nedokončí. Prestaneme hneď, ako je registered. */
      parovanie = setInterval(vypytajKod, 150_000);
    }, 4000);
  }

  // pri opätovnom pripájaní musí starý časovač zaniknúť, inak by sa hromadili
  let casovac = null;
  const stopCasovac = () => { if (casovac) { clearInterval(casovac); casovac = null; } };

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    /* QR kreslíme len vtedy, keď sa nepáruje kódom — inak by v logoch skákali
       dve rôzne inštrukcie naraz a človek by nevedel, čoho sa držať. */
    if (qr && !PAIR_NUMBER) {
      console.log("\n=== Naskenuj tento QR kód vo WhatsApp → Prepojené zariadenia ===\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      poslednePripojenie = Date.now();
      stopParovanie();
      log.info("pripojené k WhatsAppu");
      ohlasSa(sock, "beží");
      // raz za minútu: "žijem" + aktuálny zoznam skupín + čerstvý zoznam zapnutých chatov
      stopCasovac();
      casovac = setInterval(() => ohlasSa(sock, "beží"), 60_000);
    }

    if (connection === "close") {
      stopCasovac();
      stopParovanie();
      const kod = lastDisconnect?.error?.output?.statusCode;
      const odhlasene = kod === DisconnectReason.loggedOut;
      log.warn(
        { kod },
        odhlasene
          ? PAIR_NUMBER
            ? "odhlásené — treba znova prepojiť párovacím kódom"
            : "odhlásené — treba znova naskenovať QR"
          : "spojenie spadlo, skúšam znova",
      );
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
          // kedy bola správa naozaj odoslaná — pri denných reportoch (Fáza 4) je to
          // záložný dátum dňa, keď sa dátum nedá vyčítať priamo z textu
          ts: Number(msg.messageTimestamp) || 0,
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
