/* ---------- komunikácia s Cloudflare Workerom ---------- */
// Worker URL sa nastavuje cez .env (VITE_API_BASE=https://api.kartmanko.cc) pri builde,
// alebo sa dá zadať ručne v Admin paneli (uloží sa do localStorage) — užitočné pri testovaní.
//
// Všetky volania idú s credentials: "include", lebo prihlásenie je na prihlasovacej
// cookie (Fáza 1). Appka a server sú na rovnakej doméne kartmanko.cc, takže cookie
// prejde aj v Safari na iPhone (tretiostranové cookies sú tam blokované).
const API_BASE_STORAGE_KEY = "rozpis_api_base";
const ADMIN_STORAGE_KEY = "rozpis_admin_pw";

export function getApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    return localStorage.getItem(API_BASE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiBase(url) {
  try {
    localStorage.setItem(API_BASE_STORAGE_KEY, url.replace(/\/$/, ""));
  } catch {
    /* ticho */
  }
}

/* Núdzové admin heslo — poistka, keby prihlasovacie maily prestali chodiť.
   Ak je uložené, posiela sa v hlavičke pri každom volaní a server ho berie ako plného admina. */
export function setBreakGlassPassword(pw) {
  try {
    if (pw) localStorage.setItem(ADMIN_STORAGE_KEY, pw);
    else localStorage.removeItem(ADMIN_STORAGE_KEY);
  } catch {
    /* ticho */
  }
}

export function hasBreakGlassPassword() {
  try {
    return !!localStorage.getItem(ADMIN_STORAGE_KEY);
  } catch {
    return false;
  }
}

function adminHeader() {
  try {
    const pw = localStorage.getItem(ADMIN_STORAGE_KEY);
    return pw ? { "X-Admin-Password": pw } : {};
  } catch {
    return {};
  }
}

class ApiError extends Error {
  constructor(message, status, siet = false) {
    super(message);
    this.status = status;
    /* true = k serveru sa to ani nedostalo (mŕtvy signál, vypnutý server).
       Rozlišujeme to preto, že to nie je chyba appky a nemá zmysel nikoho
       odhlasovať ani nič zahadzovať — stačí to počkať a skúsiť znova. */
    this.siet = siet;
  }
}

async function request(path, opts = {}) {
  const base = getApiBase();
  if (!base) throw new ApiError("Backend (Cloudflare Worker) nie je nastavený.", 0);
  /* Keď padne samotné spojenie, prehliadač vyhodí holé „Failed to fetch" —
     po anglicky a bez toho, aby to čokoľvek vysvetlilo. Prepíšeme to, nech
     človek vidí, že je to signál, a nie pokazená appka. */
  let res;
  try {
    res = await fetch(base + path, {
      credentials: "include",
      ...opts,
      headers: { ...adminHeader(), ...(opts.headers || {}) },
    });
  } catch {
    throw new ApiError("Server neodpovedá — skontroluj pripojenie. Appka to skúsi znova.", 0, true);
  }
  if (!res.ok) {
    let msg = `Chyba servera (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* telo nie je JSON */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

const jsonPost = (path, body) => request(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ---------- rozpis ---------- */

export async function fetchData() {
  // { crew, cells, nad, sadzby, chaty, log, pendingHook, version }
  return request("/data", { method: "GET" });
}

// Pozor: každá časť stavu, ktorú appka ukladá, musí byť vymenovaná aj tu — čo tu
// chýba, to sa na server nikdy nepošle a ticho sa to stratí. "sadzby" sú z Fázy 2,
// "chaty" (sledované WhatsApp skupiny) z Fázy 3.
// "reporty" (denné reporty réžie) z Fázy 4.
// "dispo" (potvrdené dispozície) a "pendingDispo" (návrhy z mailov) z Fázy 5.
export async function saveData({ crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log, baseVersion }) {
  return jsonPost("/data", { crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log, baseVersion });
}

/** Ktoré bridge (čítačky WhatsAppu) sa naposledy ozvali — Fáza 3. */
export async function fetchBridges() {
  return request("/bridge/status", { method: "GET" });
}

/** Kód, ktorým sa čítačka WhatsAppu preukazuje serveru. Vidí ho iba vedúci a admin. */
export async function fetchBridgeToken() {
  return request("/bridge/token", { method: "GET" });
}

/** Vyrobí nový kód pre čítačku. Starý tým hneď prestane platiť. */
export async function noveBridgeToken() {
  return request("/bridge/token", { method: "POST" });
}

/* Vyhodí zo zoznamu skupiny, ktoré nie sú zapnuté. Treba to vtedy, keď sa
   čítačka preloží na iné WhatsApp číslo — mená skupín z toho starého účtu by
   inak v zozname ostali visieť. Zapnutých sa to nedotkne. */
export async function zabudniChaty() {
  return jsonPost("/chaty/zabudni", {});
}

export async function parseScreenshot({ base64, mediaType, month }) {
  return jsonPost("/parse", { image: base64, mediaType, month });
}

/* ---------- prihlásenie (Fáza 1) ---------- */

/** Pošle prihlasovací odkaz na e-mail. Server nikdy neprezradí, či adresa existuje. */
export async function authRequest(email) {
  return jsonPost("/auth/request", { email });
}

/** Overí token z prihlasovacieho odkazu a nastaví session cookie na 90 dní. */
export async function authVerify(token) {
  return jsonPost("/auth/verify", { token });
}

/** Kto je prihlásený: { user, caps } — user je null, keď nikto. */
export async function authMe() {
  return request("/auth/me", { method: "GET" });
}

export async function authLogout() {
  return jsonPost("/auth/logout", {});
}

/* ---------- správa používateľov (iba admin) ---------- */

export async function fetchUsers() {
  return request("/auth/users", { method: "GET" });
}

export async function saveUsers(users) {
  return jsonPost("/auth/users", { users });
}

/* ---------- upozornenia do telefónu (Fáza 6) ---------- */

/** Verejný kľúč servera pre odber upozornení. Server si ho vyrobil sám, nie je nikde v kóde. */
export async function fetchPushKey() {
  return request("/push/key", { method: "GET" });
}

/** Zaregistruje toto zariadenie na upozornenia. */
export async function pushSubscribe({ endpoint, p256dh, auth, zariadenie }) {
  return jsonPost("/push/subscribe", { endpoint, p256dh, auth, zariadenie });
}

export async function pushUnsubscribe(endpoint) {
  return jsonPost("/push/unsubscribe", { endpoint });
}

/** Skúšobné upozornenie — príde iba tomu, kto ho vypýtal. */
export async function pushTest() {
  return jsonPost("/push/test", {});
}

/** Oznam celému štábu. Server ho pustí len tomu, kto smie potvrdzovať zmeny. */
export async function pushOznam({ nadpis, text, url, znacka, komu }) {
  return jsonPost("/push/oznam", { nadpis, text, url, znacka, komu });
}

export { ApiError };
