/**
 * FÁZA 1 — Prihlásenie (magic link) a role.
 *
 * Prihlasovanie je bez hesiel: používateľ zadá svoj e-mail, príde mu odkaz,
 * klikne naň a je prihlásený na 90 dní. Odkaz platí 20 minút a dá sa použiť
 * iba raz.
 *
 * Kľúče v KV:
 *   users_v1        -> zoznam používateľov [{ id, email, name, role, crewId, active }]
 *   authlog_v1      -> posledných 200 prihlásení (história, kto a kedy)
 *   magic:<hash>    -> { email } — jednorazový prihlasovací token (TTL 20 min)
 *   sess:<hash>     -> { userId, email } — session (TTL 90 dní)
 *   rate:<hash>     -> počet žiadostí o odkaz pre daný e-mail (TTL 1 hodina)
 *
 * Do KV sa nikdy neukladá samotný token, iba jeho SHA-256 odtlačok — keby
 * niekto videl obsah KV, prihlásiť sa s ním nedá.
 */

import { kesovane, prepisKes } from "./kes.js";
import { zaradDoRadu } from "./rad.js";

/* ---------- role ---------- */

/* Finálna mapa rolí (sekcia 4 briefu): hlavný admin + traja "menší admini" podľa
   sekcie rozpisu (kamera / produkcia / réžia+Story+loggeri) + štáb + viewer.
   Predtým sa volali kamera_lead/rezia_lead/produkcny — premenované na
   kamera_admin/rezia_admin/produkcia_admin, práva a rozsah ostávajú rovnaké ako
   predtým, iba mená. Staré hodnoty uložené v KV z čias pred premenovaním sa
   prekladajú automaticky pri každom čítaní (viď LEGACY_ROLE_MAP a readUsers). */
export const ROLE_KEYS = ["admin", "kamera_admin", "rezia_admin", "produkcia_admin", "stab", "viewer"];

// Staré role -> nové, prekladá sa pri každom readUsers() (nie je to jednorazová
// migrácia dát v KV, appka sa sama uzdraví aj keby sa users_v1 nikdy neprepísal).
const LEGACY_ROLE_MAP = { kamera_lead: "kamera_admin", rezia_lead: "rezia_admin", produkcny: "produkcia_admin" };

export const ROLE_LABELS = {
  admin: "Hlavný admin",
  kamera_admin: "Admin kamery",
  rezia_admin: "Admin réžie, Story a loggerov",
  produkcia_admin: "Admin produkcie",
  stab: "Štáb",
  viewer: "Viewer",
};

// Ktoré profesie (stĺpce rozpisu) smie rola prepisovať celé — päť sekcií štábu
// (sekcia 2 briefu): kamera, réžia, Story produceri, loggeri, produkcia. Admin
// réžie spravuje réžiu, Story aj loggerov naraz (tri sekcie), admin produkcie
// svoju vlastnú sekciu "produkcia" (runneri, asistenti, vedúci produkcie — NIE
// prázdna sekcia, to bola chyba v prvej verzii tejto mapy rolí).
const ROLE_SECTIONS = {
  admin: ["kamera", "rezia", "story", "logger", "produkcia"],
  kamera_admin: ["kamera"],
  rezia_admin: ["rezia", "story", "logger"],
  produkcia_admin: ["produkcia"],
  stab: [],
  viewer: [],
};

// Ostatné práva.
// "sadzby" = meniť denné sadzby profesií (Fáza 2). Sú to peniaze, preto ich smie
//            prepisovať iba hlavný admin a admin produkcie — sekční admini nie.
// "vykazVsetkych" = vidieť výkazy celého štábu, nielen svoj vlastný.
// "reporty" = vidieť a spracovať denné reporty (sekcia 3 finálneho briefu — reporty
//             smú čítať iba réžia/loggeri/Story, nie kamera). "rezia_admin" pokrýva
//             réžiu, loggerov aj Story (viď ROLE_SECTIONS aj jeho nová menovka
//             vyššie). "produkcia_admin" má reporty ponechané z čias, keď zastupoval
//             ešte neexistujúcu rolu Story producer — teraz je to skôr "aj produkcia
//             má vidieť, čo sa deje" než nutnosť.
// "denneRoly" = prideľovať pre konkrétny deň hlavného režiséra a Story producerov
//               (nová "denná" rola, sekcia 4 briefu — pozor, NIE je to to isté ako
//               trvalá rola v ROLE_KEYS; je to iba priradenie na jeden deň, appka
//               si ho pamätá v samostatnom poli "denneRoly", viď index.js).
const ROLE_CAPS = {
  admin: { crew: true, nad: true, pending: true, ownOff: true, users: true, sadzby: true, vykazVsetkych: true, reporty: true, denneRoly: true },
  kamera_admin: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true, reporty: false, denneRoly: false },
  rezia_admin: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true, reporty: true, denneRoly: true },
  produkcia_admin: { crew: false, nad: true, pending: false, ownOff: true, users: false, sadzby: true, vykazVsetkych: true, reporty: true, denneRoly: true },
  stab: { crew: false, nad: false, pending: false, ownOff: true, users: false, sadzby: false, vykazVsetkych: false, reporty: false, denneRoly: false },
  viewer: { crew: false, nad: false, pending: false, ownOff: false, users: false, sadzby: false, vykazVsetkych: false, reporty: false, denneRoly: false },
};

