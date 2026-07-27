/* Test toho, čo rozhoduje, či sa prihlásenie na disku zahodí alebo nechá.
   Beží bez WhatsAppu: node bridge/test-auth-stav.mjs

   Prečo to existuje: presne na tomto nám raz spadli obe čítačky naraz. Kód
   považoval `creds.registered` za dôkaz hotového prihlásenia, lenže Baileys ho
   pri párovaní cez QR nenastaví nikdy — takže sa pri každom reštarte zahodilo
   funkčné prihlásenie a čítačka pýtala nové QR.

   Test si zámerne vyťahuje funkcie priamo z index.js. Keby ich tam niekto
   prepísal naspäť na `registered`, test spadne. */

import { readFile, rm, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useMultiFileAuthState } from "baileys";

let ok = 0, zle = 0;
const t = (nazov, podmienka, extra = "") => {
  if (podmienka) { ok++; console.log("  OK   " + nazov); }
  else { zle++; console.log("  ZLE  " + nazov + (extra ? "  << " + extra : "")); }
};

const zdroj = await readFile(new URL("./index.js", import.meta.url), "utf8");

/* Vytiahne z index.js telo pomenovanej funkcie aj s hlavičkou. */
function vytiahni(nazov) {
  let zaciatok = zdroj.indexOf("function " + nazov + "(");
  if (zaciatok < 0) throw new Error("v index.js nie je funkcia " + nazov);
  // keď je funkcia async, to slovo je pred "function" a musí ísť s ňou
  if (zdroj.slice(Math.max(0, zaciatok - 6), zaciatok) === "async ") zaciatok -= 6;
  let hlbka = 0, i = zdroj.indexOf("{", zaciatok);
  const od = i;
  for (; i < zdroj.length; i++) {
    if (zdroj[i] === "{") hlbka++;
    else if (zdroj[i] === "}" && --hlbka === 0) break;
  }
  return zdroj.slice(zaciatok, i + 1);
}

console.log("=== 1. Čo sa počíta za hotové prihlásenie ===");
const dokoncenePrihlasenie = new Function(
  vytiahni("dokoncenePrihlasenie") + "; return dokoncenePrihlasenie;",
)();
{
  t("prihlásenie cez QR (me.id je, registered false) je HOTOVÉ",
    dokoncenePrihlasenie({ me: { id: "421902512111:7@s.whatsapp.net" }, registered: false }));
  t("prihlásenie cez párovací kód (registered true) je HOTOVÉ",
    dokoncenePrihlasenie({ registered: true }));
  t("čerstvé prázdne kľúče NIE sú hotové",
    !dokoncenePrihlasenie({ registered: false }));
  t("úplne prázdne creds NIE sú hotové", !dokoncenePrihlasenie({}));
  t("chýbajúce creds NIE sú hotové", !dokoncenePrihlasenie(undefined));
  t("prázdne me.id sa neráta", !dokoncenePrihlasenie({ me: { id: "" }, registered: false }));

  /* Poistka proti návratu starej chyby: keby sa niekto vrátil k samotnému
     `registered`, prvý test hore by spadol — ale radšej to povedzme nahlas. */
  t("kód sa nespolieha iba na registered", /me\?\.id/.test(vytiahni("dokoncenePrihlasenie")));
}

console.log("=== 2. pripravAuth nezahodí hotové prihlásenie ===");
/* Skladáme naozajstnú pripravAuth z index.js, len jej podstrčíme vlastný
   priečinok a tichý log. Nič sa neprepisuje ručne — testuje sa ostrý kód. */
async function spustiPripravAuth(AUTH_DIR) {
  const zapisane = [];
  const telo =
    vytiahni("dokoncenePrihlasenie") + "\n" +
    vytiahni("pripravAuth") + "\n" +
    "return pripravAuth;";
  const fn = new Function("useMultiFileAuthState", "rm", "log", "AUTH_DIR", "prvyStart", telo)(
    useMultiFileAuthState,
    async (...a) => { zapisane.push("rm"); return rm(...a); },
    { info: () => {} },
    AUTH_DIR,
    true,
  );
  const { state } = await fn();
  return { zmazane: zapisane.includes("rm"), state };
}

async function pripravDisk(creds) {
  const dir = await mkdtemp(join(tmpdir(), "f18auth-"));
  await mkdir(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  Object.assign(state.creds, creds);
  await saveCreds();
  return dir;
}

{
  const dir = await pripravDisk({ me: { id: "421902512111:7@s.whatsapp.net" }, registered: false });
  const pred = await readFile(join(dir, "creds.json"), "utf8");
  const { zmazane, state } = await spustiPripravAuth(dir);
  t("QR prihlásenie sa NEZAHODÍ", !zmazane);
  t("a kľúče na disku ostali nedotknuté", (await readFile(join(dir, "creds.json"), "utf8")) === pred);
  t("načítalo sa to isté číslo", state.creds?.me?.id === "421902512111:7@s.whatsapp.net");
  await rm(dir, { recursive: true, force: true });
}
{
  const dir = await pripravDisk({ registered: true });
  const { zmazane } = await spustiPripravAuth(dir);
  t("prihlásenie párovacím kódom sa NEZAHODÍ", !zmazane);
  await rm(dir, { recursive: true, force: true });
}

console.log("=== 3. Rozrobený pokus sa zahodí ===");
{
  const dir = await pripravDisk({ registered: false });
  await writeFile(join(dir, "app-state-sync-key-x.json"), "{}");
  const { zmazane } = await spustiPripravAuth(dir);
  t("nedokončené párovanie sa zahodí", zmazane);
  let zvysok = true;
  try { await readFile(join(dir, "app-state-sync-key-x.json"), "utf8"); } catch { zvysok = false; }
  t("a nezostal po ňom neporiadok", !zvysok);
  await rm(dir, { recursive: true, force: true });
}

console.log("=== 4. Nikde inde sa už na registered nespoliehame ===");
{
  // komentáre nás nezaujímajú — tam sa o registered píše zámerne
  const bezKomentarov = zdroj.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const podozrive = bezKomentarov
    .split("\n")
    .map((r, i) => [i + 1, r])
    .filter(([, r]) => /creds[?.]*\.registered/.test(r) && !/return !!\(/.test(r));
  t("v kóde neostala priama kontrola creds.registered", podozrive.length === 0,
    podozrive.map(([i, r]) => i + ": " + r.trim()).join(" | "));
}

console.log(`\n=========  ${ok} OK, ${zle} zlyhalo  =========`);
process.exit(zle ? 1 : 0);
