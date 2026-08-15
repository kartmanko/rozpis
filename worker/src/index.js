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
 *   POST /dispo/odoslat/nahlad -> zostaví mail z ručne poskladanej dispo, ale NEPOŠLE ho (vedúci a admin)
 *   POST /dispo/odoslat        -> pošle ten istý mail cez Resend (vedúci a admin) — appka volá toto
 *                                  vždy až po tom, čo človek uvidel náhľad a odoslanie potvrdil
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
  writeUsers,
  synchronizujPouzivatelovZKontaktov,
  ROLE_KEYS,
  rovnakeTajomstvo,
  logJeIbaDoplneny,
  uzavierkyValidna,
  nadcasVUzavretomMesiaci,
  LOG_MAX,
  posliMail,
} from "./auth.js";
import { vapidKluce, ulozOdber, zmazOdber, posliVsetkym } from "./push.js";
import { sKesou, kesovane, prepisKes, zabudniKes } from "./kes.js";
import { zaradDoRadu } from "./rad.js";

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
// "kontakty" = databáza kontaktov štábu a externých ľudí (dodávatelia, technika).
//              Interní majú crewId (prepojenie na stĺpec v rozpise), externí iba
//              meno/funkciu/mail/telefón — slúžia na napovedanie pri dispo mailoch
//              a na klik-na-zavolanie/napísať. Zatiaľ sa NEPOUŽÍVA ako zoznam,
//              kto sa smie prihlásiť — to je stále "users_v1" (samostatné, viď auth.js).
// "uzavierky" = uzávierky mesiacov + história vyplateného (sekcia 6 finálneho briefu).
//              Zoznam UDALOSTÍ, nie stav jedného mesiaca — rovnako ako "log" sú to
//              prílohové záznamy, ktoré sa nedajú prepísať ani zmazať (viď auth.js,
//              uzavierkyValidna). Uzavretím mesiaca sa zmrazí výkaz každého v štábe
//              PRESNE taký, aký bol v tú chvíľu (aj keby sa neskôr zmenili sadzby) —
//              to je ten "dôkaz pri duálnom režime" z briefu. Zrušiť sa dá iba
//              označením "zrusene" (natrvalo), nikdy tichým zmazaním.
// "denneRoly" = denné role (sekcia 4 finálneho briefu), kľúč = deň "YYYY-MM-DD".
//              Pre daný deň appka pamätá, kto je hlavný režisér (najviac jeden) a
//              kto sú Story produceri (viacero naraz). Na rozdiel od "uzavierky"
//              toto NIE JE prílohový audit záznam — je to bežné nastavenie, dá sa
//              kedykoľvek prepísať (napr. keď sa deň preplánuje), preto sa tu
//              nekontroluje nemennosť histórie, iba tvar (viď ocistiDenneRoly).
const EMPTY_STATE = { crew: [], cells: {}, nad: {}, sadzby: {}, chaty: {}, reporty: {}, dispo: {}, pendingDispo: [], kontakty: [], uzavierky: [], denneRoly: [], log: [], pendingHook: [], version: 0 };

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

/* Bootstrap (vyrobNovy=false, "vyrob mi kód, ak ešte žiadny nie je") mal ten
   istý problém ako prvé generovanie VAPID kľúča (viď vapidKluce v push.js):
   dve súbežné GET /bridge/token skôr, než kód vôbec prvýkrát vznikol, mohli
   OBE vidieť prázdne KV a OBE si vyrobiť VLASTNÝ nový kód — druhý zápis by
   ten prvý ticho prepísal a prvému volajúcemu by ostal zobrazený kód, ktorý
   v skutočnosti už nikdy nebude platiť (a nemal by ako zistiť prečo mu
   čítačka s "jeho" kódom nefunguje). Rovnaký zdieľaný front, rovnaká rýchla
   cesta mimo zámku pre bežný prípad (kód už existuje). */