export function roleCaps(role) {
  return ROLE_CAPS[role] || ROLE_CAPS.viewer;
}

/* ---------- pomocné ---------- */

const USERS_KEY = "users_v1";
const AUTHLOG_KEY = "authlog_v1";
const SESSION_COOKIE = "f18_sess";
const SESSION_TTL = 90 * 24 * 60 * 60; // 90 dní v sekundách
const MAGIC_TTL = 20 * 60; // 20 minút
const RATE_TTL = 60 * 60; // 1 hodina
const RATE_MAX = 6; // najviac 6 odkazov na e-mail za hodinu

export const normEmail = (s) => String(s || "").trim().toLowerCase();

/* Porovnanie tajomstiev v konštantnom čase — pri hesle a pri kóde pre čítačku
   sa neoplatí dávať útočníkovi do rúk ani to, ako ďaleko sa jeho tip zhoduje.
   Bežné === skončí pri prvom rozdielnom znaku a ten rozdiel v čase sa dá
   odmerať a heslo si tak uhádnuť znak po znaku. */
export function rovnakeTajomstvo(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let rozdiel = 0;
  for (let i = 0; i < a.length; i++) rozdiel |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdiel === 0;
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

function sessionCookie(env, token, maxAge) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (env.COOKIE_DOMAIN) bits.push(`Domain=${env.COOKIE_DOMAIN}`);
  return bits.join("; ");
}

export function clearCookieHeader(env) {
  return sessionCookie(env, "", 0);
}

/* ---------- používatelia ---------- */

/* Zoznam ľudí sa v jednej požiadavke čítal aj dvakrát — raz pri overení
   prihlásenia (getSessionUser) a hneď potom v samotnom endpointe. Kešuje sa
   surový text a iba na tú jednu požiadavku (viď kes.js). */
export async function readUsers(env) {
  const raw = await kesovane(env, USERS_KEY, () => env.ROZPIS_KV.get(USERS_KEY));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // preklad starých rolí (kamera_lead/rezia_lead/produkcny) na nové mená —
    // viď LEGACY_ROLE_MAP vyššie; robí sa tu, nie iba pri uložení, nech sa appka
    // sama uzdraví aj bez toho, aby niekto znova uložil zoznam používateľov.
    return parsed.map((u) => (u && LEGACY_ROLE_MAP[u.role] ? { ...u, role: LEGACY_ROLE_MAP[u.role] } : u));
  } catch (e) {
    // Poškodený users_v1 by inak znamenal, že sa naraz odhlási celý štáb a
    // nikto by nevedel prečo — nech je to aspoň vidno v logu.
    console.log("users_v1 sa nedá rozobrať ako JSON:", e && e.message);
    return [];
  }
}

export async function writeUsers(env, users) {
  const text = JSON.stringify(users);
  await env.ROZPIS_KV.put(USERS_KEY, text);
  prepisKes(env, USERS_KEY, text);
}

function sanitizeUser(u) {
  const role = ROLE_KEYS.includes(u.role) ? u.role : "viewer";
  return {
    id: String(u.id || "u_" + randomToken().slice(0, 10)),
    email: normEmail(u.email),
    name: String(u.name || "").slice(0, 80),
    role,
    crewId: u.crewId ? String(u.crewId) : null,
    active: u.active !== false,
    // Musí prežiť aj ručné uloženie v "Prístupy" (napr. zapnutie/vypnutie iného
    // človeka v tom istom zozname) — inak by prvé ďalšie uloženie tohto panela
    // vymazalo príznak vytvorenia zo synchronizácie s kontaktami (viď
    // synchronizujPouzivatelovZKontaktov nižšie) a synchronizácia by od tej
    // chvíle ticho prestala deaktivovať ľudí, ktorým medzitým zmizol kontakt —
    // presne ten druh nenápadnej bezpečnostnej medzery, ktorej sa treba vyhnúť.
    zdrojKontakt: !!u.zdrojKontakt,
  };
}

export function findUser(users, email) {
  const e = normEmail(email);
  return users.find((u) => normEmail(u.email) === e) || null;
}

/* ---------- databáza kontaktov ako zdroj allowlistu (sekcia 10 + 4 briefu) ----------

   Brief, sekcia 10: "Tento zoznam [kontaktov] je zdrojom allowlistu — kto v ňom má
   mail a rolu, dostane pozývací magic link." Predtým bola prihlasovacia allowlist
   (users_v1) úplne samostatná od databázy kontaktov, spravovaná ručne v paneli
   "Prístupy" — bolo to zámerne dočasné, kým nebude hotová finálna mapa rolí
   (sekcia 4), aby sa to nemuselo prerábať dvakrát. Tá je už hotová, takže teraz
   sa users_v1 pri každom uložení kontaktov DOPĹŇA (nie prepisuje) podľa nich.

   Pravidlá (opatrne, nech sa nikto omylom nezamkne von):
   - iba interní kontakty s vyplneným mailom A priradenou rolou sa berú do úvahy,
   - kontakt so "aktivny: false" zruší prístup, ale iba používateľovi, ktorého
     kedysi vytvoril/spravoval TENTO mechanizmus (pozná sa podľa "zdrojKontakt: true")
     — ručne pridaných ľudí v "Prístupy" sa táto synchronizácia nikdy nedotkne,
   - nikdy nedeaktivuje posledného aktívneho hlavného admina (rovnaká poistka
     ako v handlePostUsers nižšie) — keby k tomu malo dôjsť, synchronizácia sa
     pre toho človeka jednoducho preskočí a users_v1 ostane, aký bol. */
