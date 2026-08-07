/**
 * Cloudflare Worker pre appku "rozpis štábu" (FARMA 18).
 *
 * Endpointy:
 *   POST /auth/request -> pošle prihlasovací odkaz na e-mail (magic link)
 *   POST /auth/verify  -> overí odkaz a nastaví session cookie (90 dní)
 *   GET  /auth/me      -> kto je prihlásený a čo smie
 *   POST /auth/logout  -> odhlásenie
 *   GET  /auth/users   -> zoznam používateľov a história prihlásení (iba admin)
 *   POST /auth/users   -> uloží zoznam používateľov (iba admin)
 *
 *   GET  /data    -> { crew, cells, nad, log, pendingHook, version }   (vyžaduje prihlásenie)
 *   POST /data    -> uloží nový stav (optimistic concurrency cez baseVersion);
 *                    práva sa kontrolujú porovnaním starého a nového stavu podľa roly
 *   POST /parse   -> preposlá screenshot na Anthropic Vision API (vedúci a admin)
 *   GET  /version -> { version } — aktuálna verzia DÁT na serveri (nesúvisí s verziou frontendu;
 *                     tú appka rieši sama cez public/version.json + BUILD_ID, viď README).
 *   GET  /push/key        -> verejný kľúč servera pre upozornenia (Fáza 6)
 *   POST /push/subscribe  -> zapamätá si telefón, ktorý chce upozornenia
 *   POST /push/unsubscribe-> zabudne ho
 *   POST /push/test       -> pošle skúšobné upozornenie na vlastné zariadenia
 *   POST /push/oznam      -> rozošle upozornenie štábu (iba vedúci a admin)
 *
 *   POST /hook    -> príjem správ z WhatsApp Business bridge (WAHA/Baileys), vyžaduje X-Hook-Secret.
 *                    Tento endpoint je IBA na čítanie správ z chatu — nikdy nič neposiela naspäť
 *                    do WhatsApp skupiny (žiadne volanie na send API bridge-u odtiaľto).
 *
 * Potrebné bindingy/secrety (pozri wrangler.toml a README.md):
 *   KV:      ROZPIS_KV
 *   secrety: ADMIN_PASSWORD, ANTHROPIC_API_KEY, HOOK_SECRET
 *   voliteľné env premenné: ALLOWED_ORIGIN, WHATSAPP_GROUP_ID, DEFAULT_HOOK_MONTH
 */

import {
  getSessionUser,
  roleCaps,
  checkStateChange,
  handleAuthRequest,
  handleAuthVerify,
  handleAuthMe,
  handleAuthLogout,
  handleGetUsers,
  handlePostUsers,
  readUsers,
  rovnakeTajomstvo,
  logJeIbaDoplneny,
  LOG_MAX,
} from "./auth.js";
import { vapidKluce, ulozOdber, zmazOdber, posliVsetkym } from "./push.js";
import { sKesou, kesovane, prepisKes } from "./kes.js";

const STATE_KEY = "state_v1";

// "sadzby"  = denné sadzby profesií (Fáza 2). Prázdne = appka použije predvolené.
// "chaty"   = sledované WhatsApp chaty (Fáza 3), kľúč = ID chatu. Nový chat sa sem
//             zapíše ako nepovolený a jeho správy sa NEČÍTAJÚ, kým ho admin nezapne.
//             Pole "druh" hovorí, čo sa so správami robí: "dostupnost" (predvolené,
//             hľadá sa v nich, kto kedy nemôže) alebo "report" (Fáza 4 — denné reporty
//             od réžie; text sa neanalyzuje, hľadá sa v ňom iba dátum).
// "reporty"  = denné reporty (Fáza 4), kľúč = id reportu. Jedna správa = jeden report.
// "dispo"    = POTVRDENÉ dispozície (Fáza 5), kľúč = deň "YYYY-MM-DD". Toto je to,
//              čo appka ukazuje v detaile dňa. Sem sa nič nedostane samo — vždy až
//              potom, čo to niekto v paneli „Dispo“ potvrdí.
// "pendingDispo" = NÁVRHY z dispo mailov, ktoré ešte nikto nepotvrdil. Server sem
//              iba odloží, čo v maile prečítal; rozpis sa nemení, kým to človek
//              neodklikne. To je celá podstata Fázy 5: appka navrhne, admin potvrdí.
const EMPTY_STATE = { crew: [], cells: {}, nad: {}, sadzby: {}, chaty: {}, reporty: {}, dispo: {}, pendingDispo: [], log: [], pendingHook: [], version: 0 };

// Reportov môže byť za celú sezónu veľa, ale nie neobmedzene — strop je poistka,
// aby jeden pokazený bridge nezaplnil KV.
const MAX_REPORTOV = 1000;

// Nepotvrdených dispo mailov by sa nemalo nahromadiť veľa. Keď ich je toľko,
// niečo je zle a nemá zmysel držať ďalšie.
const MAX_PENDING_DISPO = 60;

// Smeny dňa. Musia sedieť s DAY_SHIFTS v src/constants.js — server podľa toho
// zahadzuje smeny, ktoré neexistujú.
const DAY_SHIFTS = ["A", "B", "C", "R"];

/* ---------- WhatsApp bridge (Fáza 3) ----------
   Bridge je čítačka WhatsAppu, ktorá beží mimo Cloudflare (Fly.io, prípadne aj naska
   ako záloha). Môžu bežať dva naraz na tom istom čísle — WhatsApp dovolí viac
   pripojených zariadení. Preto server musí vedieť, že tú istú správu dostane dvakrát:
     - "hookmsg:<id>" v KV je pečiatka "toto som už spracoval" (drží 14 dní),
     - a navyše je celé spracovanie napísané tak, aby ani dvojité vykonanie neuškodilo
       (zapnúť "nemôže" dvakrát je to isté ako raz; do fronty sa tá istá správa
       nepridá druhýkrát, lebo sa porovnáva msgId).
   Tá druhá poistka je tam schválne: KV je len "časom konzistentné", takže keď obidva
   bridge doručia správu v tej istej sekunde, pečiatku ešte nemusia vidieť. */
const HOOKMSG_TTL = 14 * 24 * 60 * 60;
const BRIDGE_TTL = 30 * 60; // po 30 minútach ticha bridge zmizne zo zoznamu živých
const BRIDGE_KEY = (id) => "bridge:" + String(id || "").slice(0, 40);

/* Ako často sa smie zapísať čítačka, na ktorej sa NIČ nezmenilo.

   Toto bol najväčší žrút KV v celej appke. Ohlásenie „žijem, nič nové" sa
   zapisovalo bezpodmienečne: dve čítačky každú minútu = 2880 zápisov denne pri
   dennom strope 1000. A kým čítačka nebola prepojená, ohlasovala sa každých
   20 sekúnd, čo je ďalších 8640 zápisov denne. Presne na tomto KV vrátilo 429
   a appka prestala ukladať.

   Teraz sa zapisuje len vtedy, keď sa údaj naozaj zmenil (nové QR, iný stav,
   iná chyba) — a keď sa nemení, nanajvýš raz za tento čas, aby kľúč nevypršal
   a čítačka neskočila do červena.

   Dôsledok: dve pokojne bežiace čítačky stoja ~288 zápisov denne namiesto
   2880. Čo to stojí: keď čítačka spadne, appka to ukáže do ~18 minút (viď
   ZIVY_LIMIT_MS v ChatyPanel.jsx), nie do piatich. Pri párovaní to nevadí —
   vtedy sa QR mení pri každom ohlásení, takže sa aj zapisuje a panel je živý.

   Musí to byť výrazne menej než BRIDGE_TTL, inak by kľúč medzitým vypršal. */
const BRIDGE_ZAPIS_NAJVIAC_MS = 10 * 60 * 1000;

async function bridgePing(env, bridgeId, info) {
  if (!bridgeId) return;
  const kluc = BRIDGE_KEY(bridgeId);

  // čítanie je proti zápisu lacné (strop 100 000 vs 1000 za deň), tak sa radšej
  // pozrieme, čo tam je, než by sme naslepo prepísali to isté
  let stary = null;
  try { stary = await env.ROZPIS_KV.get(kluc, "json"); } catch { stary = null; }
  if (stary && typeof stary === "object") {
    const kluce = Object.keys(info);
    const rovnake = kluce.every((k) => stary[k] === info[k]);
    const odvtedy = Date.now() - Date.parse(stary.poslednyKrat || "");
    if (rovnake && Number.isFinite(odvtedy) && odvtedy >= 0 && odvtedy < BRIDGE_ZAPIS_NAJVIAC_MS) return;
  }

  /* Keď sa zápis nepodarí (napríklad je minutý denný strop KV), čítačka kvôli
     tomu nesmie prestať čítať — v paneli sa bude tváriť ako mŕtva, ale zoznam
     zapnutých skupín jej aj tak vrátime a správy chodia ďalej. */
  try {
    await env.ROZPIS_KV.put(
      kluc,
      JSON.stringify({ id: bridgeId, ...info, poslednyKrat: new Date().toISOString() }),
      { expirationTtl: BRIDGE_TTL },
    );
  } catch (e) {
    console.log("ohlásenie čítačky sa nezapísalo:", e && e.message);
  }
}