async function bridgeToken(env, vyrobNovy = false) {
  if (!vyrobNovy) {
    const ulozeny = await precitajBridgeToken(env);
    if (ulozeny) return ulozeny;
  }
  return zaradDoRadu(async () => {
    if (!vyrobNovy) {
      const znova = await env.ROZPIS_KV.get(BRIDGE_TOKEN_KEY);
      if (znova) { prepisKes(env, BRIDGE_TOKEN_KEY, znova); return znova; }
    }
    const kod = novyKod();
    await env.ROZPIS_KV.put(BRIDGE_TOKEN_KEY, kod);
    prepisKes(env, BRIDGE_TOKEN_KEY, kod);
    return kod;
  });
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

// zaradDoRadu (spoločný rad na sériové "prečítaj, over, zapíš" nad KV) je teraz
// v rad.js — dôvod aj podrobnosti sú v komentári tam. Dôležité: users_v1 zapisuje
// aj POST /auth/users (auth.js, handlePostUsers) — preto musí ísť o TEN ISTÝ,
// zdieľaný rad, nie o vlastný lokálny v tomto module.

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
const MAX_KONTAKTOV = 500; // koľko kontaktov si server pamätá
const MAX_KONTAKT_POLE = 200; // dĺžka mena/funkcie/mailu/telefónu jedného kontaktu
const MAX_UZAVIEROK = 300; // koľko uzávierkových udalostí si server pamätá (celá sezóna aj so zrušeniami)
const MAX_VYPLATENYCH_POLOZIEK = 500; // koľko ľudí smie mať jedna uzávierka vo výplate (strop veľkosti štábu)
const MAX_UZAVIERKA_POLE = 200; // dĺžka mena/e-mailu/profesie v jednej položke uzávierky
const MAX_RIADKOV_VYPLATENIA = 120; // dní v podrobnom rozpise jedného človeka v jednej uzávierke, s rezervou nad dĺžku sezóny
const MAX_DENNE_ROLY = 400; // jeden záznam na deň, s rezervou nad dĺžku sezóny
const MAX_STORY_PRODUCENTOV_DNA = 20; // strop na počet Story producerov v jednom dni

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

/* Kontakt smie mať iba tieto polia — rovnaký dôvod ako pri ocistiBunky vyššie.
   "interny" prepája na crewId (človek zo štábu); externí (Jimmy Jib, ShowService…)
   crewId nemajú, sú to iba meno + kontakt na napovedanie a mail. */
export function ocistiKontakty(arr) {
  const out = [];
  for (const k of arr) {
    if (!k || typeof k !== "object") continue;
    const meno = String(k.meno || "").trim().slice(0, MAX_KONTAKT_POLE);
    if (!meno) continue;
    out.push({
      id: String(k.id || "k" + Math.random().toString(36).slice(2, 10)).slice(0, 60),
      meno,
      funkcia: String(k.funkcia || "").trim().slice(0, MAX_KONTAKT_POLE),
      mail: String(k.mail || "").trim().slice(0, MAX_KONTAKT_POLE),
      telefon: String(k.telefon || "").trim().slice(0, MAX_KONTAKT_POLE),
      interny: !!k.interny,
      crewId: k.interny && k.crewId ? String(k.crewId).slice(0, 60) : null,
      aktivny: k.aktivny !== false,
      // Rola pre allowlist (sekcia 10 briefu) — má zmysel iba pri interných
      // kontaktoch s mailom; pozri synchronizujPouzivatelovZKontaktov v auth.js.
      rola: k.interny && ROLE_KEYS.includes(k.rola) ? k.rola : "",
    });
  }
  // Appka nové kontakty vždy pridáva na koniec zoznamu — pri strope preto
  // zahodíme tie NAJSTARŠIE (na začiatku), nie ten, čo práve pribudol. Pôvodne
  // sa orezávalo hneď pri prvom dosiahnutí stropu (break v cykle vyššie), čo
  // zahadzovalo najnovšie položky vrátane tej, kvôli ktorej človek práve ukladal.
  return out.length > MAX_KONTAKTOV ? out.slice(out.length - MAX_KONTAKTOV) : out;
}

/* Uzávierka mesiaca (sekcia 6 briefu) smie mať iba tieto polia — rovnaký dôvod
   ako pri ocistiBunky/ocistiKontakty vyššie. Číselné sumy sú v centoch (rovnaká
   jednotka ako zvyšok výpočtu peňazí, viď src/vykazy.js). Poradie a obsah
   existujúcich záznamov (okrem "zrusene") kontroluje uzavierkyValidna v auth.js —
   toto tu je iba tvar jednej položky, nie kontrola nemennosti histórie.

   Zámerne tu NEOREZÁVAME na MAX_UZAVIEROK: appka nové uzávierky vždy pridáva
   na koniec zoznamu, takže orezanie zhora (ako kedysi cez `break` tu) by pri
   dosiahnutí stropu ticho zahodilo práve tú uzávierku, kvôli ktorej človek
   ukladal — a keďže zvyšok poľa by ostal identický, uzavierkyValidna v
   handlePostData by to nerozoznala od žiadnej zmeny a vrátila by 200, akoby
   sa uzávierka uložila. Orezanie zdola (zahodiť najstaršie) by zas narazilo
   na tú istú kontrolu opačne — vždy by ju zhodilo ako pokus prepísať históriu.
   Strop sa preto kontroluje samostatne v handlePostData, kde sa dá vrátiť
   jasná chyba namiesto ticho stratenej alebo ticho odmietnutej uzávierky. */
// Nezáporné celé číslo (počty smien/Duelov/dní v jednej položke vyplatenia).
const nezaporneCele = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);

// Jeden deň v podrobnom rozpise jednej vyplatenej položky (VykazyPanel.jsx,
// DetailDni) — rovnaký tvar, aký vracia vykazOsoby v src/vykazy.js.
function ocistiRiadokVyplatenia(r) {
  if (!r || typeof r !== "object") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(r.iso || "")) ? r.iso : "";
  if (!iso) return null;
  return {
    iso,
    popis: String(r.popis || "").slice(0, 60),
    hodiny: nezaporneCele(r.hodiny),
    hodinyBezSmeny: nezaporneCele(r.hodinyBezSmeny),
    zakladC: Number.isFinite(Number(r.zakladC)) ? Math.round(Number(r.zakladC)) : 0,
    nadcasC: Number.isFinite(Number(r.nadcasC)) ? Math.round(Number(r.nadcasC)) : 0,
    spoluC: Number.isFinite(Number(r.spoluC)) ? Math.round(Number(r.spoluC)) : 0,
  };
}

export function ocistiUzavierky(arr) {
  const out = [];
  for (const u of arr) {
    if (!u || typeof u !== "object") continue;
    const mesiac = /^\d{4}-\d{2}$/.test(String(u.mesiac || "")) ? u.mesiac : "";
    const ked = String(u.ked || "").slice(0, 40);
    if (!mesiac || !ked) continue;
    const vyplatene = (Array.isArray(u.vyplatene) ? u.vyplatene : [])
      .slice(0, MAX_VYPLATENYCH_POLOZIEK)
      .map((v) => {
        const zaklad = {
          crewId: String(v?.crewId || "").slice(0, 60),
          meno: String(v?.meno || "").slice(0, MAX_UZAVIERKA_POLE),
          profesia: String(v?.profesia || "").slice(0, 40),
          hodiny: Number.isFinite(Number(v?.hodiny)) ? Math.max(0, Number(v.hodiny)) : 0,
          zakladC: Number.isFinite(Number(v?.zakladC)) ? Math.round(Number(v.zakladC)) : 0,
          nadcasC: Number.isFinite(Number(v?.nadcasC)) ? Math.round(Number(v.nadcasC)) : 0,
          spoluC: Number.isFinite(Number(v?.spoluC)) ? Math.round(Number(v.spoluC)) : 0,
        };
        // Podrobný rozpis dní (riadky) a počty pribudli neskôr — staršie
        // uzávierky ho nemajú a MUSIA ho aj naďalej nemať (nie ako prázdne
        // pole), inak by appka nevedela rozlíšiť "nikdy sa neukladal" od
        // "uložil sa, ale v tomto období naozaj nič nebolo" (viď maRiadky
        // v src/vykazy.js, vykazZoZmrazenia). Preto sa polia pridajú iba
        // vtedy, keď ich klient naozaj poslal.
        if (!Array.isArray(v?.riadky)) return zaklad;
        return {
          ...zaklad,
          riadky: v.riadky.map(ocistiRiadokVyplatenia).filter(Boolean).slice(0, MAX_RIADKOV_VYPLATENIA),
          pocetSmien: nezaporneCele(v?.pocetSmien),
          pocetDuelov: nezaporneCele(v?.pocetDuelov),
          pocetKombi: nezaporneCele(v?.pocetKombi),
          pocetOff: nezaporneCele(v?.pocetOff),
          pocetPlatenychDni: nezaporneCele(v?.pocetPlatenychDni),
        };
      });
    out.push({
      id: String(u.id || "uz" + Math.random().toString(36).slice(2, 10)).slice(0, 60),
      mesiac,
      ked,
      kym: {
        email: String(u.kym?.email || "").slice(0, MAX_UZAVIERKA_POLE),
        name: String(u.kym?.name || "").slice(0, MAX_UZAVIERKA_POLE),
      },
      vyplatene,
      zrusene: u.zrusene ? String(u.zrusene).slice(0, 40) : null,
    });
  }
  return out;
}