export function synchronizujPouzivatelovZKontaktov(kontakty, existingUsers) {
  const users = existingUsers.map((u) => ({ ...u }));
  const byEmail = new Map(users.map((u) => [normEmail(u.email), u]));

  const oprávnené = new Map(); // normEmail -> kontakt
  for (const k of kontakty || []) {
    if (!k?.interny || !k.mail || !k.rola) continue;
    if (!ROLE_KEYS.includes(k.rola)) continue;
    if (k.aktivny === false) continue; // vypnutý kontakt = zrušený prístup, viď komentár vyššie
    oprávnené.set(normEmail(k.mail), k);
  }

  // 1) doplniť/aktualizovať podľa oprávnených kontaktov
  for (const [email, k] of oprávnené) {
    const existujuci = byEmail.get(email);
    if (existujuci) {
      existujuci.role = k.rola;
      existujuci.crewId = k.crewId ? String(k.crewId) : existujuci.crewId;
      existujuci.name = k.meno || existujuci.name;
      existujuci.active = true;
      existujuci.zdrojKontakt = true;
    } else {
      const novy = {
        id: "u_" + randomToken().slice(0, 10),
        email,
        name: k.meno || "",
        role: k.rola,
        crewId: k.crewId ? String(k.crewId) : null,
        active: true,
        zdrojKontakt: true,
      };
      users.push(novy);
      byEmail.set(email, novy);
    }
  }

  // 2) deaktivovať tých, čo túto synchronizáciu kedysi vytvorila/spravovala,
  //    ale už nie sú medzi oprávnenými (kontakt zmizol, deaktivoval sa, alebo
  //    stratil rolu) — okrem poslednej ostávajúcej aktívnej admin poistky.
  const pocetAktivnychAdminov = users.filter((u) => u.role === "admin" && u.active !== false).length;
  let aktivnychAdminovOstava = pocetAktivnychAdminov;
  for (const u of users) {
    if (!u.zdrojKontakt || u.active === false) continue;
    if (oprávnené.has(normEmail(u.email))) continue;
    if (u.role === "admin" && aktivnychAdminovOstava <= 1) continue; // poistka
    if (u.role === "admin") aktivnychAdminovOstava--;
    u.active = false;
  }

  return users;
}

/* ---------- história prihlásení ---------- */