async function readBridges(env) {
  const list = await env.ROZPIS_KV.list({ prefix: "bridge:" });
  const out = [];
  for (const k of list.keys) {
    // pod "bridge:token" nie je čítačka, ale kód pre čítačky — sem nepatrí
    if (k.name === BRIDGE_TOKEN_KEY) continue;
    const raw = await env.ROZPIS_KV.get(k.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* poškodený záznam preskoč */ }
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function corsHeaders(env) {
  // POZOR: keď appka posiela prihlasovaciu cookie (credentials: "include"),
  // prehliadač odmietne hviezdičku — ALLOWED_ORIGIN musí byť konkrétna adresa
  // appky (nastavuje sa vo wrangler.toml).
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-Hook-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

/* ---------- kód pre čítačku WhatsAppu ----------

   Čítačka sa serveru preukazuje hlavičkou X-Hook-Secret. Pôvodne to mohol byť
   iba Cloudflare secret HOOK_SECRET, lenže ten sa dá nastaviť jedine cez wrangler
   alebo cez dashboard — a keď ho človek raz nastaví, už si ho nikdy neprečíta.
   Preto si server vie kód vyrobiť aj sám a odložiť ho do KV; admin ho potom vidí
   priamo v appke a odtiaľ ho skopíruje do čítačky. Obidve cesty platia naraz,
   takže HOOK_SECRET, ak je nastavený, funguje ďalej. */
const BRIDGE_TOKEN_KEY = "bridge:token";

function novyKod() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/* Kód pre čítačku sa mení raz za uhorský rok, ale číta sa pri každom ohlásení.
   V rámci jednej požiadavky teda stačí raz. */
function precitajBridgeToken(env) {
  return kesovane(env, BRIDGE_TOKEN_KEY, () => env.ROZPIS_KV.get(BRIDGE_TOKEN_KEY));
}

async function bridgeToken(env, vyrobNovy = false) {
  if (!vyrobNovy) {
    const ulozeny = await precitajBridgeToken(env);
    if (ulozeny) return ulozeny;
  }
  const kod = novyKod();
  await env.ROZPIS_KV.put(BRIDGE_TOKEN_KEY, kod);
  prepisKes(env, BRIDGE_TOKEN_KEY, kod);
  return kod;
}

/* rovnakeTajomstvo (porovnanie v konštantnom čase) je v auth.js — používa ho
   aj kontrola núdzového admin hesla, tak nech je na jednom mieste. */

async function checkHookSecret(request, env) {
  const s = request.headers.get("X-Hook-Secret") || "";
  if (!s) return false;
  if (env.HOOK_SECRET && rovnakeTajomstvo(s, env.HOOK_SECRET)) return true;
  const ulozeny = await precitajBridgeToken(env);
  return !!ulozeny && rovnakeTajomstvo(s, ulozeny);
}

/* Rozpis sa v rámci jednej požiadavky načíta z KV najviac raz (viď kes.js).
   Kešuje sa surový text, nie hotový objekt — aby si dvaja volajúci nemohli
   nechtiac prepísať jeden druhému stav pod rukami. */
async function readState(env) {
  const raw = await kesovane(env, STATE_KEY, () => env.ROZPIS_KV.get(STATE_KEY));
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw);
    // doplň chýbajúce polia pre stav uložený ešte pred pridaním nad/pendingHook
    return { ...EMPTY_STATE, ...parsed };
  } catch (e) {
    /* Poškodené dáta v KV sa nedajú v tejto chvíli opraviť a appka musí niečo
       vrátiť — ale ticho sa tváriť, že rozpis je len prázdny, by bolo presne
       to "appka to ticho prepísala", čomu sa tento projekt vyhýba. Aspoň nech
       to je vidno v logu (wrangler tail / Cloudflare dashboard), nech to
       niekto zbadá skôr, než ďalší zápis prázdny stav natrvalo potvrdí. */
    console.log("state_v1 sa nedá rozobrať ako JSON, vraciam prázdny rozpis:", e && e.message, "dĺžka:", raw.length);
    return { ...EMPTY_STATE };
  }
}

async function writeState(env, state) {
  const text = JSON.stringify(state);
  await env.ROZPIS_KV.put(STATE_KEY, text);
  prepisKes(env, STATE_KEY, text); // čítanie nižšie v tej istej požiadavke už vidí nový stav
}

async function handleGetData(request, env) {
  // Rozpis vidí iba prihlásený človek (Fáza 1: prístup povinný pre všetkých).
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  const state = await readState(env);
  return json(state, 200, env);
}

async function handleGetVersion(env) {
  const state = await readState(env);
  return json({ version: state.version }, 200, env);
}

/* ---------- stropy na to, čo príde zvonku ----------

   Appka posiela celý rozpis naraz, takže telo požiadavky je jediné miesto,
   kadiaľ sa dá do KV nasypať čokoľvek. Cloudflare KV zoberie hodnotu najviac
   25 MB; keby sa raz taká uložila, rozpis by sa už nedal zapísať vôbec. Preto
   sú tu stropy — sú schválne oveľa nižšie, než čo znesie KV, aby bolo z čoho
   ubrať, a zároveň rádovo vyššie, než čo potrebuje najväčší štáb. */
const MAX_STAV_ZNAKOV = 2_000_000; // uložený rozpis, ~2 MB
const MAX_OBRAZOK_ZNAKOV = 6_000_000; // screenshot pre /parse (base64), ~4,5 MB obrázok
const MAX_CHATOV = 300; // koľko WhatsApp skupín si server pamätá
const MAX_POZNAMKA = 300; // dĺžka poznámky v bunke rozpisu

/* Bunka rozpisu smie mať iba tieto polia. Predtým sa ukladalo, čo prišlo —
   a keďže kontrola práv porovnáva iba tieto polia, ktokoľvek prihlásený mohol
   do „svojej" bunky prilepiť megabajt smetí a server si to uložil bez mihnutia.
   Pozor: keď do bunky pribudne nové pole, musí sa doplniť sem aj do normCell
   v auth.js — inak sa buď stratí, alebo prekĺzne bez kontroly práv. */
function ocistiBunky(cells) {
  const out = {};
  for (const [k, c] of Object.entries(cells)) {
    if (!c || typeof c !== "object") continue;
    const nadcas = Number(c.nadcas);
    out[String(k).slice(0, 120)] = {
      off: !!c.off,
      shift: DAY_SHIFTS.includes(c.shift) ? c.shift : null,
      duel: !!c.duel,
      note: String(c.note || "").slice(0, MAX_POZNAMKA),
      nadcas: Number.isFinite(nadcas) ? Math.min(24, Math.max(0, Math.round(nadcas * 10) / 10)) : 0,
    };
  }
  return out;
}

async function handlePostData(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const current = await readState(env);
  const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : -1;

  const next = {
    crew: Array.isArray(body.crew) ? body.crew : current.crew,
    cells: body.cells && typeof body.cells === "object" ? ocistiBunky(body.cells) : current.cells,
    nad: body.nad && typeof body.nad === "object" ? body.nad : current.nad,
    sadzby: body.sadzby && typeof body.sadzby === "object" ? body.sadzby : current.sadzby,
    chaty: body.chaty && typeof body.chaty === "object" ? body.chaty : current.chaty,
    reporty: body.reporty && typeof body.reporty === "object" ? body.reporty : current.reporty,
    dispo: body.dispo && typeof body.dispo === "object" ? body.dispo : current.dispo,
    pendingDispo: Array.isArray(body.pendingDispo) ? body.pendingDispo.slice(0, MAX_PENDING_DISPO) : current.pendingDispo,
    log: Array.isArray(body.log) ? body.log.slice(0, LOG_MAX) : current.log,
    pendingHook: Array.isArray(body.pendingHook) ? body.pendingHook.slice(0, 200) : current.pendingHook,
    version: current.version + 1,
  };

  /* Najprv verzia, až potom práva.
     Práva sa kontrolujú porovnaním starého a nového stavu — appka posiela celý
     rozpis naraz, takže sa nedá spoľahnúť na to, čo poslal prehliadač. Lenže keď
     prehliadač vychádza zo staršej verzie, to porovnanie klame: chýbajú mu cudzie
     bunky, ktoré medzitým niekto pridal, a vyzerá to, akoby ich chcel zmazať.
     Členovi štábu tak na obyčajné „nemôžem“ vyskočilo „Na túto časť rozpisu
     nemáš právo“, hoci sa cudzej bunky ani nedotkol. Keď je verzia stará, jediná
     pravdivá odpoveď je „conflict“ — hláška o právach ostáva pre toho, kto má
     aktuálne dáta a naozaj siaha, kam nemá. */
  if (baseVersion !== current.version) {
    // niekto iný medzitým uložil novšiu verziu
    return json({ error: "conflict", current }, 409, env);
  }

  const allowed = checkStateChange(user, current, next);
  if (!allowed.ok) return json({ error: allowed.error }, 403, env);

  /* História sa smie iba dopĺňať — nikdy prepisovať. Kontroluje sa až tu, keď
     už vieme, že klient vychádzal z aktuálnej verzie, takže "current.log" je
     presne to, čo si načítal. Platí to aj pre admina, viď auth.js. */
  if (!logJeIbaDoplneny(current.log, next.log)) {
    return json({ error: "Históriu sa nedá prepísať ani vymazať — dá sa do nej iba dopĺňať." }, 403, env);
  }

  /* Strop na veľkosť uloženého stavu. Bez neho stačí jedno uloženie s dlhým
     textom v mene alebo v poznámke a stav prestane byť zapísateľný — Cloudflare
     KV berie hodnotu najviac 25 MB a od tej chvíle by sa neuložilo už nič.
     Radšej odmietnuť jedno uloženie ako zabetónovať celý rozpis. */
  const velkost = JSON.stringify(next).length;
  if (velkost > MAX_STAV_ZNAKOV) {
    return json({ error: "Príliš veľká zmena — server ju neuložil. Skús to po častiach." }, 413, env);
  }

  await writeState(env, next);
  return json({ version: next.version }, 200, env);
}

const VISION_PROMPT_TEMPLATE = (monthNum, monthName) => `Čítaš screenshot zo skupinového WhatsApp chatu kameramanov. Ľudia píšu, ktoré dni NEMÔŽU pracovať, prípadne neskôr opravujú/menia dátumy, ktoré predtým nahlásili.
Vráť IBA JSON pole, bez markdownu a bez vysvetlenia:
[{"sender":"meno ako je v chate","phone":"telefón ak je vidieť, inak \\"\\"","text":"text správy","unavailable":["2026-08-15"],"correctedAvailable":["2026-08-16"],"noRestrictions":false,"isCorrection":false}]
Pravidlá:
- Rok je 2026. Ak správa neuvádza mesiac, použi mesiac ${monthNum} (${monthName}).
- Rozsahy rozbaľ na jednotlivé dni: "27-30.8." = 27.,28.,29.,30. august; "od 12 až do 21" = 12 až 21.
- Zoznam typu "6.7.8.9.11." sú jednotlivé dni.
- "unavailable" = dni, ktoré má správa nahlásiť ako NOVÉ nemôže (pridať).
- "correctedAvailable" = dni, ktoré správa spätne RUŠÍ/OPRAVUJE — teda predtým boli nahlásené ako nemôže, ale autor teraz píše, že predsa len MÔŽE / že to bol omyl / že sa mu dátum zmenil a pôvodný dátum už neplatí. Sem daj presne tie dátumy, ktoré sa majú znova sprístupniť (odznačiť "nemôže"). Ak správa iba pridáva nové "nemôže" dni bez rušenia starších, nechaj toto pole prázdne.
- Nastav isCorrection:true vždy, keď správa obsahuje slová/zmysel ako "oprava", "omyl", "zle som napísal", "predsa len môžem", "zmena", "opravujem sa", alebo keď correctedAvailable nie je prázdne.
- Ak píše, že je bez obmedzení alebo že zatiaľ môže (bez toho, že by to bola oprava predchádzajúcej správy), daj noRestrictions:true a unavailable prázdne.
- Ignoruj správy, ktoré neriešia dostupnosť (pozdravy, emoji, organizačné oznamy).
- Meno uveď presne tak, ako je v screenshote, aj keď je orezané.`;

const TEXT_PROMPT_TEMPLATE = (monthNum, monthName) => `Dostávaš JEDNU textovú správu zo skupinového WhatsApp chatu kameramanov/štábu (nie screenshot, čistý text). Autor píše, ktoré dni NEMÔŽE pracovať, prípadne opravuje/mení dátumy, ktoré predtým nahlásil.
Vráť IBA JSON objekt, bez markdownu a bez vysvetlenia, presne v tvare:
{"unavailable":["2026-08-15"],"correctedAvailable":["2026-08-16"],"noRestrictions":false,"isCorrection":false}
Pravidlá:
- Rok je 2026. Ak správa neuvádza mesiac, použi mesiac ${monthNum} (${monthName}).
- Rozsahy rozbaľ na jednotlivé dni: "27-30.8." = 27.,28.,29.,30. august; "od 12 až do 21" = 12 až 21.
- Zoznam typu "6.7.8.9.11." sú jednotlivé dni.
- "unavailable" = dni, ktoré správa hlási ako NOVÉ nemôže (pridať).
- "correctedAvailable" = dni, ktoré správa spätne RUŠÍ/OPRAVUJE (predtým nahlásené nemôže, teraz autor píše že predsa len môže / bol to omyl / zmenil sa dátum).
- Nastav isCorrection:true, keď správa obsahuje zmysel "oprava/omyl/zle som napísal/predsa len môžem/zmena", alebo keď correctedAvailable nie je prázdne.
- Ak píše, že je bez obmedzení (bez toho, aby to bola oprava), daj noRestrictions:true a unavailable prázdne.
- Ak správa vôbec nerieši dostupnosť (pozdrav, emoji, organizačná správa), vráť všetky polia prázdne/false.
- Ak si dátumom neistý, radšej ho vynechaj, než aby si hádal.`;

/* Fáza 4 — denné reporty od réžie.
   Text reportu sa NEROZOBERÁ. Jediné, čo z neho potrebujeme, je dátum dňa, ktorého sa
   report týka. Keď v texte dátum nie je, použije sa dátum samotnej správy. */
const REPORT_DATE_PROMPT = (dnesIso) => `Dostávaš text denného reportu z natáčania. Tvoja jediná úloha je nájsť DÁTUM DŇA, ktorého sa report týka.
Vráť IBA JSON objekt, bez markdownu a bez vysvetlenia, presne v tvare:
{"datum":"2026-08-15"}
alebo, ak v texte žiadny dátum nie je:
{"datum":null}
Pravidlá:
- Správa bola odoslaná ${dnesIso}. Ak text uvádza deň a mesiac bez roka, doplň rok tak, aby dátum bol čo najbližšie k dátumu odoslania.
- Beri dátum, o ktorom report hovorí ("report z 15.8.", "streda 12. augusta", "za 3. deň natáčania 5.8.2026"), nie dátumy spomenuté len mimochodom (napr. plán na budúci týždeň).
- Ak je v texte viac dátumov, vyber ten, ktorý označuje deň, za ktorý je report písaný — spravidla ten prvý alebo ten v hlavičke.
- Formát odpovede je vždy YYYY-MM-DD.
- Neistota = null. Radšej nič, než zlý dátum.
- Nič iné z textu nespracúvaj a nekomentuj.`;

const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

/** Prísna kontrola ISO dátumu — modelu sa nedá veriť naslepo. */
const jeIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

/** Dátum správy: bridge posiela ts (sekundy alebo ISO), inak berieme "teraz". */
function datumSpravy(ts) {
  if (typeof ts === "number" && ts > 0) {
    const ms = ts > 1e12 ? ts : ts * 1000; // WhatsApp posiela sekundy
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof ts === "string" && ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

const isoDna = (d) => d.toISOString().slice(0, 10);

async function callAnthropicText(env, prompt, userText) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.MODEL_NAME || "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [
        { role: "user", content: `${prompt}\n\nSpráva:\n"""${userText}"""` },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Vision/text API zlyhalo: " + errText.slice(0, 300));
  }
  const data = await resp.json();
  const text = (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
  return text.replace(/```json|```/g, "").trim();
}

async function handlePostParse(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  if (!roleCaps(user.role).pending) return json({ error: "Na import screenshotov nemáš právo." }, 403, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const { image, mediaType, month } = body;
  if (!image) return json({ error: "Chýba obrázok." }, 400, env);

  /* Toto je jediný endpoint, ktorý stojí peniaze — každé volanie je platba
     Anthropicu. Preto sa veľkosť aj typ obrázka kontrolujú EŠTE PREDTÝM, než sa
     čokoľvek pošle von, a skôr než sa vôbec pozrieme na kľúč. */
  if (String(image).length > MAX_OBRAZOK_ZNAKOV) {
    return json({ error: "Screenshot je príliš veľký. Zmenši ho alebo pošli po častiach." }, 413, env);
  }
  const POVOLENE_TYPY = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const typObrazka = POVOLENE_TYPY.includes(mediaType) ? mediaType : "image/png";

  if (!env.ANTHROPIC_API_KEY) return json({ error: "Vision API kľúč nie je nastavený na serveri." }, 500, env);

  const monthNum = Number(month) || 8;
  const prompt = VISION_PROMPT_TEMPLATE(monthNum, SK_MONTHS[monthNum - 1]);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Over si aktuálny názov modelu na https://docs.claude.com/en/docs/about-claude/models
      // — dá sa prepísať aj bez redeploy cez `wrangler secret put MODEL_NAME` (voliteľné).
      model: env.MODEL_NAME || "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: typObrazka, data: image } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.log("Vision API zlyhalo:", errText.slice(0, 500));
    return json({ error: "Vision API zlyhalo: " + bezTajomstiev(errText.slice(0, 300)) }, 502, env);
  }

  const data = await resp.json();
  const text = (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();

  let items;
  try {
    items = JSON.parse(clean);
  } catch {
    return json({ error: "Nepodarilo sa spracovať odpoveď vision modelu." }, 502, env);
  }

  return json({ items }, 200, env);
}

/* ---------- WhatsApp bridge webhook (POST /hook) ---------- */
// Tento endpoint IBA ČÍTA správy, ktoré mu pošle vlastný WAHA/Baileys bridge používateľa
// (ten beží mimo tohto Workera — eSIM číslo, prepojenie WhatsApp Business, hosting je
// zodpovednosť používateľa, viď README). Worker odtiaľto NIKDY nič neposiela naspäť do
// WhatsApp skupiny — žiadny send-message call, iba číta a zapisuje do vlastného KV stavu.

const phoneKey = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
};

function matchCrewByPhone(crew, phone) {
  const pk = phoneKey(phone);
  if (!pk) return null;
  return crew.find((c) => (c.aliases || []).some((a) => phoneKey(a) === pk)) || null;
}

async function handlePostHook(request, env) {
  if (!(await checkHookSecret(request, env))) return json({ error: "Neplatný alebo chýbajúci X-Hook-Secret." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  // groupId je starý názov toho istého poľa — nechávam ho, nech starší bridge nespadne
  const { bridgeId, msgId, chatId: chatIdRaw, groupId, chatName, phone, sender, text } = body;
  const chatId = String(chatIdRaw || groupId || "").slice(0, 120);

  // bridge sa každou správou hlási, že žije
  if (bridgeId) await bridgePing(env, bridgeId, { stav: "beží" });

  if (!text || !String(text).trim()) {
    return json({ ignored: true, reason: "prázdny text" }, 200, env);
  }

  /* Tú istú správu dostaneme dvakrát vždy, keď bežia dva bridge (Fly.io + naska).
     Pečiatku kontrolujeme HNEĎ na začiatku, ešte pred čítaním textu modelom —
     nemá zmysel platiť dvakrát za to isté. */
  const msgKey = msgId ? "hookmsg:" + String(msgId).slice(0, 120) : "";
  if (msgKey) {
    if (await env.ROZPIS_KV.get(msgKey)) {
      return json({ duplicate: true, reason: "správu už spracoval druhý bridge" }, 200, env);
    }
    await env.ROZPIS_KV.put(msgKey, bridgeId || "1", { expirationTtl: HOOKMSG_TTL });
  }

  /* Neznámy chat sa NIKDY nečíta. Iba sa zapíše do zoznamu, aby si ho admin
     v appke videl a mohol ho zapnúť. Toto je to isté pravidlo ako pri neznámom
     telefónnom čísle: radšej nech appka navrhne, než aby konala sama. */
  // "dostupnost" = kto kedy nemôže (Fáza 3), "report" = denný report réžie (Fáza 4)
  let druhChatu = "dostupnost";
  {
    const state0 = await readState(env);
    const chaty = { ...(state0.chaty || {}) };
    const zaznam = chaty[chatId];
    const menoChatu = String(chatName || "").slice(0, 120);

    if (chatId && !zaznam && Object.keys(chaty).length >= MAX_CHATOV) {
      // rovnaký strop ako pri ohlásení čítačky — zoznam skupín nesmie rásť donekonečna
      return json({ ignored: true, reason: "zoznam skupín je plný" }, 200, env);
    }
    if (chatId && !zaznam) {
      chaty[chatId] = {
        id: chatId,
        nazov: menoChatu || "(bez názvu)",
        povoleny: false,
        prvyKrat: new Date().toISOString(),
        poslednaSprava: new Date().toISOString(),
      };
      const log = [{ t: new Date().toISOString(), text: `WhatsApp bridge: nový chat „${menoChatu || chatId}" — čaká na zapnutie adminom` }, ...state0.log].slice(0, 400);
      await writeState(env, { ...state0, chaty, log, version: state0.version + 1 });
      return json({ chatUnknown: true, chatId, reason: "chat ešte nie je zapnutý" }, 200, env);
    }
    if (chatId && !zaznam.povoleny) {
      return json({ ignored: true, reason: "chat je vypnutý" }, 200, env);
    }
    if (chatId && (zaznam.nazov !== menoChatu && menoChatu)) {
      // názov skupiny sa dá premenovať — drž ho aktuálny, ale kvôli tomu neruš nič iné
      chaty[chatId] = { ...zaznam, nazov: menoChatu, poslednaSprava: new Date().toISOString() };
      await writeState(env, { ...state0, chaty, version: state0.version + 1 });
    }
    if (zaznam && zaznam.druh === "report") druhChatu = "report";
  }

  /* ---------- Fáza 4: chat s dennými reportami ----------
     Jedna správa = jeden report. Obsah sa nerozoberá, iba sa k nemu nájde deň:
     najprv sa skúsi dátum priamo z textu, a keď tam nie je, použije sa dátum,
     kedy správa prišla. Report sa nikam nezapisuje do rozpisu — iba sa uloží
     a ukáže pri tom dni. */
  if (druhChatu === "report") {
    const prisloDna = datumSpravy(body.ts);
    let datum = isoDna(prisloDna);
    let zdroj = "sprava";

    if (env.ANTHROPIC_API_KEY) {
      try {
        const clean = await callAnthropicText(env, REPORT_DATE_PROMPT(isoDna(prisloDna)), String(text).slice(0, 4000));
        const najdeny = JSON.parse(clean)?.datum;
        if (jeIso(najdeny)) { datum = najdeny; zdroj = "text"; }
      } catch {
        /* Keď hľadanie dátumu zlyhá, report sa NESMIE stratiť — priradí sa k dňu,
           kedy správa prišla, a admin ho v appke vie prehodiť inam. Preto sa tu
           pečiatka "už spracované" ani nemaže: správa je uložená a hotovo. */
      }
    }

    const state = await readState(env);
    const reporty = { ...(state.reporty || {}) };

    // druhý bridge doručí tú istú správu — poistka aj bez pečiatky v KV
    if (msgId && Object.values(reporty).some((r) => r.msgId === String(msgId).slice(0, 120))) {
      return json({ duplicate: true, reason: "report už je uložený" }, 200, env);
    }

    const id = "rep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    reporty[id] = {
      id,
      datum,
      zdrojDatumu: zdroj,          // "text" = z textu reportu, "sprava" = podľa dňa doručenia
      prislo: prisloDna.toISOString(),
      autor: String(sender || "").slice(0, 80),
      telefon: String(phone || "").slice(0, 40),
      chatId,
      chatName: String(chatName || "").slice(0, 120),
      msgId: msgId ? String(msgId).slice(0, 120) : "",
      text: String(text).slice(0, 8000),
    };

    // strop: keby niečo zlyhalo, nech to nezaplní celé KV — zahoď najstaršie
    const kluce = Object.keys(reporty);
    if (kluce.length > MAX_REPORTOV) {
      kluce
        .sort((a, b) => String(reporty[a].prislo).localeCompare(String(reporty[b].prislo)))
        .slice(0, kluce.length - MAX_REPORTOV)
        .forEach((k) => delete reporty[k]);
    }

    const log = [{ t: new Date().toISOString(), text: `Report na ${datum}${zdroj === "sprava" ? " (dátum podľa dňa doručenia)" : ""} — ${String(sender || "neznámy").slice(0, 40)}` }, ...state.log].slice(0, 400);
    const nextState = { ...state, reporty, log, version: state.version + 1 };
    await writeState(env, nextState);
    return json({ report: true, id, datum, zdrojDatumu: zdroj, version: nextState.version }, 200, env);
  }

  const defaultMonth = Number(env.DEFAULT_HOOK_MONTH) || 8;
  let parsed;
  try {
    const clean = await callAnthropicText(env, TEXT_PROMPT_TEMPLATE(defaultMonth, SK_MONTHS[defaultMonth - 1]), String(text).slice(0, 2000));
    parsed = JSON.parse(clean);
  } catch (e) {
    /* Pečiatku "už spracované" sme dali skôr, aby sa za tú istú správu neplatilo
       dvakrát. Keď sa ale spracovanie nepodarilo, musí pečiatka zmiznúť — inak by
       druhý bridge (aj neskorší pokus) správu zahodil ako duplikát a tá by sa
       stratila potichu. To je presne to, čo sa diať nesmie. */
    if (msgKey) await env.ROZPIS_KV.delete(msgKey);
    return json({ error: "Nepodarilo sa spracovať text správy: " + e.message }, 502, env);
  }

  const unavailable = Array.isArray(parsed.unavailable) ? parsed.unavailable : [];
  const correctedAvailable = Array.isArray(parsed.correctedAvailable) ? parsed.correctedAvailable : [];
  const noRestrictions = Boolean(parsed.noRestrictions);
  const isCorrection = Boolean(parsed.isCorrection);

  if (!unavailable.length && !correctedAvailable.length && !noRestrictions) {
    return json({ ignored: true, reason: "správa nerieši dostupnosť" }, 200, env);
  }

  const state = await readState(env);
  const match = matchCrewByPhone(state.crew, phone);

  if (match) {
    // telefón poznáme -> rovno zapíš (nikdy nezapisuj pri neznámom telefóne)
    const cells = { ...state.cells };
    // Pozor: prázdna bunka musí byť naozaj prázdna vo všetkých poliach, ktoré bunka drží —
    // vrátane nahláseného nadčasu (Fáza 2). Keby sa nadčas nerátal, oprava z WhatsAppu
    // ("v ten deň už môžem") by ticho zmazala bunku aj s nahlásenými hodinami.
    const PRAZDNA = { off: false, shift: null, duel: false, note: "", nadcas: 0 };
    unavailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      const cur = cells[k] || PRAZDNA;
      cells[k] = { ...cur, off: true };
    });
    correctedAvailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      const cur = cells[k] || PRAZDNA;
      const next = { ...cur, off: false };
      const empty = !next.off && !next.shift && !next.duel && !next.note && !Number(next.nadcas);
      if (empty) delete cells[k]; else cells[k] = next;
    });
    const bits = [];
    if (noRestrictions) bits.push("bez obmedzení");
    if (unavailable.length) bits.push(`${unavailable.length} dní nemôže`);
    if (correctedAvailable.length) bits.push(`${correctedAvailable.length} dní opravených (znova môže)`);
    const log = [{ t: new Date().toISOString(), text: `WhatsApp bridge: ${match.name} — ${bits.join(", ") || "žiadna zmena"}` }, ...state.log].slice(0, 400);
    const next = { ...state, cells, log, version: state.version + 1 };
    await writeState(env, next);
    return json({ matched: true, crewId: match.id, version: next.version }, 200, env);
  }

  // neznámy telefón -> NIKDY nezapisuj priamo, iba zaraď do fronty na potvrdenie adminom
  const uzVoFronte = msgId && (state.pendingHook || []).some((e) => e.msgId && e.msgId === msgId);
  if (uzVoFronte) {
    // druhá poistka proti dvom bridgeom — pečiatka v KV mohla ešte nebyť vidieť
    return json({ duplicate: true, reason: "správa už je vo fronte" }, 200, env);
  }
  const entry = {
    id: "hook_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    msgId: msgId ? String(msgId).slice(0, 120) : "",
    chatId,
    chatName: String(chatName || "").slice(0, 120),
    ts: new Date().toISOString(),
    phone: phone || "",
    sender: sender || "",
    text: String(text).slice(0, 500),
    unavailable,
    correctedAvailable,
    noRestrictions,
    isCorrection,
  };
  const pendingHook = [entry, ...(state.pendingHook || [])].slice(0, 200);
  const next = { ...state, pendingHook, version: state.version + 1 };
  await writeState(env, next);
  return json({ queued: true, id: entry.id, version: next.version }, 200, env);
}