/* Denné role (sekcia 4 finálneho briefu) smú mať iba tieto polia — rovnaký dôvod
   ako pri ocistiBunky/ocistiKontakty vyššie. Jeden deň = jeden záznam (kľúčované
   podľa "iso", nie zoznam udalostí ako pri uzávierkach) — druhé uloženie pre ten
   istý deň jednoducho prepíše predchádzajúce priradenie, to je zámer.

   Appka pri úprave dňa, ktorý už záznam mal, ten starý zmaže a nový pridá na
   koniec zoznamu (viď ulozDennuRolu v App.jsx) — zoznam je teda zoradený podľa
   toho, kedy sa ktorý deň naposledy menil, nie podľa dátumu. Pri strope preto
   nesmie ostať prvých MAX_DENNE_ROLY dní (to by pri opakovanej úprave tých
   istých pár dní časom zahodilo úplne všetky ostatné) — necháva sa naposledy
   dotknutých MAX_DENNE_ROLY dní. */
export function ocistiDenneRoly(arr) {
  const podla = new Map();
  for (const d of arr) {
    if (!d || typeof d !== "object") continue;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(d.iso || "")) ? d.iso : "";
    if (!iso) continue;
    const storyProduceri = [...new Set(
      (Array.isArray(d.storyProduceri) ? d.storyProduceri : []).map((c) => String(c).slice(0, 60)),
    )].slice(0, MAX_STORY_PRODUCENTOV_DNA);
    // re-set namiesto set na existujúci kľúč, nech si aj pri duplicite v
    // rovnakom poli zoznam poradia drží "naposledy dotknuté" na konci.
    // re-set namiesto set na existujúci kľúč, nech si aj pri duplicite v
    // rovnakom poli zoznam poradia drží "naposledy dotknuté" na konci.
    podla.delete(iso);
    podla.set(iso, { iso, reziser: d.reziser ? String(d.reziser).slice(0, 60) : null, storyProduceri });
  }
  if (podla.size > MAX_DENNE_ROLY) {
    const isa = [...podla.keys()].slice(0, podla.size - MAX_DENNE_ROLY);
    isa.forEach((iso) => podla.delete(iso));
  }
  return [...podla.values()];
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

  /* Prečítanie aktuálneho stavu až po overenie verzie a zápis (readState ...
     writeState nižšie) sa zaradí do radu (viď zaradDoRadu vyššie) — bez toho
     by dve súbežné uloženia mohli obe vychádzať z tej istej verzie a druhé by
     ticho prepísalo prvé, aj keď obe prešli kontrolou baseVersion. */
  return zaradDoRadu(() => handlePostDataZamknute(body, user, env));
}