async function appendAuthLog(env, text) {
  let list = [];
  try {
    list = JSON.parse((await env.ROZPIS_KV.get(AUTHLOG_KEY)) || "[]");
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list = [{ t: new Date().toISOString(), text }, ...list].slice(0, 200);
  await env.ROZPIS_KV.put(AUTHLOG_KEY, JSON.stringify(list));
}

export async function readAuthLog(env) {
  try {
    const list = JSON.parse((await env.ROZPIS_KV.get(AUTHLOG_KEY)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.log("authlog_v1 sa nedá rozobrať ako JSON:", e && e.message);
    return [];
  }
}

/* ---------- session ---------- */

/**
 * Vráti prihláseného používateľa alebo null.
 * Núdzový prístup: hlavička X-Admin-Password stále funguje ako plný admin,
 * aby sa hlavný admin nikdy nemohol vyzamknúť z appky.
 */
export async function getSessionUser(request, env) {
  const pw = request.headers.get("X-Admin-Password") || "";
  if (env.ADMIN_PASSWORD && rovnakeTajomstvo(pw, env.ADMIN_PASSWORD)) {
    return { id: "break_glass", email: "", name: "Núdzový admin", role: "admin", crewId: null, active: true, breakGlass: true };
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const raw = await env.ROZPIS_KV.get("sess:" + (await sha256hex(token)));
  if (!raw) return null;
  let sess;
  try {
    sess = JSON.parse(raw);
  } catch {
    return null;
  }

  const users = await readUsers(env);
  const user = users.find((u) => u.id === sess.userId) || findUser(users, sess.email);
  if (!user || user.active === false) return null;
  return user;
}

/* ---------- odosielanie mailu (Resend) ---------- */

/** Miesto v databáze, kde môže byť uložený kľúč na odosielanie mailov. */
export const MAIL_KEY_KV = "nastavenie:mail_key";

/**
 * Kľúč na odosielanie mailov. Prednosť má tajomstvo nastavené v Cloudflare,
 * záložne sa berie z databázy (tam ho vloží jednorazová príprava servera).
 */
export async function mailKey(env) {
  if (env.RESEND_API_KEY) return env.RESEND_API_KEY;
  return (await env.ROZPIS_KV.get(MAIL_KEY_KV)) || "";
}

/**
 * Pošle jeden mail cez Resend. Spoločné miesto pre magic-link prihlásenie aj
 * pre odoslanie dispozície (sekcia 2 briefu) — nech je tajomstvo (mailKey) aj
 * ošetrenie chyby na jednom mieste, nie duplikované v každom volajúcom.
 */
export async function posliMail(env, { to, subject, html, text }) {
  const apiKey = await mailKey(env);
  if (!apiKey) throw new Error("Kľúč na odosielanie mailov nie je nastavený na serveri.");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "FARMA rozpis <farma@kartmanko.cc>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error("Resend odmietol mail: " + t.slice(0, 300));
  }
}

async function sendMagicMail(env, email, link) {
  const html = `<!doctype html><html lang="sk"><body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e7e5e4;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#1c1917;">FARMA 18 — rozpis štábu</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#44403c;">
        Klikni na tlačidlo a budeš prihlásený. Odkaz platí 20 minút a dá sa použiť iba raz.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${link}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-size:15px;font-weight:600;">Prihlásiť sa</a>
      </p>
      <p style="margin:0 0 6px;font-size:13px;color:#78716c;">Ak tlačidlo nefunguje, skopíruj si tento odkaz:</p>
      <p style="margin:0 0 20px;font-size:12px;color:#57534e;word-break:break-all;">${link}</p>
      <p style="margin:0;font-size:13px;color:#78716c;">Ak si o prihlásenie nežiadal, tento mail pokojne ignoruj.</p>
    </div>
  </div>
</body></html>`;

  await posliMail(env, {
    to: email,
    subject: "Prihlásenie do rozpisu FARMA 18",
    html,
    text: `Prihlásenie do rozpisu FARMA 18\n\nOtvor tento odkaz (platí 20 minút):\n${link}\n\nAk si o prihlásenie nežiadal, mail ignoruj.`,
  });
}

/* ---------- endpointy ---------- */

/** POST /auth/request  { email } -> pošle prihlasovací odkaz */
export async function handleAuthRequest(request, env, json) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const email = normEmail(body.email);
  // jednoduchá kontrola tvaru — presnú validitu overí až doručenie mailu
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Zadaj platnú e-mailovú adresu." }, 400, env);
  }

  // Obmedzenie počtu žiadostí, aby sa nedal nikomu zaspamovať mail. "Prečítaj
  // počet, over limit, zapíš +1" bolo donedávna bez poistky — pár súbežných
  // žiadostí (napr. dvojklik alebo automatický retry) mohlo všetky vychádzať
  // z toho istého starého počtu a limit tak o pár volaní prekĺznuť. Zaradenie
  // do rovnakého frontu ako ostatné zápisy (rad.js) to serializuje; funkcia
  // sa volá len tu, nie zvnútra iného frontu, takže niet rizika zacyklenia.
  const rateKey = "rate:" + (await sha256hex(email));
  const zamietnute = await zaradDoRadu(async () => {
    const count = Number((await env.ROZPIS_KV.get(rateKey)) || 0);
    if (count >= RATE_MAX) return true;
    await env.ROZPIS_KV.put(rateKey, String(count + 1), { expirationTtl: RATE_TTL });
    return false;
  });
  if (zamietnute) {
    return json({ error: "Priveľa pokusov. Skús to o hodinu, alebo napíš adminovi." }, 429, env);
  }

  const users = await readUsers(env);
  const user = findUser(users, email);
  const isBootstrap = users.length === 0 && email === normEmail(env.BOOTSTRAP_ADMIN_EMAIL);
  const allowed = (user && user.active !== false) || isBootstrap;

  // Nikdy neprezradíme, či e-mail v systéme existuje — odpoveď je vždy rovnaká.
  if (!allowed) return json({ ok: true }, 200, env);

  const token = randomToken();
  await env.ROZPIS_KV.put(
    "magic:" + (await sha256hex(token)),
    JSON.stringify({ email, bootstrap: isBootstrap }),
    { expirationTtl: MAGIC_TTL }
  );

  const appUrl = (env.APP_URL || "https://farma.kartmanko.cc").replace(/\/+$/, "");
  const link = `${appUrl}/?login=${encodeURIComponent(token)}`;

  try {
    await sendMagicMail(env, email, link);
  } catch (e) {
    return json({ error: "Mail sa nepodarilo odoslať: " + e.message }, 502, env);
  }

  return json({ ok: true }, 200, env);
}

/** POST /auth/verify  { token } -> nastaví session cookie */
export async function handleAuthVerify(request, env, json, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const token = String(body.token || "");
  if (!token) return json({ error: "Chýba prihlasovací token." }, 400, env);

  // "Prečítaj a zmaž" nebolo atomické — dva súbežné /auth/verify s tým istým
  // tokenom (napr. mailový klient, čo si odkaz sám otvorí na "kontrolu", a
  // hneď za tým človek) mohli oba vidieť token ešte nezmazaný a oba by sa
  // prihlásili z JEDNÉHO odkazu, ktorý mal byť jednorazový. Zaradenie do
  // rovnakého frontu (rad.js) zaručí, že token spotrebuje najviac jeden
  // volajúci; funkcia sa volá len tu, nie zvnútra iného frontu.
  const magicKey = "magic:" + (await sha256hex(token));
  const raw = await zaradDoRadu(async () => {
    const r = await env.ROZPIS_KV.get(magicKey);
    if (r) await env.ROZPIS_KV.delete(magicKey); // jednorazové použitie
    return r;
  });
  if (!raw) return json({ error: "Prihlasovací odkaz je neplatný alebo už vypršal. Vyžiadaj si nový." }, 401, env);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Poškodený prihlasovací odkaz." }, 400, env);
  }

  const email = normEmail(data.email);
  let users = await readUsers(env);
  let user = findUser(users, email);

  // prvý prihlásený (kým je zoznam prázdny) sa stáva hlavným adminom
  if (!user && users.length === 0 && email === normEmail(env.BOOTSTRAP_ADMIN_EMAIL)) {
    user = sanitizeUser({ email, name: "Hlavný admin", role: "admin" });
    users = [user];
    await writeUsers(env, users);
    // appendAuthLog robí vlastný read-modify-write nad authlog_v1 bez zámku —
    // dve súbežné prihlásenia (bežné, keď viacero ľudí klikne na prihlasovací
    // odkaz naraz) by mohli obe vychádzať z toho istého pôvodného zoznamu a
    // to neskoršie zapísanie by ticho zahodilo záznam toho skoršieho. Zaradenie
    // do rovnakého frontu ako pri iných zápisovateľoch (viď rad.js) to serializuje.
    // appendAuthLog samo osebe zámok NEPOUŽÍVA (volá sa aj zvnútra frontu
    // vyššie v handlePostUsers — vlastný zámok by tam spôsobil zacyklenie).
    await zaradDoRadu(() => appendAuthLog(env, `Vytvorený prvý účet (hlavný admin): ${email}`));
  }

  if (!user || user.active === false) {
    return json({ error: "Tento e-mail nemá prístup. Požiadaj admina o pridanie." }, 403, env);
  }

  const sessToken = randomToken();
  await env.ROZPIS_KV.put(
    "sess:" + (await sha256hex(sessToken)),
    JSON.stringify({ userId: user.id, email: user.email, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL }
  );
  // Viď komentár pri bootstrap-adminovi vyššie — rovnaká poistka proti
  // súbežným prihláseniam, ktoré by si inak mohli ticho prepísať navzájom
  // svoj záznam v histórii.
  await zaradDoRadu(() => appendAuthLog(env, `Prihlásenie: ${user.name || user.email}`));

  return new Response(JSON.stringify({ user: publicUser(user) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": sessionCookie(env, sessToken, SESSION_TTL),
      ...corsHeaders(env),
    },
  });
}

/** GET /auth/me -> kto som */
export async function handleAuthMe(request, env, json) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ user: null }, 200, env);
  return json({ user: publicUser(user), caps: roleCaps(user.role) }, 200, env);
}