/* Bridge sa raz za päť minút ohlási, že žije, a pošle zoznam skupín, ktoré vidí.
   Nové skupiny sa zapíšu ako VYPNUTÉ — admin si v appke odklikne, ktoré sa majú
   čítať. Kým ich nezapne, appka z nich neprečíta ani písmeno. */
async function handleBridgePing(request, env) {
  if (!(await checkHookSecret(request, env))) return json({ error: "Neplatný alebo chýbajúci X-Hook-Secret." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const bridgeId = String(body.bridgeId || "").slice(0, 40);
  if (!bridgeId) return json({ error: "Chýba bridgeId." }, 400, env);
  // "token" by v KV prepísal kód pre čítačky — pod tým menom čítačka bežať nesmie
  if (BRIDGE_KEY(bridgeId) === BRIDGE_TOKEN_KEY) {
    return json({ error: "bridgeId 'token' je vyhradené, zvoľ iné." }, 400, env);
  }

  /* Ako sa čítačke darí prihlásiť. Je to tu preto, aby sa párovanie dalo dokončiť
     z appky a nikto nemusel čítať logy kontajnera. `qr` a `kodParovania` sú
     prihlasovacie údaje — von ich púšťa iba /bridge/status, a to len adminovi
     a vedúcemu. Dĺžky orezávame, nech sa do KV nedostane čokoľvek. */
  await bridgePing(env, bridgeId, {
    stav: String(body.stav || "beží").slice(0, 60),
    cislo: String(body.cislo || "").slice(0, 40),
    verzia: String(body.verzia || "").slice(0, 20),
    waVerzia: String(body.waVerzia || "").slice(0, 40),
    kodParovania: String(body.kodParovania || "").slice(0, 20),
    kodDo: String(body.kodDo || "").slice(0, 40),
    qr: String(body.qr || "").slice(0, 1000),
    chyba: String(body.chyba || "").slice(0, 200),
  });

  /* Doplň novoobjavené skupiny do zoznamu (vypnuté), názvy existujúcich zaktualizuj.
     Stav si načítame RAZ a ďalej s ním pracujeme — predtým sa tu čítal dvakrát
     za sebou, čo bolo pri ohlásení každú minútu zbytočné míňanie KV. */
  const skupiny = Array.isArray(body.skupiny) ? body.skupiny.slice(0, 200) : [];
  let state = await readState(env);
  if (skupiny.length) {
    const chaty = { ...(state.chaty || {}) };
    let zmena = false;
    for (const s of skupiny) {
      const id = String(s?.id || "").slice(0, 120);
      if (!id) continue;
      const nazov = String(s?.nazov || "").slice(0, 120) || "(bez názvu)";
      if (!chaty[id]) {
        /* Zoznam skupín má strop. Bez neho by pokazená (alebo podvrhnutá)
           čítačka vedela každou minútou pridať ďalšie stovky skupín a stav by
           rástol, kým sa doňho dá zapísať. Nové skupiny sa vtedy jednoducho
           ignorujú — zapnuté sledovanie beží ďalej a admin vie zoznam
           prečistiť tlačidlom „Zabudni skupiny". */
        if (Object.keys(chaty).length >= MAX_CHATOV) continue;
        chaty[id] = { id, nazov, povoleny: false, prvyKrat: new Date().toISOString(), poslednaSprava: "" };
        zmena = true;
      } else if (chaty[id].nazov !== nazov) {
        chaty[id] = { ...chaty[id], nazov };
        zmena = true;
      }
    }
    if (zmena) {
      state = { ...state, chaty, version: state.version + 1 };
      await writeState(env, state);
    }
  }

  // bridge si vypýta, ktoré chaty má vôbec posielať — nech zvyšok ani neopúšťa jeho stroj
  const povolene = Object.values(state.chaty || {}).filter((c) => c.povoleny).map((c) => c.id);
  return json({ ok: true, povoleneChaty: povolene }, 200, env);
}

async function handleBridgeStatus(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);

  /* Stav čítačiek (beží / neozvala sa) smie vidieť ktokoľvek prihlásený. Ale QR
     a párovací kód sú prihlasovacie údaje do WhatsAppu — kto ich má, prepojí si
     vlastné zariadenie. Preto ich dostane iba ten, kto aj tak potvrdzuje zmeny:
     hlavný admin a vedúci. Ostatným ich odtiaľto vystrihneme. */
  const bridges = await readBridges(env);
  if (roleCaps(user.role).pending) return json({ bridges }, 200, env);
  const ostrihane = bridges.map(({ qr, kodParovania, kodDo, ...zvysok }) => zvysok);
  return json({ bridges: ostrihane }, 200, env);
}

/* GET /bridge/token  — ukáže kód pre čítačku (vyrobí ho, ak ešte nie je)
   POST /bridge/token — vyrobí nový; starý tým hneď prestane platiť.

   Vidieť ho smie iba ten, kto aj tak potvrdzuje zmeny (admin a vedúci) — je to
   kľúč, ktorým sa dá serveru podstrčiť správa, tak nech ho nemá celý štáb. */
async function handleBridgeToken(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  if (!roleCaps(user.role).pending) {
    return json({ error: "Kód pre čítačku vidí iba vedúci alebo hlavný admin." }, 403, env);
  }
  const novy = request.method === "POST";
  const kod = await bridgeToken(env, novy);
  /* Keď je nastavený aj Cloudflare secret, appka to povie — inak by človek hľadal,
     prečo mu funguje aj kód, ktorý v appke nevidí. */
  return json({ kod, aj_secret: !!env.HOOK_SECRET, novy }, 200, env);
}

/* POST /chaty/zabudni — vyhodí zo zoznamu skupiny, ktoré nie sú zapnuté.

   Načo je to: zoznam skupín sa plní z toho, čo vidí prihlásený WhatsApp účet.
   Keď sa čítačka preloží na iné číslo (napríklad z osobného na eSIM), mená
   skupín z toho starého účtu v zozname ostanú visieť, hoci k nim už nikto
   nemá prístup. Toto ich zmaže; čítačky do minúty nahlásia, čo vidia teraz.

   Zapnutých skupín sa to zámerne nedotkne — tie niekto vedome zapol a mohli
   by tým prísť o nastavenie (dostupnosť/reporty). Keď treba vyhodiť aj takú,
   najprv sa vypne a potom sa zoznam zabudne. */
async function handleChatyZabudni(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  if (!roleCaps(user.role).pending) {
    return json({ error: "Zoznam skupín smie prečistiť iba vedúci alebo hlavný admin." }, 403, env);
  }

  const state = await readState(env);
  const vsetky = Object.values(state.chaty || {});
  const ostavaju = {};
  for (const c of vsetky) if (c?.povoleny) ostavaju[c.id] = c;
  const zmazane = vsetky.length - Object.keys(ostavaju).length;
  if (!zmazane) return json({ ok: true, zmazane: 0 }, 200, env);

  const log = [
    { t: new Date().toISOString(), text: `Zoznam WhatsApp skupín prečistený (${zmazane}) — ${user.email}` },
    ...(state.log || []),
  ].slice(0, 400);
  await writeState(env, { ...state, chaty: ostavaju, log, version: state.version + 1 });
  return json({ ok: true, zmazane }, 200, env);
}

/* ========== Fáza 5: dispozícia mailom ==========

   Dispozícia chodí mailom na vyhradenú adresu (Cloudflare Email Routing ju
   preposiela sem do funkcie email()). Server z nej prečíta harmonogram dňa
   a prípadné zmeny smien — ale NIČ tým neprepíše. Všetko sa odloží do
   "pendingDispo" ako návrh a čaká, kým to niekto v appke potvrdí. Až vtedy sa
   harmonogram zapíše do "dispo" a zmeny do rozpisu.

   Sekcia o odchode z Prahy sa zámerne ignoruje — s rozpisom štábu nesúvisí. */

const DISPO_PROMPT = (dnesIso, menaStabu) => `Čítaš e-mail s dispozíciou (dispo) na natáčací deň televíznej relácie.
Vráť IBA JSON objekt, bez markdownu a bez vysvetlenia, presne v tomto tvare:
{"datum":"2026-08-15","miesto":"","pocasie":"","harmonogram":[{"cas":"07:00","text":"zraz na základni"}],"poznamky":"","kontakty":[{"meno":"Peter Novák","rola":"produkčný","telefon":"+421900000000"}],"zmeny":[{"meno":"Ján Novák","smena":"A","nemoze":false,"dovod":"posun zrazu"}]}

Pravidlá:
- "datum" je deň, na ktorý dispozícia platí, vo formáte YYYY-MM-DD. Mail prišiel ${dnesIso}; ak je uvedený deň a mesiac bez roka, doplň rok tak, aby bol dátum čo najbližšie k dátumu doručenia. Keď dátum nevieš určiť, daj null.
- "miesto" je natáčacia lokalita alebo adresa na tento deň, presne tak, ako je v maile. Keď v maile nie je, daj "".
- "pocasie" je predpoveď počasia na daný deň, keď je v maile uvedená (napr. "polojasno, 18 °C"). Keď nie je, daj "".
- "harmonogram" je časový plán dňa v poradí, ako je v maile. "cas" je HH:MM (24-hodinový). Riadky bez času vynechaj. Text nechaj v pôvodnom znení, iba skráť na to podstatné.
- ÚPLNE IGNORUJ sekciu o odchode/odjazde z Prahy a o doprave z Prahy — do harmonogramu ju nedávaj.
- "poznamky" je krátke zhrnutie ostatného, čo je v maile dôležité a nemá vlastné pole (napr. oblečenie, čo si zobrať, špeciálne pokyny). Počasie, miesto ani kontakty sem znova nepíš. Keď nič také nie je, daj "".
- "kontakty" sú ľudia z produkcie s telefónnym číslom uvedení ako kontakt na tento deň (napr. produkčný, vedúci lokácie, asistent produkcie). "rola" píš tak, ako je v maile, alebo krátko opíš. Bez telefónneho čísla kontakt nedávaj. Keď mail žiadne takéto kontakty neuvádza, daj prázdne pole.
- "zmeny" vypĺňaj IBA vtedy, keď mail výslovne píše o zmene v obsadení konkrétneho človeka: kto má inú smenu, alebo kto v ten deň nie je. Nič nedomýšľaj — keď o zmenách v obsadení nie je reč, daj prázdne pole.
- "smena" môže byť iba "A", "B", "C" alebo "R"; keď mail hovorí, že človek v ten deň nie je, daj "smena":null a "nemoze":true.
- "meno" píš tak, ako je v maile. Ľudia zo štábu sa volajú: ${menaStabu || "(zoznam nie je k dispozícii)"}.
- Neistota = vynechaj. Radšej menej, než vymyslené.`;

/** Porovnávanie mien bez ohľadu na diakritiku, veľkosť písmen a poradie slov. */
const bezDiakritiky = (s) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Nájde človeka zo štábu podľa mena z mailu. Zámerne je to prísne:
 * keď si nie sme istí, vrátime null a v appke to doplní človek. Zle priradená
 * zmena smeny je horšia než žiadna.
 */
function najdiClena(crew, meno) {
  const hladane = bezDiakritiky(meno);
  if (!hladane) return null;
  const slova = hladane.split(" ").filter(Boolean);

  const kandidati = (crew || []).map((c) => ({ c, n: bezDiakritiky(c.name), slova: bezDiakritiky(c.name).split(" ").filter(Boolean) }));

  // celé meno sedí (v akomkoľvek poradí slov)
  const cele = kandidati.filter((k) => k.slova.length === slova.length && [...k.slova].sort().join(" ") === [...slova].sort().join(" "));
  if (cele.length === 1) return cele[0].c;

  // v maile je len priezvisko (alebo len krstné) a v štábe je taký človek jediný
  if (slova.length === 1) {
    const zhody = kandidati.filter((k) => k.slova.includes(slova[0]));
    if (zhody.length === 1) return zhody[0].c;
    return null;
  }

  // mail má viac slov — stačí, keď všetky sedia s niektorými slovami mena a je to jediný taký
  const ciastocne = kandidati.filter((k) => slova.every((s) => k.slova.includes(s)));
  if (ciastocne.length === 1) return ciastocne[0].c;
  return null;
}

/* ---------- čítanie surového mailu ----------
   Zámerne bez knižnice: Worker má byť malý a mail od produkcie je obyčajný
   text alebo jednoduchý multipart. Keď sa niečo nepodarí prečítať, vrátime
   aspoň celé telo — nech radšej príde návrh s trochu neupratným textom, než
   aby dispo ticho zapadlo. */

function dekodujQuotedPrintable(s) {
  const bez = s.replace(/=\r?\n/g, "");
  const bajty = [];
  for (let i = 0; i < bez.length; i++) {
    if (bez[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(bez.slice(i + 1, i + 3))) {
      bajty.push(parseInt(bez.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bajty.push(bez.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bajty));
}

function dekodujBase64(s) {
  try {
    const bin = atob(s.replace(/\s+/g, ""));
    const bajty = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bajty[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bajty);
  } catch {
    return s;
  }
}

const bezHtml = (s) =>
  String(s)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Rozdelí kus mailu na hlavičky a telo. */
function rozdelMail(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  if (i < 0) return { hlavicky: raw, telo: "" };
  const koniec = raw.slice(i).match(/^\r?\n\r?\n/)[0].length;
  return { hlavicky: raw.slice(0, i), telo: raw.slice(i + koniec) };
}

function hlavicka(hlavicky, meno) {
  // hlavička sa môže lámať do viacerých riadkov (pokračovanie začína medzerou)
  const zlepene = hlavicky.replace(/\r?\n[ \t]+/g, " ");
  const m = zlepene.match(new RegExp("^" + meno + "\\s*:\\s*(.*)$", "im"));
  return m ? m[1].trim() : "";
}

function dekodujTelo(hlavicky, telo) {
  const enc = hlavicka(hlavicky, "Content-Transfer-Encoding").toLowerCase();
  if (enc === "quoted-printable") return dekodujQuotedPrintable(telo);
  if (enc === "base64") return dekodujBase64(telo);
  return telo;
}

/** Z celého surového mailu vytiahne čitateľný text (uprednostní text/plain). */
export function extrahujTextMailu(raw) {
  const { hlavicky, telo } = rozdelMail(String(raw || ""));
  const ct = hlavicka(hlavicky, "Content-Type");
  const hranica = ct.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i)?.[1];

  if (!hranica) {
    const text = dekodujTelo(hlavicky, telo);
    return /html/i.test(ct) ? bezHtml(text) : text.trim();
  }

  // multipart: prejdi časti, ber text/plain, HTML iba ako záložnú možnosť
  const casti = telo.split(new RegExp("--" + hranica.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(--)?\\s*\\r?\\n?"));
  let plain = "";
  let html = "";
  for (const cast of casti) {
    if (!cast || !cast.trim()) continue;
    const { hlavicky: h, telo: t } = rozdelMail(cast);
    const castCt = hlavicka(h, "Content-Type");
    if (/multipart\//i.test(castCt)) {
      const vnorene = extrahujTextMailu(cast);
      if (vnorene && !plain) plain = vnorene;
      continue;
    }
    if (/text\/plain/i.test(castCt) && !plain) plain = dekodujTelo(h, t).trim();
    else if (/text\/html/i.test(castCt) && !html) html = bezHtml(dekodujTelo(h, t));
  }
  return plain || html || dekodujTelo(hlavicky, telo).trim();
}

/**
 * Prečíta dispo mail a odloží NÁVRH. Rozpis sa nemení — to spraví až človek
 * v appke. Vracia { navrh: true, id, datum } alebo { ignored/duplicate: true }.
 */
async function spracujDispoMail(env, { predmet, od, text, ts, msgId }) {
  const cistyText = String(text || "").trim();
  if (!cistyText) return { ignored: true, reason: "prázdny mail" };

  // ten istý mail môže doraziť dvakrát (preposlanie, opakované doručenie)
  const kluc = msgId ? "dispomail:" + String(msgId).slice(0, 160) : "";
  if (kluc) {
    if (await env.ROZPIS_KV.get(kluc)) return { duplicate: true, reason: "tento mail už bol spracovaný" };
    await env.ROZPIS_KV.put(kluc, "1", { expirationTtl: HOOKMSG_TTL });
  }

  const prislo = datumSpravy(ts);
  const state0 = await readState(env);
  const mena = (state0.crew || []).map((c) => c.name).filter(Boolean).join(", ");

  let datum = null;
  let miesto = "";
  let pocasie = "";
  let harmonogram = [];
  let poznamky = "";
  let kontakty = [];
  let zmeny = [];
  let precitane = false;

  if (env.ANTHROPIC_API_KEY) {
    try {
      const clean = await callAnthropicText(env, DISPO_PROMPT(isoDna(prislo), mena), cistyText.slice(0, 12000));
      const v = JSON.parse(clean) || {};
      if (jeIso(v.datum)) datum = v.datum;
      miesto = String(v.miesto || "").slice(0, 300);
      pocasie = String(v.pocasie || "").slice(0, 200);
      harmonogram = (Array.isArray(v.harmonogram) ? v.harmonogram : [])
        .filter((h) => /^\d{1,2}:\d{2}$/.test(String(h?.cas || "")))
        .slice(0, 80)
        .map((h) => ({ cas: String(h.cas).padStart(5, "0"), text: String(h.text || "").slice(0, 300) }));
      poznamky = String(v.poznamky || "").slice(0, 2000);
      // kontakt bez telefónu je len meno bez úžitku — v núdzi si ho vie človek dohľadať sám
      kontakty = (Array.isArray(v.kontakty) ? v.kontakty : [])
        .slice(0, 20)
        .map((k) => ({
          meno: String(k?.meno || "").slice(0, 80),
          rola: String(k?.rola || "").slice(0, 80),
          telefon: String(k?.telefon || "").slice(0, 40),
        }))
        .filter((k) => k.meno && k.telefon);
      zmeny = (Array.isArray(v.zmeny) ? v.zmeny : []).slice(0, 60).map((z) => {
        const clen = najdiClena(state0.crew, z?.meno);
        const smena = ["A", "B", "C", "R"].includes(z?.smena) ? z.smena : null;
        return {
          meno: String(z?.meno || "").slice(0, 80),
          crewId: clen ? clen.id : null,     // null = appka nevie, o koho ide; vyberie človek
          smena,
          nemoze: !!z?.nemoze,
          dovod: String(z?.dovod || "").slice(0, 200),
        };
      // zmena, ktorá nič nehovorí, je len šum
      }).filter((z) => z.smena || z.nemoze);
      precitane = true;
    } catch {
      /* Keď sa mail nepodarí prečítať, návrh sa aj tak uloží — s holým textom.
         Človek v appke uvidí aspoň, že dispo prišlo, a prepíše si ho ručne.
         Stratiť dispozíciu je horšie než uložiť ju neprečítanú. */
    }
  }

  const state = await readState(env);
  const id = "dsp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const navrh = {
    id,
    datum: datum || isoDna(prislo),
    datumZTextu: !!datum,              // false = deň je iba podľa dňa doručenia
    precitane,                         // false = mail sa nepodarilo rozobrať, je tu len text
    prislo: prislo.toISOString(),
    predmet: String(predmet || "").slice(0, 200),
    od: String(od || "").slice(0, 120),
    miesto,
    pocasie,
    harmonogram,
    poznamky,
    kontakty,
    zmeny,
    text: cistyText.slice(0, 20000),
  };

  const pendingDispo = [navrh, ...(state.pendingDispo || [])].slice(0, MAX_PENDING_DISPO);
  const log = [
    { t: new Date().toISOString(), text: `Dispo mail na ${navrh.datum}${precitane ? "" : " (nepodarilo sa prečítať — iba text)"} — čaká na potvrdenie` },
    ...state.log,
  ].slice(0, 400);
  const next = { ...state, pendingDispo, log, version: state.version + 1 };
  await writeState(env, next);

  return { navrh: true, id, datum: navrh.datum, precitane, zmien: zmeny.length, polozek: harmonogram.length, version: next.version };
}

/* POST /dispo/mail — záložná cesta pre dispo mail (X-Hook-Secret).
   Existuje preto, že Email Routing sa zapína v Cloudflare paneli; kým to nie je
   zapnuté (alebo keď mail chodí cez iný preposielač), dá sa dispo poslať sem. */
async function handleDispoMail(request, env) {
  if (!(await checkHookSecret(request, env))) return json({ error: "Neplatný alebo chýbajúci X-Hook-Secret." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  // dá sa poslať buď rozobraný mail, alebo celý surový (raw) a rozoberieme ho tu
  let { predmet, od, text, ts, msgId } = body;
  if (!text && body.raw) {
    const { hlavicky } = rozdelMail(String(body.raw));
    text = extrahujTextMailu(body.raw);
    if (!predmet) predmet = hlavicka(hlavicky, "Subject");
    if (!od) od = hlavicka(hlavicky, "From");
    if (!msgId) msgId = hlavicka(hlavicky, "Message-ID");
  }

  const v = await spracujDispoMail(env, { predmet, od, text, ts, msgId });
  return json(v, 200, env);
}

/* ---------- upozornenia do telefónu (Fáza 6) ---------- */

/* Verejný kľúč servera. Appka ho potrebuje na to, aby si u výrobcu prehliadača
   vypýtala schránku práve pre nás. Tajný nie je — verejný kľúč je verejný. */
async function handlePushKey(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  const k = await vapidKluce(env);
  return json({ kluc: k.verejny }, 200, env);
}

async function handlePushSubscribe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  const endpoint = String(body.endpoint || "");
  const p256dh = String(body.p256dh || "");
  const auth = String(body.auth || "");
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return json({ error: "Chýbajú údaje o schránke upozornení." }, 400, env);
  }
  // Núdzový admin nemá mail, takže by sa mu upozornenia nemali komu adresovať.
  if (!user.email) return json({ error: "Upozornenia sa dajú zapnúť len po prihlásení mailom, nie núdzovým heslom." }, 400, env);
  // odber sa viaže na prihláseného človeka — nedá sa prihlásiť za niekoho iného
  await ulozOdber(env, user.email, { endpoint, p256dh, auth, zariadenie: body.zariadenie });
  return json({ ok: true }, 200, env);
}

async function handlePushUnsubscribe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  if (!body.endpoint) return json({ error: "Chýba adresa schránky." }, 400, env);
  await zmazOdber(env, user.email, String(body.endpoint));
  return json({ ok: true }, 200, env);
}

/* Skúšobné upozornenie — pošle sa iba na vlastné zariadenia toho, kto o to žiada.
   Je to jediný spôsob, ako si človek overí, že mu upozornenia naozaj chodia. */
async function handlePushTest(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  const v = await posliVsetkym(env, {
    nadpis: "FARMA 18",
    text: "Skúšobné upozornenie — funguje to.",
    url: "/",
    znacka: "test",
  }, [user.email]);
  return json(v, 200, env);
}

/* Rozposlanie upozornenia štábu. Smú to iba vedúci a admin — to isté pravidlo
   ako pri všetkom ostatnom, čo zasahuje do rozpisu. */
async function handlePushOznam(request, env, ctx) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  const caps = roleCaps(user.role);
  if (!caps.pending) return json({ error: "Upozornenia smú rozposielať iba vedúci a admin." }, 403, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  const sprava = {
    nadpis: String(body.nadpis || "FARMA 18").slice(0, 80),
    text: String(body.text || "").slice(0, 300),
    url: String(body.url || "/").slice(0, 200),
    znacka: body.znacka ? String(body.znacka).slice(0, 60) : undefined,
    dolezite: !!body.dolezite,
  };
  if (!sprava.text) return json({ error: "Prázdne upozornenie sa neposiela." }, 400, env);

  const komu = Array.isArray(body.komu) && body.komu.length ? body.komu.map(String) : null;

  // Rozosielanie môže trvať — nenechávame appku čakať, kým to prejde všetkými telefónmi.
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(posliVsetkym(env, sprava, komu));
    return json({ ok: true, odoslane: "na pozadí" }, 200, env);
  }
  const v = await posliVsetkym(env, sprava, komu);
  return json({ ok: true, ...v }, 200, env);
}

/* Keď príde nové dispo mailom, nech o tom vedia tí, čo ho majú potvrdiť.
   Nikomu inému sa to neposiela — štáb má vidieť až potvrdený harmonogram. */
async function upozorniNaDispo(env, navrh) {
  try {
    const users = await readUsers(env);
    const komu = users
      .filter((u) => u.active !== false && roleCaps(u.role).pending)
      .map((u) => u.email);
    if (!komu.length) return;
    await posliVsetkym(env, {
      nadpis: "Nové dispo čaká na potvrdenie",
      text: navrh && navrh.datum ? `Prišla dispozícia na ${navrh.datum}. Do rozpisu sa nič nezapíše, kým to nepotvrdíš.` : "Prišla dispozícia mailom.",
      url: "/",
      znacka: "dispo",
    }, komu);
  } catch (e) {
    // upozornenie je príjemnosť navyše — keď zlyhá, mail sa aj tak spracoval
    console.log("upozornenie na dispo zlyhalo:", e && e.message);
  }
}

/* Keď niečo spadne, nesmie to skončiť ako holá výnimka Cloudflaru — tá príde
   bez CORS hlavičiek a prehliadač z nej urobí nič nehovoriace „Load failed".
   Appka potom vyzerá pokazená, hoci server presne vie, čo sa stalo.

   Najčastejšia príčina je vyčerpaný denný strop Cloudflare KV (zadarmo 1000
   zápisov denne). KV vtedy vyhodí chybu s 429 a appka to má povedať rovno,
   nie mlčať. Strop sa vracia o polnoci UTC. */
/* Chybové hlášky chodia až do prehliadača, takže sa v nich nesmie ocitnúť nič,
   čím sa dá server otvoriť. Texty od Anthropicu alebo Resendu vedia zopakovať
   kus kľúča, ktorý im prišiel — preto sa všetko, čo vyzerá ako kľúč alebo token,
   pred odoslaním prepíše. Do logu (wrangler tail) ide celý text nedotknutý. */
function bezTajomstiev(text) {
  return String(text)
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9_-]{8,})/g, "[kľúč]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[kód]");
}