async function handlePostDataZamknute(body, user, env) {
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
    kontakty: Array.isArray(body.kontakty) ? ocistiKontakty(body.kontakty) : current.kontakty,
    uzavierky: Array.isArray(body.uzavierky) ? ocistiUzavierky(body.uzavierky) : current.uzavierky,
    denneRoly: Array.isArray(body.denneRoly) ? ocistiDenneRoly(body.denneRoly) : current.denneRoly,
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

  /* Uzávierky mesiacov (sekcia 6 briefu) sú "dôkaz pri duálnom režime" — rovnaký
     dôvod ako pri histórii vyššie, kontroluje sa preto rovnako tu (mimo
     checkStateChange, ktoré admina vyššie preskočí) a platí to aj pre admina. */
  if (!uzavierkyValidna(current.uzavierky, next.uzavierky)) {
    return json({ error: "Uzávierky sa nedajú prepísať ani zmazať, iba zrušiť (a to natrvalo)." }, 403, env);
  }

  /* Strop na počet uzávierok (MAX_UZAVIEROK) sa zámerne nerieši tichým orezaním
     v ocistiUzavierky vyššie (viď komentár tam) — pri append-only histórii by
     orezanie muselo buď potichu zahodiť práve uloženú uzávierku, alebo vyzerať
     ako pokus prepísať históriu. Radšej jasná chyba, nech človek vie, že treba
     zasiahnuť ručne (v tomto rozsahu ide prakticky vždy o chybu vstupu, nie o
     bežné použitie — jedna sezóna reálne spraví rádovo desiatky záznamov). */
  if (next.uzavierky.length > MAX_UZAVIEROK) {
    return json({ error: `Uzávierok je už ${MAX_UZAVIEROK} — ďalšiu server neuloží, ozvi sa vývojárovi.` }, 413, env);
  }

  /* Nadčas v uzavretom mesiaci sa nedá zmeniť, kým sa uzávierka nezruší — rovnako
     mimo checkStateChange, aby to platilo aj pre admina (viď auth.js). */
  const zamknutyMesiac = nadcasVUzavretomMesiaci(current, next);
  if (zamknutyMesiac) {
    return json({ error: `Nadčas za ${zamknutyMesiac} je uzavretý — mesiac treba najprv zrušiť.` }, 403, env);
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

  /* Kontakty ako zdroj allowlistu (sekcia 10 briefu) — keď sa zmenili kontakty,
     bezpečne dopočítať users_v1 (viď synchronizujPouzivatelovZKontaktov v
     auth.js). Robí sa to AŽ PO úspešnom uložení rozpisu a iba keď sa kontakty
     naozaj zmenili, nech sa zbytočne nezapisuje do KV pri každom uložení. */
  if (JSON.stringify(next.kontakty) !== JSON.stringify(current.kontakty)) {
    const users = await readUsers(env);
    const synced = synchronizujPouzivatelovZKontaktov(next.kontakty, users);
    if (JSON.stringify(synced) !== JSON.stringify(users)) {
      await writeUsers(env, synced);
    }
  }

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

/**
 * Spracuje JEDNU správu proti danému stavu a vráti { vysledok, mutacie }.
 * "mutacie" sú čiastkové zmeny, ktoré volajúci poskladá do jedného zápisu —
 * táto funkcia sama do KV nič nezapisuje, aby sa dala volať pre celú dávku
 * správ naraz s jedným spoločným čítaním aj zápisom stavu (viď handlePostHook).
 */
async function spracujHookSpravu(env, state, msg) {
  // groupId je starý názov toho istého poľa — nechávam ho, nech starší bridge nespadne
  const { msgId, chatId: chatIdRaw, groupId, chatName, phone, sender, text, bridgeId } = msg;
  const chatId = String(chatIdRaw || groupId || "").slice(0, 120);

  if (!text || !String(text).trim()) {
    return { vysledok: { ignored: true, reason: "prázdny text" } };
  }

  /* Tú istú správu dostaneme dvakrát vždy, keď bežia dva bridge (Fly.io + naska).
     Pečiatku kontrolujeme HNEĎ na začiatku, ešte pred čítaním textu modelom —
     nemá zmysel platiť dvakrát za to isté. Táto pečiatka sa zapisuje rovno
     (nie cez spoločný zápis na konci dávky) — musí byť vidieť hneď pre ďalšiu
     správu v tej istej dávke aj pre druhý bridge, ktorý môže volať súbežne.

     "Prečítaj a zapíš" tu donedávna nebolo atomické — dva bridge, ktoré doručia
     tú istú správu naozaj súčasne, mohli obaja vidieť pečiatku ešte nezapísanú
     a obaja pokračovať ďalej. Pri zápise do buniek (match vyššie) by to bolo
     neškodné (skladá sa na čerstvý stav tesne pred zápisom), ale pri reporte
     aj pri neznámom telefóne (nižšie) kontrola "už existuje" beží proti stavu
     prečítanému NA ZAČIATKU dávky — druhé, súbežné volanie ho ešte nevidí, a
     keďže obe vytvárajú záznam s vlastným náhodným id, výsledkom by boli dva
     reporty alebo dva záznamy vo fronte za tú istú správu. Zaradenie do radu
     (rad.js) to serializuje: druhé volanie uvidí pečiatku už zapísanú a skončí
     ako duplicate skôr, než by čokoľvek vytvorilo. Funkcia sa volá len tu
     (handlePostHook), nie zvnútra iného radu. */
  const msgKey = msgId ? "hookmsg:" + String(msgId).slice(0, 120) : "";
  if (msgKey) {
    const uzSpracovane = await zaradDoRadu(async () => {
      if (await env.ROZPIS_KV.get(msgKey)) return true;
      await env.ROZPIS_KV.put(msgKey, bridgeId || "1", { expirationTtl: HOOKMSG_TTL });
      return false;
    });
    if (uzSpracovane) {
      return { vysledok: { duplicate: true, reason: "správu už spracoval druhý bridge" } };
    }
  }

  /* Neznámy chat sa NIKDY nečíta. Iba sa zapíše do zoznamu, aby si ho admin
     v appke videl a mohol ho zapnúť. Toto je to isté pravidlo ako pri neznámom
     telefónnom čísle: radšej nech appka navrhne, než aby konala sama. */
  // "dostupnost" = kto kedy nemôže (Fáza 3), "report" = denný report réžie (Fáza 4)
  let druhChatu = "dostupnost";
  const chaty = state.chaty || {};
  const zaznam = chaty[chatId];
  const menoChatu = String(chatName || "").slice(0, 120);
  let mutacie = {};

  if (chatId && !zaznam && Object.keys(chaty).length >= MAX_CHATOV) {
    // rovnaký strop ako pri ohlásení čítačky — zoznam skupín nesmie rásť donekonečna
    return { vysledok: { ignored: true, reason: "zoznam skupín je plný" } };
  }
  if (chatId && !zaznam) {
    const novyZaznam = {
      id: chatId,
      nazov: menoChatu || "(bez názvu)",
      povoleny: false,
      prvyKrat: new Date().toISOString(),
      poslednaSprava: new Date().toISOString(),
    };
    return {
      vysledok: { chatUnknown: true, chatId, reason: "chat ešte nie je zapnutý" },
      mutacie: { chatyPatch: { [chatId]: novyZaznam }, logRiadok: `WhatsApp bridge: nový chat „${menoChatu || chatId}" — čaká na zapnutie adminom` },
    };
  }
  if (chatId && !zaznam.povoleny) {
    return { vysledok: { ignored: true, reason: "chat je vypnutý" } };
  }
  if (chatId && (zaznam.nazov !== menoChatu && menoChatu)) {
    // názov skupiny sa dá premenovať — drž ho aktuálny, ale kvôli tomu neruš nič iné
    mutacie = { chatyPatch: { [chatId]: { ...zaznam, nazov: menoChatu, poslednaSprava: new Date().toISOString() } } };
  }
  if (zaznam && zaznam.druh === "report") druhChatu = "report";

  /* ---------- Fáza 4: chat s dennými reportami ----------
     Jedna správa = jeden report. Obsah sa nerozoberá, iba sa k nemu nájde deň:
     najprv sa skúsi dátum priamo z textu, a keď tam nie je, použije sa dátum,
     kedy správa prišla. Report sa nikam nezapisuje do rozpisu — iba sa uloží
     a ukáže pri tom dni. */
  if (druhChatu === "report") {
    const prisloDna = datumSpravy(msg.ts);
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

    const reportyDoteraz = state.reporty || {};
    // druhý bridge doručí tú istú správu — poistka aj bez pečiatky v KV
    if (msgId && Object.values(reportyDoteraz).some((r) => r.msgId === String(msgId).slice(0, 120))) {
      return { vysledok: { duplicate: true, reason: "report už je uložený" }, mutacie };
    }

    const id = "rep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const zaznamReportu = {
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
    // strop na počet reportov (MAX_REPORTOV) sa teraz rieši až v handlePostHook,
    // po zlúčení tejto (a všetkých ostatných správ dávky) pridaných reportov s
    // ČERSTVÝM stavom — tu sa iba pridáva, nikdy nemaže.

    return {
      vysledok: { report: true, id, datum, zdrojDatumu: zdroj },
      mutacie: {
        ...mutacie,
        reportyPatch: { [id]: zaznamReportu },
        logRiadok: `Report na ${datum}${zdroj === "sprava" ? " (dátum podľa dňa doručenia)" : ""} — ${String(sender || "neznámy").slice(0, 40)}`,
      },
    };
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
    return { vysledok: { error: "Nepodarilo sa spracovať text správy: " + e.message }, chyba502: true, mutacie };
  }

  // jeIso() — modelu sa dátum nedá veriť naslepo, rovnako ako pri REPORT_DATE_PROMPT
  // vyššie. Bez tejto kontroly by zle tvarovaný dátum (napr. bez nuly na začiatku dňa)
  // skončil rovno v kľúči bunky ("iso|crewId") a appka, ktorá bunky vyrába iba pre
  // skutočné dni sezóny, by ho nikde nezobrazila — nahlásené "nemôže" by sa tak
  // potichu stratilo, hoci log aj odpoveď bridgeu by hlásili, že sa zapísalo.
  const unavailable = (Array.isArray(parsed.unavailable) ? parsed.unavailable : []).filter(jeIso);
  const correctedAvailable = (Array.isArray(parsed.correctedAvailable) ? parsed.correctedAvailable : []).filter(jeIso);
  const noRestrictions = Boolean(parsed.noRestrictions);
  const isCorrection = Boolean(parsed.isCorrection);

  if (!unavailable.length && !correctedAvailable.length && !noRestrictions) {
    return { vysledok: { ignored: true, reason: "správa nerieši dostupnosť" }, mutacie };
  }

  const match = matchCrewByPhone(state.crew, phone);

  if (match) {
    // telefón poznáme -> rovno zapíš (nikdy nezapisuj pri neznámom telefóne)
    // cellPatches je RIEDKY náhľad (kľúč -> nová hodnota, alebo null = zmazať) —
    // nie kópia celého "cells". Vďaka tomu sa dá bezpečne poskladať na ČERSTVÝ
    // stav tesne pred zápisom (viď handlePostHook), aj keby súbežne niekto z
    // appky upravil INÚ bunku. cur() vidí zmeny tejto istej správy urobené o
    // riadok vyššie (napr. keby unavailable aj correctedAvailable mali ten istý
    // deň — nemalo by sa to stať, ale poistka nič nestojí).
    const PRAZDNA = { off: false, shift: null, duel: false, note: "", nadcas: 0 };
    const cellPatches = {};
    const cur = (k) => (k in cellPatches ? cellPatches[k] : (state.cells || {})[k]) || PRAZDNA;
    unavailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      cellPatches[k] = { ...cur(k), off: true };
    });
    correctedAvailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      const next = { ...cur(k), off: false };
      const empty = !next.off && !next.shift && !next.duel && !next.note && !Number(next.nadcas);
      cellPatches[k] = empty ? null : next; // null = zmazať pri skladaní na čerstvý stav
    });
    const bits = [];
    if (noRestrictions) bits.push("bez obmedzení");
    if (unavailable.length) bits.push(`${unavailable.length} dní nemôže`);
    if (correctedAvailable.length) bits.push(`${correctedAvailable.length} dní opravených (znova môže)`);
    return {
      vysledok: { matched: true, crewId: match.id },
      mutacie: { ...mutacie, cellPatches, logRiadok: `WhatsApp bridge: ${match.name} — ${bits.join(", ") || "žiadna zmena"}` },
    };
  }

  // neznámy telefón -> NIKDY nezapisuj priamo, iba zaraď do fronty na potvrdenie adminom
  const pendingHookDoteraz = state.pendingHook || [];
  const uzVoFronte = msgId && pendingHookDoteraz.some((e) => e.msgId && e.msgId === msgId);
  if (uzVoFronte) {
    // druhá poistka proti dvom bridgeom — pečiatka v KV mohla ešte nebyť vidieť
    return { vysledok: { duplicate: true, reason: "správa už je vo fronte" }, mutacie };
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
  // pendingHookNove je iba TÁTO nová položka — pri skladaní na čerstvý stav v
  // handlePostHook sa prepojí na čerstvo prečítanú frontu, nie na túto (možno
  // zastaranú) kópiu.
  return { vysledok: { queued: true, id: entry.id }, mutacie: { ...mutacie, pendingHookNove: [entry] } };
}