/** POST /auth/logout -> zmaže session */
export async function handleAuthLogout(request, env, corsHeaders) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.ROZPIS_KV.delete("sess:" + (await sha256hex(token)));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearCookieHeader(env),
      ...corsHeaders(env),
    },
  });
}

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    crewId: u.crewId || null,
    active: u.active !== false,
    // Nech admin v paneli "Prístupy" vidí, že tohto človeka sem dopísala
    // synchronizácia s kontaktami (sekcia 10 briefu), nie on sám ručne —
    // inak by mu nový riadok mohol pripadať ako duch/chyba appky.
    zdrojKontakt: !!u.zdrojKontakt,
  };
}

/* Odtlačok aktuálneho zoznamu používateľov — rovnaký účel ako "version" pri
   /data (optimistic concurrency), len bez potreby počítadla v KV. Používa sa
   na to, aby POST /auth/users vedel zistiť, že medzitým niekto INÝ (najčastejšie
   automatická synchronizácia s kontaktami z POST /data, ale aj iná otvorená
   session toho istého admina) zapísal users_v1 zmenu, o ktorej klient, čo
   práve odosiela svoj formulár, ešte nevie. */
async function usersHash(users) {
  return sha256hex(JSON.stringify(users.map(publicUser)));
}

/** GET /auth/users -> zoznam používateľov (iba admin) */
export async function handleGetUsers(request, env, json) {
  const me = await getSessionUser(request, env);
  if (!me || !roleCaps(me.role).users) return json({ error: "Na správu používateľov nemáš právo." }, 403, env);
  const users = await readUsers(env);
  return json({ users: users.map(publicUser), log: await readAuthLog(env), hash: await usersHash(users) }, 200, env);
}