function chybaOdpoved(e, env) {
  const text = bezTajomstiev(String((e && e.message) || e || ""));
  console.log("požiadavka spadla:", String((e && e.message) || e || ""));
  if (/429|rate limit|exceeded/i.test(text)) {
    return json({
      error: "Cloudflare KV minulo denný limit zápisov. Uložiť sa dá až po polnoci UTC.",
      kod: "kv_strop",
    }, 503, env);
  }
  return json({ error: "Chyba servera: " + text.slice(0, 200) }, 500, env);
}

async function smeruj(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(env) });
  }

  // --- prihlásenie a používatelia (Fáza 1) ---
  if (url.pathname === "/auth/request" && request.method === "POST") {
    return handleAuthRequest(request, env, json);
  }
  if (url.pathname === "/auth/verify" && request.method === "POST") {
    return handleAuthVerify(request, env, json, corsHeaders);
  }
  if (url.pathname === "/auth/me" && request.method === "GET") {
    return handleAuthMe(request, env, json);
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return handleAuthLogout(request, env, corsHeaders);
  }
  if (url.pathname === "/auth/users" && request.method === "GET") {
    return handleGetUsers(request, env, json);
  }
  if (url.pathname === "/auth/users" && request.method === "POST") {
    return handlePostUsers(request, env, json);
  }

  if (url.pathname === "/data" && request.method === "GET") {
    return handleGetData(request, env);
  }
  if (url.pathname === "/data" && request.method === "POST") {
    return handlePostData(request, env);
  }
  if (url.pathname === "/parse" && request.method === "POST") {
    return handlePostParse(request, env);
  }
  if (url.pathname === "/version" && request.method === "GET") {
    return handleGetVersion(env);
  }
  // --- WhatsApp bridge (Fáza 3) ---
  if (url.pathname === "/bridge/ping" && request.method === "POST") {
    return handleBridgePing(request, env);
  }
  if (url.pathname === "/bridge/status" && request.method === "GET") {
    return handleBridgeStatus(request, env);
  }
  if (url.pathname === "/bridge/token" && (request.method === "GET" || request.method === "POST")) {
    return handleBridgeToken(request, env);
  }
  if (url.pathname === "/chaty/zabudni" && request.method === "POST") {
    return handleChatyZabudni(request, env);
  }
  if (url.pathname === "/hook" && request.method === "POST") {
    return handlePostHook(request, env);
  }
  // --- dispozícia mailom (Fáza 5) ---
  if (url.pathname === "/dispo/mail" && request.method === "POST") {
    return handleDispoMail(request, env);
  }
  // --- upozornenia do telefónu (Fáza 6) ---
  if (url.pathname === "/push/key" && request.method === "GET") {
    return handlePushKey(request, env);
  }
  if (url.pathname === "/push/subscribe" && request.method === "POST") {
    return handlePushSubscribe(request, env);
  }
  if (url.pathname === "/push/unsubscribe" && request.method === "POST") {
    return handlePushUnsubscribe(request, env);
  }
  if (url.pathname === "/push/test" && request.method === "POST") {
    return handlePushTest(request, env);
  }
  if (url.pathname === "/push/oznam" && request.method === "POST") {
    return handlePushOznam(request, env, ctx);
  }

  return json({ error: "Not found" }, 404, env);
}

export default {
  async fetch(request, env, ctx) {
    /* Každá požiadavka dostane vlastnú krátkodobú pamäť na KV (viď kes.js),
       nech sa ten istý kľúč nečíta dva- a trikrát za sebou. Naprieč
       požiadavkami sa nekešuje nič. */
    env = sKesou(env);
    try {
      return await smeruj(request, env, ctx);
    } catch (e) {
      return chybaOdpoved(e, env);
    }
  },

  /* Sem príde mail z Cloudflare Email Routing. Nič neodpisujeme a nič
     neodmietame — mail iba prečítame a odložíme ako návrh. Keby to spadlo,
     nesmie to zhodiť doručovanie, preto je celé telo v try. */
  async email(message, env, ctx) {
    try {
      const raw = await new Response(message.raw).text();
      const v = await spracujDispoMail(env, {
        predmet: message.headers.get("subject") || "",
        od: message.from || "",
        text: extrahujTextMailu(raw),
        msgId: message.headers.get("message-id") || "",
      });
      if (v && v.navrh) {
        const upozornenie = upozorniNaDispo(env, v);
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(upozornenie);
        else await upozornenie;
      }
    } catch (e) {
      console.log("dispo mail zlyhal:", e && e.message);
    }
  },
};
