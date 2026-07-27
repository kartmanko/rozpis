/* Koľko operácií do Cloudflare KV stojí jedna požiadavka.
   Beží bez Cloudflare aj bez siete:  node worker/test-kv-setrenie.mjs

   Prečo to existuje: appka raz vyčerpala denný strop KV (1000 zápisov,
   100 000 čítaní) a prestala ukladať. Najviac zo všetkého to žralo ohlásenie
   čítačky WhatsAppu — zapisovalo sa aj vtedy, keď sa na nej nič nezmenilo.
   Tento test drží spotrebu na uzde: keby niekto zase pridal zbytočný zápis
   alebo druhé čítanie toho istého kľúča, test spadne.

   KV je tu podvrhnuté obyčajnou Mapou, ktorá si počíta operácie. Testuje sa
   ostrý worker (src/index.js), nič sa neprepisuje ručne. */

import { createHash, randomUUID } from "node:crypto";
import worker from "./src/index.js";

let ok = 0, zle = 0;
const t = (nazov, podmienka, extra = "") => {
  if (podmienka) { ok++; console.log("  OK   " + nazov); }
  else { zle++; console.log("  ZLE  " + nazov + (extra ? "  << " + extra : "")); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");

/* ---------- podvrhnuté KV, ktoré si počíta operácie ---------- */
function urobKV(pociatok = {}) {
  const data = new Map(Object.entries(pociatok));
  const pocty = { get: 0, put: 0, list: 0, delete: 0 };
  return {
    pocty,
    data,
    vynuluj() { for (const k of Object.keys(pocty)) pocty[k] = 0; },
    async get(kluc, typ) {
      pocty.get++;
      const v = data.has(kluc) ? data.get(kluc) : null;
      if (v == null) return null;
      return typ === "json" ? JSON.parse(v) : v;
    },
    async put(kluc, hodnota) { pocty.put++; data.set(kluc, String(hodnota)); },
    async delete(kluc) { pocty.delete++; data.delete(kluc); },
    async list({ prefix = "", cursor } = {}) {
      pocty.list++;
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: cursor || undefined };
    },
  };
}

const ADMIN = { id: "u_adm", email: "a@a.sk", name: "Admin", role: "admin", crewId: null, active: true };
const SESSION_TOKEN = "tok-" + randomUUID();

function urobEnv(navyse = {}) {
  const kv = urobKV({
    users_v1: JSON.stringify([ADMIN]),
    ["sess:" + sha(SESSION_TOKEN)]: JSON.stringify({ userId: ADMIN.id, email: ADMIN.email }),
    "bridge:token": "tajomstvo-citacky",
    ...navyse,
  });
  return { kv, env: { ROZPIS_KV: kv, ALLOWED_ORIGIN: "*", ADMIN_PASSWORD: "heslo-admin" } };
}

const API = "https://api.test/";
const sCookie = { Cookie: "f18_sess=" + SESSION_TOKEN };
const req = (cesta, { method = "GET", body, headers = {} } = {}) =>
  new Request(API.replace(/\/$/, "") + cesta, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
const zavolaj = (env, r) => worker.fetch(r, env, { waitUntil: () => {} });

const pingTelo = (navyse = {}) => ({
  bridgeId: "test-fly",
  stav: "beží",
  verzia: "1.0.0",
  cislo: "+421902512111",
  skupiny: [],
  ...navyse,
});
const pingHlavicky = { "Content-Type": "application/json", "X-Hook-Secret": "tajomstvo-citacky" };

console.log("=== 1. Ohlásenie čítačky: zapíše sa iba pri zmene ===");
{
  const { kv, env } = urobEnv();

  kv.vynuluj();
  let r = await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  t("prvé ohlásenie prejde", r.status === 200);
  t("prvé ohlásenie zapíše čítačku", kv.pocty.put === 1, JSON.stringify(kv.pocty));

  kv.vynuluj();
  r = await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  t("druhé rovnaké ohlásenie NEZAPÍŠE nič", kv.pocty.put === 0, JSON.stringify(kv.pocty));
  t("a stále odpovie v poriadku", r.status === 200);

  kv.vynuluj();
  for (let i = 0; i < 20; i++) {
    await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  }
  t("dvadsať rovnakých ohlásení = nula zápisov", kv.pocty.put === 0, JSON.stringify(kv.pocty));

  /* Toto je to podstatné číslo. Predtým: dve čítačky × 1440 minút = 2880
     zápisov denne pri strope 1000. Teraz sa nemenné ohlásenie zapíše
     najviac raz za desať minút, čiže ~288 zápisov denne za obe čítačky. */
  kv.vynuluj();
  const zaznam = JSON.parse(kv.data.get("bridge:test-fly"));
  zaznam.poslednyKrat = new Date(Date.now() - 9 * 60 * 1000).toISOString();
  kv.data.set("bridge:test-fly", JSON.stringify(zaznam));
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  t("po deviatich minútach ticha ešte NEZAPÍŠE", kv.pocty.put === 0, JSON.stringify(kv.pocty));

  kv.vynuluj();
  zaznam.poslednyKrat = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  kv.data.set("bridge:test-fly", JSON.stringify(zaznam));
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  t("po jedenástich minútach ticha sa TTL obnoví zápisom", kv.pocty.put === 1, JSON.stringify(kv.pocty));

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ stav: "čaká na prepojenie", qr: "QR-1" }), headers: pingHlavicky }));
  t("zmenené QR sa zapíše hneď", kv.pocty.put === 1, JSON.stringify(kv.pocty));

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ stav: "čaká na prepojenie", qr: "QR-2" }), headers: pingHlavicky }));
  t("ďalšie nové QR tiež (párovanie ostáva živé)", kv.pocty.put === 1, JSON.stringify(kv.pocty));

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ stav: "čaká na prepojenie", qr: "QR-2" }), headers: pingHlavicky }));
  t("to isté QR druhýkrát už nie", kv.pocty.put === 0, JSON.stringify(kv.pocty));
}