/** POST /auth/users  { users: [...], baseHash } -> uloží zoznam (iba admin) */
export async function handlePostUsers(request, env, json) {
  const me = await getSessionUser(request, env);
  if (!me || !roleCaps(me.role).users) return json({ error: "Na správu používateľov nemáš právo." }, 403, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }
  if (!Array.isArray(body.users)) return json({ error: "Chýba zoznam používateľov." }, 400, env);

  const seen = new Set();
  const users = [];
  for (const raw of body.users.slice(0, 300)) {
    const u = sanitizeUser(raw);
    if (!u.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) {
      return json({ error: `Neplatný e-mail: ${u.email || "(prázdny)"}` }, 400, env);
    }
    if (seen.has(u.email)) return json({ error: `E-mail je v zozname dvakrát: ${u.email}` }, 400, env);
    seen.add(u.email);
    users.push(u);
  }

  // poistka: vždy musí zostať aspoň jeden aktívny hlavný admin
  if (!users.some((u) => u.role === "admin" && u.active !== false)) {
    return json({ error: "V zozname musí zostať aspoň jeden aktívny hlavný admin." }, 400, env);
  }

  /* Rovnaká poistka ako pri /data (viď rad.js): users_v1 zapisuje aj POST /data,
     keď sa zmenia kontakty (synchronizujPouzivatelovZKontaktov v index.js). Bez
     zaradenia do TOHO ISTÉHO radu by admin, čo práve niekomu zrušil prístup tu,
     a súbežné uloženie kontaktov mohli obaja prečítať tú istú verziu users_v1 —
     a ten, kto zapíše druhý, by ticho prepísal zmenu prístupu, ktorú admin práve
     urobil, bez akejkoľvek chyby či upozornenia.

     Rad sám osebe ale nestačí: appka posiela CELÝ výsledný zoznam (nie iba to,
     čo sa zmenilo), takže aj sériovo zoradený zápis by ticho prepísal medzičasom
     pribudnutú zmenu (napr. synchronizáciu z kontaktov), keby admin vychádzal zo
     staršieho snímku. Preto sa — rovnako ako baseVersion pri /data — porovná
     odtlačok zoznamu, z ktorého klient vychádzal (baseHash), s tým, čo je v KV
     naozaj TERAZ (čerstvo prečítané vnútri radu) — a pri nezhode sa namiesto
     ticho prepísania vráti 409 s aktuálnym zoznamom, nech si to appka poskladá
     alebo aspoň nezahodí cudziu zmenu bez varovania.

     Na rozdiel od baseVersion pri /data sa "baseHash" kontroluje, iba KEĎ ho
     klient pošle — appka (UsersPanel.jsx) ho posiela vždy, ale toto je JEDINÝ
     endpoint, na ktorom bola predtým žiadna takáto kontrola, takže ho môžu
     volať aj iné, staršie integrácie, ktoré o odtlačku nevedia. Vynútiť ho aj
     im by znamenalo, že by odteraz vždy dostali 409 — teda by prestali fungovať
     úplne, čo je horšie než pôvodné (nechránené) správanie, ktoré aspoň niečo
     zapísalo. Skutočný prehliadačový klient je chránený vždy (posiela ho vždy),
     ostatní volajúci majú rovnaké správanie ako predtým. */
  const vysledok = await zaradDoRadu(async () => {
    const cerstvi = await readUsers(env);
    const cerstvyOdtlacok = await usersHash(cerstvi);
    if (body.baseHash !== undefined && body.baseHash !== null && cerstvyOdtlacok !== String(body.baseHash)) {
      return { stret: true, cerstvi, cerstvyOdtlacok };
    }
    await writeUsers(env, users);
    await appendAuthLog(env, `${me.name || me.email || "admin"} upravil používateľov (${cerstvi.length} → ${users.length})`);
    return { stret: false, odtlacok: await usersHash(users) };
  });

  if (vysledok.stret) {
    return json({
      error: "Medzitým zoznam zmenil niekto iný (napr. synchronizácia s kontaktami) — načítaj si ho znova a zopakuj úpravu.",
      users: vysledok.cerstvi.map(publicUser),
      hash: vysledok.cerstvyOdtlacok,
    }, 409, env);
  }

  return json({ users: users.map(publicUser), hash: vysledok.odtlacok }, 200, env);
}

/* ---------- kontrola práv pri ukladaní rozpisu ---------- */

// Pozor: každé pole bunky, ktoré appka ukladá, musí byť aj tu. Čo tu chýba,
// to diff neuvidí a server by takú zmenu prepustil bez kontroly práv.
// "nadcas" = nahlásené hodiny nadčasu (Fáza 2).
const normCell = (c) =>
  c
    ? JSON.stringify({
        off: !!c.off,
        shift: c.shift ?? null,
        duel: !!c.duel,
        note: c.note || "",
        nadcas: Number(c.nadcas) || 0,
      })
    : "";

function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = [];
  for (const k of keys) if (normCell((a || {})[k]) !== normCell((b || {})[k])) out.push(k);
  return out;
}

function changedPlain(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify((a || {})[k] ?? null) !== JSON.stringify((b || {})[k] ?? null)) out.push(k);
  }
  return out;
}

/* ---------- história sa smie iba dopĺňať ----------

   Príbeh: appka posiela pri každom uložení celý stav vrátane histórie (log).
   Server ju predtým bral tak, ako prišla — takže ktokoľvek prihlásený, aj
   obyčajný divák, mohol jedným uložením celú históriu vymazať alebo do nej
   dopísať, že niečo spravil niekto iný. História, ktorá sa dá potichu prepísať,
   nie je história; a celá appka stojí na tom, že po každej zmene ostane stopa.

   Preto sa nová história porovná so starou: staré záznamy musia ostať presne
   také, aké boli, a pribudnúť smú iba nové na začiatku. Platí to aj pre admina —
   nie preto, že by sme mu neverili, ale preto, že keby to obišiel admin, nemá
   zmysel to kontrolovať nikomu.

   Jediné, čo smie zo starých záznamov zmiznúť, je koniec zoznamu, keď sa dosiahne
   strop — vtedy nové záznamy staré vytláčajú, jeden za jeden. */
export const LOG_MAX = 400;
/* Koľko riadkov smie pribudnúť jedným uložením. Nie je to náhodné číslo:
   hromadný import tabuľky zapíše jeden riadok na každého človeka v štábe, takže
   to musí prejsť aj pri veľkom štábe. Zároveň to bráni tomu, aby niekto jedným
   uložením vytlačil celú starú históriu von. */
const LOG_NARAZ = 100;

