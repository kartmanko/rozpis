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

/* ---------- role ---------- */

export const ROLE_KEYS = ["admin", "kamera_lead", "rezia_lead", "produkcny", "stab", "viewer"];

export const ROLE_LABELS = {
  admin: "Hlavný admin",
  kamera_lead: "Vedúci kamery",
  rezia_lead: "Vedúci réžie a loggerov",
  produkcny: "Hlavný produkčný",
  stab: "Štáb",
  viewer: "Viewer",
};

// Ktoré profesie (stĺpce rozpisu) smie rola prepisovať celé.
const ROLE_SECTIONS = {
  admin: ["kamera", "rezia", "logger"],
  kamera_lead: ["kamera"],
  rezia_lead: ["rezia", "logger"],
  produkcny: [],
  stab: [],
  viewer: [],
};

// Ostatné práva.
// "sadzby" = meniť denné sadzby profesií (Fáza 2). Sú to peniaze, preto ich smie
//            prepisovať iba hlavný admin a hlavný produkčný — vedúci sekcií nie.
// "vykazVsetkych" = vidieť výkazy celého štábu, nielen svoj vlastný.
const ROLE_CAPS = {
  admin: { crew: true, nad: true, pending: true, ownOff: true, users: true, sadzby: true, vykazVsetkych: true },
  kamera_lead: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true },
  rezia_lead: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true },
  produkcny: { crew: false, nad: true, pending: false, ownOff: true, users: false, sadzby: true, vykazVsetkych: true },
  stab: { crew: false, nad: false, pending: false, ownOff: true, users: false, sadzby: false, vykazVsetkych: false },
  viewer: { crew: false, nad: false, pending: false, ownOff: false, users: false, sadzby: false, vykazVsetkych: false },
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
    return Array.isArray(parsed) ? parsed : [];
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
  };
}

export function findUser(users, email) {
  const e = normEmail(email);
  return users.find((u) => normEmail(u.email) === e) || null;
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

  // obmedzenie počtu žiadostí, aby sa nedal nikomu zaspamovať mail
  const rateKey = "rate:" + (await sha256hex(email));
  const count = Number((await env.ROZPIS_KV.get(rateKey)) || 0);
  if (count >= RATE_MAX) {
    return json({ error: "Priveľa pokusov. Skús to o hodinu, alebo napíš adminovi." }, 429, env);
  }
  await env.ROZPIS_KV.put(rateKey, String(count + 1), { expirationTtl: RATE_TTL });

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

  const magicKey = "magic:" + (await sha256hex(token));
  const raw = await env.ROZPIS_KV.get(magicKey);
  if (!raw) return json({ error: "Prihlasovací odkaz je neplatný alebo už vypršal. Vyžiadaj si nový." }, 401, env);
  await env.ROZPIS_KV.delete(magicKey); // jednorazové použitie

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
    await appendAuthLog(env, `Vytvorený prvý účet (hlavný admin): ${email}`);
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
  await appendAuthLog(env, `Prihlásenie: ${user.name || user.email}`);

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
  return { id: u.id, email: u.email, name: u.name, role: u.role, crewId: u.crewId || null, active: u.active !== false };
}

/** GET /auth/users -> zoznam používateľov (iba admin) */
export async function handleGetUsers(request, env, json) {
  const me = await getSessionUser(request, env);
  if (!me || !roleCaps(me.role).users) return json({ error: "Na správu používateľov nemáš právo." }, 403, env);
  const users = await readUsers(env);
  return json({ users: users.map(publicUser), log: await readAuthLog(env) }, 200, env);
}

/** POST /auth/users  { users: [...] } -> uloží zoznam (iba admin) */
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

  const before = await readUsers(env);
  await writeUsers(env, users);
  await appendAuthLog(env, `${me.name || me.email || "admin"} upravil používateľov (${before.length} → ${users.length})`);

  return json({ users: users.map(publicUser) }, 200, env);
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

  // denné reporty (Fáza 4) — appka ich sama nevytvára, tie chodia z WhatsAppu.
  // Cez appku sa dá reportu iba prehodiť deň alebo ho zmazať, a to smie ten,
  // kto spracúva frontu (vedúci a admin). Ostatní ich vidia, ale nemenia.
  if (changedPlain(current.reporty, next.reporty).length && !caps.pending) {
    return { ok: false, error: "Denné reporty smú meniť iba vedúci a admin." };
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

  // zmeny vo fronte z WhatsApp bridge
  if (JSON.stringify(current.pendingHook || []) !== JSON.stringify(next.pendingHook || [])) {
    if (!caps.pending) return { ok: false, error: "Frontu z WhatsAppu smú spracovať iba vedúci a admin." };
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