console.log("\n=== 2. Ohlásenie čítačky: čítania ===");
{
  const { kv, env } = urobEnv();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  /* tajomstvo + doterajší záznam čítačky + rozpis = 3.
     Predtým sa rozpis čítal dvakrát, čo bolo pri ohlásení každú minútu zbytočné. */
  t("nemenné ohlásenie stojí najviac 3 čítania", kv.pocty.get <= 3, JSON.stringify(kv.pocty));
  t("rozpis sa nečíta dvakrát", kv.pocty.get === 3, JSON.stringify(kv.pocty));
}

console.log("\n=== 3. Nová skupina sa zapíše, opakovaná nie ===");
{
  const { kv, env } = urobEnv();
  const skupiny = [{ id: "111@g.us", nazov: "Štáb FARMA" }];

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ skupiny }), headers: pingHlavicky }));
  t("prvý raz sa zapíše čítačka aj rozpis so skupinou", kv.pocty.put === 2, JSON.stringify(kv.pocty));
  t("skupina je v rozpise a je VYPNUTÁ", JSON.parse(kv.data.get("state_v1")).chaty["111@g.us"]?.povoleny === false);

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ skupiny }), headers: pingHlavicky }));
  t("tá istá skupina druhýkrát nezapíše nič", kv.pocty.put === 0, JSON.stringify(kv.pocty));

  kv.vynuluj();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ skupiny: [{ id: "111@g.us", nazov: "Štáb FARMA 18" }] }), headers: pingHlavicky }));
  t("premenovaná skupina sa zapíše", kv.pocty.put === 1, JSON.stringify(kv.pocty));
}

console.log("\n=== 4. Prihlásený človek: rozpis stojí 3 čítania ===");
{
  const { kv, env } = urobEnv({ state_v1: JSON.stringify({ crew: [], cells: {}, version: 3 }) });

  kv.vynuluj();
  const r = await zavolaj(env, req("/data", { headers: sCookie }));
  t("rozpis sa načíta", r.status === 200);
  /* session + ľudia + rozpis. Nič navyše — a hlavne sa ani jeden z nich
     nečíta dvakrát, o to sa stará keš na požiadavku (worker/src/kes.js). */
  t("GET /data = 3 čítania, 0 zápisov", kv.pocty.get === 3 && kv.pocty.put === 0, JSON.stringify(kv.pocty));
}

console.log("\n=== 5. Zoznam ľudí sa v jednej požiadavke číta raz ===");
{
  const { kv, env } = urobEnv();
  kv.vynuluj();
  const r = await zavolaj(env, req("/auth/users", { headers: sCookie }));
  t("zoznam ľudí sa načíta", r.status === 200);
  const koľkoRazUsers = kv.pocty.get;
  /* session + users + authlog = 3. Keby keš nefungovala, users_v1 by sa
     načítal dvakrát (raz pri overení prihlásenia, raz v samotnom endpointe). */
  t("GET /auth/users = 3 čítania, nie 4", koľkoRazUsers === 3, JSON.stringify(kv.pocty));
}