export function logJeIbaDoplneny(stary, novy) {
  const s = (Array.isArray(stary) ? stary : []).map((x) => JSON.stringify(x));
  const n = (Array.isArray(novy) ? novy : []).map((x) => JSON.stringify(x));
  if (n.length > LOG_MAX) return false;

  /* Koľko riadkov na začiatku je nových: hľadáme najmenšie p, pri ktorom zvyšok
     nového zoznamu sedí na začiatok toho starého. Rovno od nuly, nech sa
     útočník nemôže schovať za väčšie p. */
  for (let p = 0; p <= n.length && p <= LOG_NARAZ; p++) {
    const kolkoOstalo = n.length - p;
    if (kolkoOstalo > s.length) continue;
    let sedi = true;
    for (let i = 0; i < kolkoOstalo; i++) {
      if (n[p + i] !== s[i]) { sedi = false; break; }
    }
    if (!sedi) continue;
    // koľko starých riadkov vypadlo z konca — smie to byť iba vytlačenie stropom
    const vypadlo = s.length - kolkoOstalo;
    if (vypadlo === 0) return true;
    return s.length + p > LOG_MAX && vypadlo === s.length + p - LOG_MAX;
  }
  return false;
}

/* ---------- uzávierky mesiacov sa smú iba dopĺňať a rušiť, nie prepisovať ----------

   Rovnaký dôvod ako pri histórii (logJeIbaDoplneny) vyššie: uzávierka je "dôkaz pri
   duálnom režime" (brief, sekcia 6) — vyplatené sumy zmrazené v čase uzavretia. Keby
   sa dala ticho prepísať alebo zmazať, nebol by to dôkaz o ničom. Existujúci záznam
   preto smie zmeniť presne jedno pole — "zrusene" — a iba raz, z prázdna na čas
   (nikdy naspäť na prázdno, nikdy na iný čas). Nové záznamy smú pribudnúť iba na
   koniec zoznamu. */
export function uzavierkyValidna(stare, nove) {
  const s = Array.isArray(stare) ? stare : [];
  const n = Array.isArray(nove) ? nove : [];
  if (n.length < s.length) return false;
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const b = n[i];
    if (!b) return false;
    if (a.id !== b.id || a.mesiac !== b.mesiac || a.ked !== b.ked) return false;
    if (JSON.stringify(a.kym || null) !== JSON.stringify(b.kym || null)) return false;
    if (JSON.stringify(a.vyplatene || []) !== JSON.stringify(b.vyplatene || [])) return false;
    if (a.zrusene && a.zrusene !== b.zrusene) return false; // raz zrušené, navždy zrušené
  }
  return true;
}

/** Je daný mesiac ("YYYY-MM") práve teraz uzavretý — existuje preň nezrušená uzávierka. */
function mesiacUzavrety(uzavierky, mesiac) {
  return (Array.isArray(uzavierky) ? uzavierky : []).some((u) => u.mesiac === mesiac && !u.zrusene);
}

/* Nadčas v uzavretom mesiaci sa nedá zmeniť — kontroluje sa mimo checkStateChange
   (rovnaký dôvod ako pri uzavierkyValidna vyššie: platí to aj pre admina, inak by
   uzávierka nebola dôkazom o ničom, keby si ju ten istý človek vedel obísť rovno
   v rozpise bez toho, aby ju najprv formálne zrušil). Iné polia tej istej bunky
   (smena, Duel, poznámka, "nemôžem") zamknuté nie sú — brief hovorí výslovne
   iba o nadčase. Vracia mesiac, v ktorom sa niekto o to pokúsil, alebo null. */
export function nadcasVUzavretomMesiaci(current, next) {
  for (const key of changedKeys(current.cells, next.cells)) {
    const mesiac = key.slice(0, 7); // "YYYY-MM" z "YYYY-MM-DD|crewId"
    if (!mesiacUzavrety(current.uzavierky, mesiac)) continue;
    const a = (current.cells || {})[key] || {};
    const b = (next.cells || {})[key] || {};
    if (Number(a.nadcas || 0) !== Number(b.nadcas || 0)) return mesiac;
  }
  return null;
}

/**
 * Porovná uložený a nový stav a povolí zmenu iba tam, kde na to má rola právo.
 * Vracia { ok: true } alebo { ok: false, error: "..." }.
 *
 * Robí sa to porovnávaním (diffom), lebo appka posiela celý stav naraz —
 * nedá sa spoľahnúť na to, že klient pošle iba to, čo smie meniť.
 */