/* Bridge pošle jednu alebo viac správ naraz (dávka = "messages"). Staršia appka
   posiela jednu správu ako ploché pole priamo v tele požiadavky — to sa tu berie
   ako dávka s jednou položkou, nech starý bridge nespadne.

   Prečo dávka: pri reštarte bridgeu (alebo hocijakej krátkej odmlke) príde naraz
   desiatky správ zo zmeškaného obdobia. Predtým každá spravila vlastné čítanie
   aj zápis celého rozpisu do KV — pri dennom strope zápisov to appku vedelo
   položiť skôr, než sa dostala k obedu. Teraz sa celý rozpis číta a zapisuje
   NAJVIAC RAZ na dávku, nech je v nej správ koľkokoľvek. Pečiatka proti
   duplicitám (druhý bridge) sa aj tak zapisuje za každú správu zvlášť — to sa
   obísť nedá, keď má fungovať aj naprieč dvomi súbežnými bridgeami. */
async function handlePostHook(request, env) {
  if (!(await checkHookSecret(request, env))) return json({ error: "Neplatný alebo chýbajúci X-Hook-Secret." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const dávka = Array.isArray(body.messages) ? body.messages : [body];
  if (!dávka.length) return json({ ok: true, vysledky: [] }, 200, env);

  // bridge sa každou dávkou hlási, že žije
  if (body.bridgeId) await bridgePing(env, body.bridgeId, { stav: "beží" });

  const state = await readState(env);
  /* Mutácie z celej dávky sa vedú RIEDKO (iba to, čo sa naozaj dotklo), nie
     ako kópie celých polí "cells"/"chaty"/"reporty"/"pendingHook" — vďaka
     tomu sa dajú tesne pred zápisom bezpečne poskladať na ČERSTVO prečítaný
     stav (viď nižšie), nie iba na ten spred LLM volaní. Keby sa niesli plné
     kópie polí (ako predtým), aj druhé čítanie tesne pred zápisom by bolo na
     nič — čerstvé pole by sa aj tak celé prepísalo starou kópiou pre
     ktorékoľvek pole, ktorého sa dávka dotkla. */
  let cellPatches = {};   // "iso|crewId" -> nová bunka, alebo null = zmazať
  let chatyPatch = {};    // chatId -> záznam chatu
  let reportyPatch = {};  // id -> záznam reportu (dávka iba pridáva, nikdy nemaže)
  let pendingHookNove = []; // nové položky frontu z tejto dávky, najnovšia prvá
  const logRiadky = [];
  const vysledky = [];
  let chyba502 = false;

  for (const surova of dávka) {
    const msg = body.bridgeId && !surova.bridgeId ? { ...surova, bridgeId: body.bridgeId } : surova;
    // ďalšia správa v tej istej dávke musí vidieť mutácie tých pred ňou (napr.
    // dve správy od toho istého človeka v rovnakej dávke sa nesmú prepísať) —
    // preto sa riedke mutácie doterajších správ poskladajú na pôvodný "state"
    // len pre POTREBY SPRACOVANIA tejto dávky (priebežný náhľad), nie pre
    // záverečný zápis (ten použije čerstvý stav, viď nižšie).
    const priebeznyCells = { ...state.cells };
    for (const [k, v] of Object.entries(cellPatches)) { if (v === null) delete priebeznyCells[k]; else priebeznyCells[k] = v; }
    const priebeznyStav = {
      ...state,
      cells: priebeznyCells,
      chaty: { ...state.chaty, ...chatyPatch },
      reporty: { ...state.reporty, ...reportyPatch },
      pendingHook: [...pendingHookNove, ...(state.pendingHook || [])],
    };
    const { vysledok, mutacie: m } = await spracujHookSpravu(env, priebeznyStav, msg);
    vysledky.push(vysledok);
    if (vysledok?.error) chyba502 = true;
    if (m) {
      const { logRiadok, chatyPatch: cp, reportyPatch: rp, cellPatches: clp, pendingHookNove: phn } = m;
      if (cp) chatyPatch = { ...chatyPatch, ...cp };
      if (rp) reportyPatch = { ...reportyPatch, ...rp };
      if (clp) cellPatches = { ...cellPatches, ...clp };
      if (phn && phn.length) pendingHookNove = [...phn, ...pendingHookNove];
      if (logRiadok) logRiadky.push(logRiadok);
    }
  }

  const maZmeny = Object.keys(cellPatches).length || Object.keys(chatyPatch).length
    || Object.keys(reportyPatch).length || pendingHookNove.length || logRiadky.length;

  if (maZmeny) {
    /* Medzi čítaním na začiatku tejto dávky a zápisom tu mohlo prejsť aj
       desiatky sekúnd (LLM volanie na každú správu v dávke) — počas toho
       mohol niekto z appky bežne uložiť /data (napr. zmenu v štábe, sadzbách,
       kontaktoch, ale pokojne aj v tej istej bunke rozpisu alebo tej istej
       fronte, ktorej sa dotkla táto dávka). Preto sa tesne pred zápisom číta
       znova (rovnaký dôvod ako druhé čítanie v spracujDispoMail nižšie) a
       riedke mutácie z tejto dávky sa poskladajú na ČERSTVÝ stav — nielen pre
       polia, ktorých sa dávka nedotkla (tie by aj plná kópia ochránila), ale
       aj pre cells/chaty/reporty/pendingHook, ktorých sa dávka priamo dotýka.
       zabudniKes je nutný — bez neho by readState vrátil z medzipamäte TEJTO
       ISTEJ požiadavky presne to isté (zastarané) čítanie ako na začiatku.

       Samotné "čítaj znova a zapíš" (od zabudniKes po writeState) sa navyše
       zaradí do radu (zaradDoRadu, viď handlePostData) — bez toho by aj toto
       druhé, "čerstvé" čítanie mohlo naraziť na súbežný zápis niekoho iného
       (appka, iný bridge, dispo mail) presne v tej istej medzere. */
    const next = await zaradDoRadu(async () => {
      zabudniKes(env, STATE_KEY);
      const cerstvyStav = await readState(env);

      const cells = { ...cerstvyStav.cells };
      for (const [k, v] of Object.entries(cellPatches)) { if (v === null) delete cells[k]; else cells[k] = v; }

      const chaty = { ...cerstvyStav.chaty, ...chatyPatch };

      const reporty = { ...cerstvyStav.reporty, ...reportyPatch };
      // strop na počet reportov sa počíta až TERAZ, na zlúčenom (čerstvom) stave
      const kluceReportov = Object.keys(reporty);
      if (kluceReportov.length > MAX_REPORTOV) {
        kluceReportov
          .sort((a, b) => String(reporty[a].prislo).localeCompare(String(reporty[b].prislo)))
          .slice(0, kluceReportov.length - MAX_REPORTOV)
          .forEach((k) => delete reporty[k]);
      }

      const pendingHook = [...pendingHookNove, ...(cerstvyStav.pendingHook || [])].slice(0, 200);

      const log = [...logRiadky.map((text) => ({ t: new Date().toISOString(), text })).reverse(), ...cerstvyStav.log].slice(0, 400);
      const zapisany = { ...cerstvyStav, cells, chaty, reporty, pendingHook, log, version: cerstvyStav.version + 1 };
      await writeState(env, zapisany);
      return zapisany;
    });
    // dávka s jednou správou dostane rovnakú odpoveď ako predtým (bridge na to spolieha v logoch)
    if (!Array.isArray(body.messages)) return json({ ...vysledky[0], version: next.version }, chyba502 ? 502 : 200, env);
    return json({ ok: true, vysledky, version: next.version }, chyba502 ? 502 : 200, env);
  }

  if (!Array.isArray(body.messages)) return json(vysledky[0], chyba502 ? 502 : 200, env);
  return json({ ok: true, vysledky }, chyba502 ? 502 : 200, env);
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
     za sebou, čo bolo pri ohlásení každú minútu zbytočné míňanie KV.
     Čítanie aj prípadný zápis sa zaradí do radu (zaradDoRadu, viď handlePostData)
     — bez toho by dve ping-ovania (alebo appka a ping) mohli súbežne prečítať tú
     istú verziu a druhý zápis by ticho prepísal prvý. */
  const skupiny = Array.isArray(body.skupiny) ? body.skupiny.slice(0, 200) : [];
  const state = await zaradDoRadu(async () => {
    let s = await readState(env);
    if (skupiny.length) {
      const chaty = { ...(s.chaty || {}) };
      let zmena = false;
      for (const sk of skupiny) {
        const id = String(sk?.id || "").slice(0, 120);
        if (!id) continue;
        const nazov = String(sk?.nazov || "").slice(0, 120) || "(bez názvu)";
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
        s = { ...s, chaty, version: s.version + 1 };
        await writeState(env, s);
      }
    }
    return s;
  });

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

  // čítanie aj zápis do radu (zaradDoRadu, viď handlePostData) — bez toho by
  // súbežný zápis niekoho iného medzi čítaním a zápisom tu mohol ticho zaniknúť.
  const zmazane = await zaradDoRadu(async () => {
    const state = await readState(env);
    const vsetky = Object.values(state.chaty || {});
    const ostavaju = {};
    for (const c of vsetky) if (c?.povoleny) ostavaju[c.id] = c;
    const pocet = vsetky.length - Object.keys(ostavaju).length;
    if (!pocet) return 0;

    const log = [
      { t: new Date().toISOString(), text: `Zoznam WhatsApp skupín prečistený (${pocet}) — ${user.email}` },
      ...(state.log || []),
    ].slice(0, 400);
    await writeState(env, { ...state, chaty: ostavaju, log, version: state.version + 1 });
    return pocet;
  });
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

  // Ten istý mail môže doraziť dvakrát (preposlanie, opakované doručenie) —
  // na rozdiel od hookmsg:<id> v spracujHookSpravu (kde je opakovanie
  // neškodné, lebo výsledná zmena je idempotentná) tu KAŽDÝ prechod pridáva
  // NOVÝ návrh s vlastným náhodným id do pendingDispo, takže "prečítaj a
  // označ" bez zámku by pri súbežnom doručení mohlo nechať prejsť oboje a
  // ten istý mail by sa v appke ukázal dvakrát. Zámerne sa do frontu
  // zaraďuje iba táto rýchla kontrola (KV get+put), nie celá funkcia —
  // volanie na Anthropic nižšie trvá aj sekundy a nemá zmysel ním blokovať
  // všetky ostatné zápisy do KV.
  const kluc = msgId ? "dispomail:" + String(msgId).slice(0, 160) : "";
  if (kluc) {
    const uzSpracovany = await zaradDoRadu(async () => {
      if (await env.ROZPIS_KV.get(kluc)) return true;
      await env.ROZPIS_KV.put(kluc, "1", { expirationTtl: HOOKMSG_TTL });
      return false;
    });
    if (uzSpracovany) return { duplicate: true, reason: "tento mail už bol spracovaný" };
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

  // čítanie ešte raz, tesne pred zápisom — medzi state0 vyššie a týmto miestom
  // mohlo LLM volanie zabrať aj sekundy, počas ktorých mohol niekto iný bežne
  // uložiť appku. zabudniKes je nutný: bez neho by readState vrátil z
  // medzipamäte TEJTO ISTEJ požiadavky presne to isté (zastarané) čítanie ako
  // state0, akoby sa v KV odvtedy nič nezmenilo, a táto poistka by nič
  // nechránila. Samotné "čítaj znova a zapíš" sa navyše zaradí do radu
  // (zaradDoRadu, viď handlePostData) — aj toto druhé čítanie by inak mohlo
  // naraziť na súbežný zápis niekoho iného presne v tej istej medzere.
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

  const next = await zaradDoRadu(async () => {
    zabudniKes(env, STATE_KEY);
    const state = await readState(env);
    const pendingDispo = [navrh, ...(state.pendingDispo || [])].slice(0, MAX_PENDING_DISPO);
    const log = [
      { t: new Date().toISOString(), text: `Dispo mail na ${navrh.datum}${precitane ? "" : " (nepodarilo sa prečítať — iba text)"} — čaká na potvrdenie` },
      ...state.log,
    ].slice(0, 400);
    const zapisany = { ...state, pendingDispo, log, version: state.version + 1 };
    await writeState(env, zapisany);
    return zapisany;
  });

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

/* ---------- builder dispozícií — admin skladá dispo priamo v appke (sekcia 2 briefu) ----------
   Doteraz appka vedela iba PRIJAŤ dispo mail a dať ho na potvrdenie (handleDispoMail vyššie).
   Toto je opačný smer: admin/vedúci zostaví dispo v appke a appka z tých istých dát:
     1. ju uloží ku dňu (POST /data, rovnaká cesta ako pri potvrdení mailu — bez zmeny),
     2. vie ju poslať mailom štábu, ktorý v ten deň pracuje.
   Automatický mail sa NIKDY neposiela sám od seba — appka najprv vždy ukáže náhľad
   (POST /dispo/odoslat/nahlad) a odoslanie (POST /dispo/odoslat) je vždy samostatný,
   vedomý krok. To je jedno z pevných pravidiel appky, nie len tohto endpointu. */

const SK_DOW = ["nedeľa", "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota"];
const MAX_HARMONOGRAM_POLOZIEK = 60;
const MAX_SKUPIN = 20;
const MAX_LUDI_V_SKUPINE = 60;
const MAX_DALSICH_PRIJEMCOV = 30;
const MAX_TEXT_POLE = 4000;

function ocistiBlokDispo(body) {
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum || "")) ? body.datum : "";
  const harmonogram = (Array.isArray(body.harmonogram) ? body.harmonogram : [])
    .slice(0, MAX_HARMONOGRAM_POLOZIEK)
    .map((h) => ({ cas: String(h?.cas || "").slice(0, 10), text: String(h?.text || "").slice(0, 200) }))
    .filter((h) => h.cas || h.text);
  const skupiny = (Array.isArray(body.skupiny) ? body.skupiny : [])
    .slice(0, MAX_SKUPIN)
    .map((s) => ({
      nazov: String(s?.nazov || "").slice(0, 80),
      ludia: (Array.isArray(s?.ludia) ? s.ludia : []).slice(0, MAX_LUDI_V_SKUPINE).map((id) => String(id).slice(0, 60)),
    }))
    .filter((s) => s.nazov || s.ludia.length);
  const zvyraznene = (Array.isArray(body.zvyraznene) ? body.zvyraznene : []).slice(0, 200).map((id) => String(id).slice(0, 60));
  const dalsiPrijemcovia = (Array.isArray(body.dalsiPrijemcovia) ? body.dalsiPrijemcovia : [])
    .slice(0, MAX_DALSICH_PRIJEMCOV)
    .map((m) => String(m || "").trim().toLowerCase())
    .filter((m) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
  return {
    datum,
    miesto: String(body.miesto || "").slice(0, MAX_TEXT_POLE),
    pocasie: String(body.pocasie || "").slice(0, 200),
    poznamky: String(body.poznamky || "").slice(0, MAX_TEXT_POLE),
    harmonogram,
    skupiny,
    zvyraznene,
    dalsiPrijemcovia,
  };
}

/** Meno človeka zo štábu podľa crewId — do mailu aj do zoznamu príjemcov. */
function crewMeno(crew, crewId) {
  return (crew || []).find((c) => String(c.id) === String(crewId))?.name || "";
}

/** Mail pre daného crewId z databázy kontaktov — iba interné, iba keď majú mail vyplnený. */
function crewMail(kontakty, crewId) {
  const k = (kontakty || []).find((x) => x.interny && String(x.crewId) === String(crewId) && x.aktivny !== false);
  return k?.mail ? String(k.mail).trim() : "";
}

/** Komu sa dispo pošle: mail každého zo skupín (podľa databázy kontaktov) + ručne dopísaní. */
function dispoPrijemcovia(blok, kontakty) {
  const mnozina = new Map(); // mail (lowercase) -> mail (pôvodný tvar)
  for (const s of blok.skupiny) {
    for (const crewId of s.ludia) {
      const mail = crewMail(kontakty, crewId);
      if (mail) mnozina.set(mail.toLowerCase(), mail);
    }
  }
  for (const mail of blok.dalsiPrijemcovia) mnozina.set(mail.toLowerCase(), mail);
  return [...mnozina.values()];
}

function renderDispoMail(blok, crew, denneRoly) {
  const d = new Date(blok.datum + "T00:00:00Z");
  const denText = Number.isNaN(d.getTime())
    ? blok.datum
    : `${SK_DOW[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
  const subject = `Dispozícia — ${denText}`;

  // Denné role (sekcia 5 briefu) — kto ten deň šéfuje, do hlavičky dispa.
  const dennaRola = (denneRoly || []).find((r) => r.iso === blok.datum);
  const reziserDna = dennaRola?.reziser ? crewMeno(crew, dennaRola.reziser) : "";
  const storyDna = (dennaRola?.storyProduceri || []).map((id) => crewMeno(crew, id)).filter(Boolean);
  const denneRolyText = [reziserDna && `Režisér: ${reziserDna}`, storyDna.length && `Story: ${storyDna.join(", ")}`].filter(Boolean).join(" · ");

  const riadkyHarmonogram = blok.harmonogram.map((h) => `${h.cas ? h.cas + " — " : ""}${h.text}`);
  const skupinyText = blok.skupiny
    .filter((s) => s.ludia.length)
    .map((s) => {
      const mena = s.ludia.map((id) => {
        const meno = crewMeno(crew, id) || "(neznámy)";
        return blok.zvyraznene.includes(id) ? `${meno} *` : meno;
      });
      return `${s.nazov || "(bez názvu)"}: ${mena.join(", ")}`;
    });

  const textCasti = [
    `Dispozícia — ${denText}`,
    denneRolyText,
    blok.miesto ? `Miesto: ${blok.miesto}` : "",
    blok.pocasie ? `Počasie: ${blok.pocasie}` : "",
    riadkyHarmonogram.length ? "Harmonogram:\n" + riadkyHarmonogram.join("\n") : "",
    skupinyText.length ? "Kto pracuje:\n" + skupinyText.join("\n") : "",
    blok.poznamky ? `Poznámky:\n${blok.poznamky}` : "",
  ].filter(Boolean);
  const text = textCasti.join("\n\n");

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const html = `<!doctype html><html lang="sk"><body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e7e5e4;">
      <h1 style="margin:0 0 4px;font-size:20px;color:#1c1917;">Dispozícia</h1>
      <p style="margin:0 0 18px;font-size:14px;color:#78716c;text-transform:capitalize;">${escapeHtml(denText)}</p>
      ${denneRolyText ? `<p style="margin:0 0 14px;font-size:14px;color:#44403c;">${escapeHtml(denneRolyText)}</p>` : ""}
      ${blok.miesto || blok.pocasie ? `<p style="margin:0 0 14px;font-size:14px;color:#44403c;">${[blok.miesto && `<b>Miesto:</b> ${escapeHtml(blok.miesto)}`, blok.pocasie && `<b>Počasie:</b> ${escapeHtml(blok.pocasie)}`].filter(Boolean).join(" &nbsp;·&nbsp; ")}</p>` : ""}
      ${riadkyHarmonogram.length ? `<div style="margin:0 0 16px;"><div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#a8a29e;margin-bottom:6px;">Harmonogram</div>${riadkyHarmonogram.map((r) => `<div style="font-size:14px;color:#292524;padding:2px 0;">${escapeHtml(r)}</div>`).join("")}</div>` : ""}
      ${skupinyText.length ? `<div style="margin:0 0 16px;"><div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#a8a29e;margin-bottom:6px;">Kto pracuje</div>${skupinyText.map((r) => `<div style="font-size:14px;color:#292524;padding:2px 0;">${escapeHtml(r)}</div>`).join("")}</div>` : ""}
      ${blok.poznamky ? `<div style="font-size:13px;color:#57534e;white-space:pre-wrap;border-top:1px solid #e7e5e4;padding-top:14px;">${escapeHtml(blok.poznamky)}</div>` : ""}
    </div>
  </div>
</body></html>`;

  return { subject, html, text };
}

async function handlePostDispoOdoslatNahlad(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  if (!roleCaps(user.role).pending) return json({ error: "Na odosielanie dispo mailov nemáš právo." }, 403, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  const blok = ocistiBlokDispo(body);
  if (!blok.datum) return json({ error: "Chýba platný dátum." }, 400, env);

  const state = await readState(env);
  const prijemcovia = dispoPrijemcovia(blok, state.kontakty);
  const { subject, html, text } = renderDispoMail(blok, state.crew, state.denneRoly);
  return json({ subject, html, text, prijemcovia }, 200, env);
}

async function handlePostDispoOdoslat(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "unauthenticated" }, 401, env);
  if (!roleCaps(user.role).pending) return json({ error: "Na odosielanie dispo mailov nemáš právo." }, 403, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  const blok = ocistiBlokDispo(body);
  if (!blok.datum) return json({ error: "Chýba platný dátum." }, 400, env);

  const state = await readState(env);
  const prijemcovia = dispoPrijemcovia(blok, state.kontakty);
  if (!prijemcovia.length) {
    return json({ error: "Nemá komu prísť mail — nikto zo skladby dňa nemá mail v databáze kontaktov." }, 400, env);
  }
  const { subject, html, text } = renderDispoMail(blok, state.crew, state.denneRoly);

  try {
    await posliMail(env, { to: prijemcovia, subject, html, text });
  } catch (e) {
    console.log("odoslanie dispo mailu zlyhalo:", e && e.message);
    return json({ error: "Odoslanie zlyhalo: " + (e && e.message ? e.message : "neznáma chyba") }, 502, env);
  }
  return json({ ok: true, poslaneNa: prijemcovia }, 200, env);
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

  let komu = Array.isArray(body.komu) && body.komu.length ? body.komu.map(String) : null;
  // Bez výslovne vymenovaných príjemcov ide o rozoslanie celému štábu — "celý
  // štáb" ale musí byť live zoznam z users_v1, nie surovo VŠETKY odbery uložené
  // v KV (nacitajOdbery(env, null) by inak vrátilo aj telefóny ľudí, ktorých
  // niekto v Prístupoch vypol tlačidlom "Vypnúť" — tí by upozornenia dostávali
  // donekonečna, kým si appku fyzicky neodinštalujú). Rovnaký filter už
  // používa upozorniNaDispo nižšie.
  if (!komu) {
    const users = await readUsers(env);
    komu = users.filter((u) => u.active !== false).map((u) => u.email).filter(Boolean);
  }

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
  // --- builder dispozícií — admin skladá a posiela dispo z appky (sekcia 2 briefu) ---
  if (url.pathname === "/dispo/odoslat/nahlad" && request.method === "POST") {
    return handlePostDispoOdoslatNahlad(request, env);
  }
  if (url.pathname === "/dispo/odoslat" && request.method === "POST") {
    return handlePostDispoOdoslat(request, env);
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