console.log("\n=== 6. Uloženie rozpisu je JEDEN zápis ===");
{
  const { kv, env } = urobEnv({ state_v1: JSON.stringify({ crew: [], cells: {}, version: 1 }) });
  const d = await (await zavolaj(env, req("/data", { headers: sCookie }))).json();

  /* Toto je to, čoho sa týkala obava „ťah cez 20 buniek = 20 zápisov".
     Appka posiela celý stav naraz, takže dvadsať zmenených buniek je jeden
     zápis do jedného kľúča — a tento test to drží. */
  const cells = {};
  for (let i = 0; i < 20; i++) cells["2026-08-0" + (i % 9) + "|c" + i] = { shift: "A" };

  kv.vynuluj();
  const r = await zavolaj(env, req("/data", {
    method: "POST",
    headers: sCookie,
    body: { ...d, cells, baseVersion: d.version },
  }));
  t("uloženie prejde", r.status === 200, String(r.status));
  t("dvadsať zmenených buniek = 1 zápis", kv.pocty.put === 1, JSON.stringify(kv.pocty));
  t("a všetko je v jedinom kľúči state_v1", [...kv.data.keys()].filter((k) => k.startsWith("state")).join(",") === "state_v1");
}

console.log("\n=== 7. Stav čítačiek pre panel v appke ===");
{
  const { kv, env } = urobEnv();
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo(), headers: pingHlavicky }));
  await zavolaj(env, req("/bridge/ping", { method: "POST", body: pingTelo({ bridgeId: "test-nas" }), headers: pingHlavicky }));

  kv.vynuluj();
  const r = await zavolaj(env, req("/bridge/status", { headers: sCookie }));
  const d = await r.json();
  t("panel dostane obe čítačky", (d.bridges || []).length === 2, JSON.stringify(d.bridges?.map((b) => b.id)));
  /* session + ľudia + zoznam + dve čítačky = 4 čítania a 1 list.
     Práve preto sa panel v appke pýta raz za 15 s (pri párovaní), nie za 5 s. */
  t("stav čítačiek = 4 čítania a 1 list", kv.pocty.get === 4 && kv.pocty.list === 1, JSON.stringify(kv.pocty));
  t("a nič nezapisuje", kv.pocty.put === 0, JSON.stringify(kv.pocty));
}

console.log("\n=== 8. Keš nepresakuje medzi požiadavkami ===");
{
  const { kv, env } = urobEnv({ state_v1: JSON.stringify({ crew: [], cells: {}, version: 1 }) });
  const prve = await (await zavolaj(env, req("/data", { headers: sCookie }))).json();

  // niekto iný medzitým zapíše priamo do KV (iný server, iný worker)
  kv.data.set("state_v1", JSON.stringify({ crew: [{ id: "c1", name: "Nový" }], cells: {}, version: 2 }));

  const druhe = await (await zavolaj(env, req("/data", { headers: sCookie }))).json();
  t("prvá požiadavka videla starý stav", prve.version === 1);
  t("druhá požiadavka vidí NOVÝ stav (nekešuje sa naprieč)", druhe.version === 2, JSON.stringify(druhe.version));
  t("a aj nového človeka", (druhe.crew || []).some((c) => c.name === "Nový"));
}

console.log("\n=== 9. Denná spotreba pri pokoji (prepočet) ===");
{
  /* Dve čítačky, obe prepojené, nikto nič neupravuje. Ohlasujú sa každých
     5 minút, ale zapíše sa nanajvýš raz za 10 minút ticha. */
  const zapisyZaDen = ((24 * 60) / 10) * 2;
  t(`dve čítačky v pokoji = ${zapisyZaDen} zápisov denne (strop 1000)`, zapisyZaDen <= 300, String(zapisyZaDen));
  t("ostáva teda vyše 700 zápisov denne na skutočnú prácu", 1000 - zapisyZaDen > 700);

  const predtym = 1440 * 2;
  t(`predtým to bolo ${predtym} — teda cez strop`, predtym > 1000);
  t("zlepšenie je aspoň desaťnásobné", predtym / zapisyZaDen >= 10, String(predtym / zapisyZaDen));
}

console.log(`\n=========  ${ok} OK, ${zle} zlyhalo  =========`);
process.exit(zle ? 1 : 0);