export function checkStateChange(user, current, next) {
  if (!user) return { ok: false, error: "Nie si prihlásený." };
  const caps = roleCaps(user.role);
  if (user.role === "admin") return { ok: true };

  // zmeny v zozname štábu
  if (JSON.stringify(current.crew || []) !== JSON.stringify(next.crew || [])) {
    if (!caps.crew) return { ok: false, error: "Zoznam štábu smie meniť iba hlavný admin." };
  }

  // zmeny v NAD časoch
  if (changedPlain(current.nad, next.nad).length && !caps.nad) {
    return { ok: false, error: "NAD časy smie meniť iba admin alebo hlavný produkčný." };
  }

  // zmeny v sadzbách (Fáza 2) — peniaze, preto najprísnejšie
  if (changedPlain(current.sadzby, next.sadzby).length && !caps.sadzby) {
    return { ok: false, error: "Sadzby smie meniť iba hlavný admin alebo hlavný produkčný." };
  }

  // zapnutie/vypnutie sledovaného WhatsApp chatu (Fáza 3) — kto smie spracovať
  // frontu, ten smie rozhodnúť aj o tom, ktoré chaty sa vôbec čítajú
  if (changedPlain(current.chaty, next.chaty).length && !caps.pending) {
    return { ok: false, error: "Sledované WhatsApp chaty smú meniť iba vedúci a admin." };
  }

  // denné reporty (Fáza 4, prístup zúžený v sekcii 3 finálneho briefu) — appka ich
  // sama nevytvára, tie chodia z WhatsAppu (aj z viacerých chatov naraz, napr. réžia
  // a Story produceri majú každý svoj). Cez appku sa dá reportu iba prehodiť deň
  // alebo ho zmazať, a to smie iba "reporty" (réžia/loggeri/Story produceri a admin).
  // Kamera panel v appke ani nevidí (klientská strana), ale rovnako ako pri všetkom
  // ostatnom v appke GET /data posiela celý stav prihlásenému — to je poistka proti
  // ZÁPISU, nie proti čítaniu; skutočné utajenie obsahu reportov pred kamerou by
  // vyžadovalo samostatné čítanie podľa role, čo appka nikde nerobí (rovnaké ako
  // pri kontaktoch aj dispo).
  if (changedPlain(current.reporty, next.reporty).length && !caps.reporty) {
    return { ok: false, error: "Denné reporty smú meniť iba réžia, loggeri, Story produceri a admin." };
  }

  // dispozície (Fáza 5). "pendingDispo" je fronta návrhov z mailov, "dispo" je to,
  // čo už niekto potvrdil a čo appka ukazuje v detaile dňa. Oboje smie meniť iba
  // ten, kto spracúva frontu — celá Fáza 5 stojí na tom, že rozpis nikto neprepíše
  // ticho a bez potvrdenia. Ostatní dispo vidia, ale nesiahnu naň.
  if (changedPlain(current.dispo, next.dispo).length && !caps.pending) {
    return { ok: false, error: "Dispozície smú potvrdzovať iba vedúci a admin." };
  }
  if (JSON.stringify(current.pendingDispo || []) !== JSON.stringify(next.pendingDispo || [])) {
    if (!caps.pending) return { ok: false, error: "Dispo maily smú spracovať iba vedúci a admin." };
  }

  // databáza kontaktov — zatiaľ bez vlastnej sekcie v mape rolí (tá príde až so
  // sekciou 4 finálneho briefu), preto sa požičiava "users": ide o identitu
  // podobné údaje ako prístupy a rovnako ich má na starosti iba hlavný admin.
  if (JSON.stringify(current.kontakty || []) !== JSON.stringify(next.kontakty || [])) {
    if (!caps.users) return { ok: false, error: "Databázu kontaktov smie meniť iba hlavný admin." };
  }

  // uzávierka mesiaca + história vyplateného (sekcia 6 briefu) — peniaze, preto
  // rovnako prísne ako sadzby (admin a hlavný produkčný). Tvar zmeny (príloha/
  // zrušenie, nikdy prepis) sa kontroluje mimo tejto funkcie — viď handlePostData
  // a uzavierkyValidna, rovnaký dôvod ako pri histórii (aj admin cez to musí prejsť).
  if (JSON.stringify(current.uzavierky || []) !== JSON.stringify(next.uzavierky || [])) {
    if (!caps.sadzby) return { ok: false, error: "Uzávierku mesiaca smie robiť iba hlavný admin alebo hlavný produkčný." };
  }

  // zmeny vo fronte z WhatsApp bridge
  if (JSON.stringify(current.pendingHook || []) !== JSON.stringify(next.pendingHook || [])) {
    if (!caps.pending) return { ok: false, error: "Frontu z WhatsAppu smú spracovať iba vedúci a admin." };
  }

  // denné role (sekcia 4 briefu) — kto je v daný deň hlavný režisér a kto Story
  // produceri. Prideľuje iba admin a admini réžie/produkcie (rovnaká skupina, čo
  // dnes rozhoduje o réžii a Story), kamera nie.
  if (JSON.stringify(current.denneRoly || []) !== JSON.stringify(next.denneRoly || [])) {
    if (!caps.denneRoly) return { ok: false, error: "Denné role (režisér, Story produceri) smie priraďovať iba admin, réžia alebo produkcia." };
  }

  // zmeny v jednotlivých bunkách rozpisu
  const sections = ROLE_SECTIONS[user.role] || [];
  const roleOf = new Map((current.crew || []).map((c) => [String(c.id), c.role]));
  for (const key of changedKeys(current.cells, next.cells)) {
    const sep = key.lastIndexOf("|");
    const crewId = sep >= 0 ? key.slice(sep + 1) : "";
    const profesia = roleOf.get(String(crewId));

    // vedúci: celá jeho sekcia
    if (profesia && sections.includes(profesia)) continue;

    // ostatní: iba vlastný stĺpec a iba pole "nemôžem" (červená)
    if (caps.ownOff && user.crewId && String(crewId) === String(user.crewId)) {
      const a = (current.cells || {})[key] || {};
      const b = (next.cells || {})[key] || {};
      const sameRest =
        (a.shift ?? null) === (b.shift ?? null) && !!a.duel === !!b.duel && (a.note || "") === (b.note || "");
      // Vo vlastnom stĺpci smie človek meniť "nemôžem" (off) a nahlásiť si
      // hodiny nadčasu (nadcas). Smeny, Duel ani poznámku si nastaviť nesmie.
      if (sameRest) continue;
      return { ok: false, error: "Vo vlastnom stĺpci si smieš meniť iba nedostupnosť a nahlásiť nadčas, nie smeny." };
    }

    return { ok: false, error: "Na túto časť rozpisu nemáš právo." };
  }

  return { ok: true };
}
