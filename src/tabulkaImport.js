/* ---------- čítanie existujúcich tabuliek (XLSX / CSV) ----------

   Načítanie súboru robí panel (knižnica xlsx), tento súbor dostane už len holé
   riadky a stĺpce ako pole polí. Vďaka tomu sa dá celé čítanie otestovať bez
   prehliadača (`node test-tabulka-import.mjs`).

   Dôležité pravidlo, ktoré platí všade nižšie: **prázdna bunka v súbore nikdy
   nič nemaže**. Kto má v starej tabuľke pol sezóny prázdnej, nesmie si importom
   vymazať to, čo už má v appke navyplňované. Prepísať vyplnenú bunku sa dá iba
   vtedy, keď to admin v paneli výslovne zapne — a aj potom to najprv uvidí
   v prehľade a musí to potvrdiť.

   Kvôli testom mimo prehliadača tu majú importy príponu .js a berú sa len zo
   súborov, ktoré samy nič ďalšie neimportujú (matching.js, constants.js). */

import { norm, guessCrew } from "./matching.js";
import { START, END, DAY_SHIFTS } from "./constants.js";

/* Excel drží dátumy ako počet dní od 30. 12. 1899 (tá nula je zámerná —
   Excel si myslí, že rok 1900 bol priestupný, a tento posun to vyrovnáva). */
const EXCEL_NULA = Date.UTC(1899, 11, 30);
const DEN_MS = 86400000;

const dvojcifer = (n) => String(n).padStart(2, "0");
const isoZo = (rok, mesiac, den) => `${rok}-${dvojcifer(mesiac)}-${dvojcifer(den)}`;

/** Je dátum v rámci sezóny? ISO tvar sa dá porovnávať ako obyčajný text. */
export const vSezone = (iso) => Boolean(iso) && iso >= START && iso <= END;

/**
 * Prečíta dátum z bunky. Zvládne to, čo reálne chodí z Excelu aj z CSV:
 * číslo (Excel serial), Date, "2026-08-05", "5.8.2026", "5.8.", "5/8",
 * aj "St 5.8." s názvom dňa pred dátumom.
 * Vráti ISO reťazec alebo "" (nerozumiem).
 */
export function precitajDatum(v, rok = 2026) {
  if (v === null || v === undefined || v === "") return "";

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    /* Knižnica xlsx skladá dátumy tak, aby sedeli v miestnom čase; keď je bunka
       presne polnoc UTC, berieme UTC zložky, inak miestne. V oboch prípadoch
       vyjde ten deň, ktorý je v tabuľke napísaný. */
    const utcPolnoc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
    return utcPolnoc
      ? isoZo(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
      : isoZo(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }

  if (typeof v === "number") {
    // Rozumné rozpätie serialov: 1990 až 2100. Nižšie čísla sú skôr poradie riadku.
    if (!Number.isFinite(v) || v < 32000 || v > 74000) return "";
    const d = new Date(EXCEL_NULA + Math.round(v) * DEN_MS);
    return isoZo(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const s = String(v).trim();
  if (!s) return "";

  // 2026-08-05 alebo 2026/8/5
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoZo(Number(m[1]), Number(m[2]), Number(m[3]));

  // 5.8.2026 — celý rok až za dňom a mesiacom
  m = s.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})/);
  if (m) return isoZo(Number(m[3]), Number(m[2]), Number(m[1]));

  // 5.8. / 5. 8 / 5/8 — rok sa doplní zo sezóny
  m = s.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) {
    const den = Number(m[1]);
    const mesiac = Number(m[2]);
    if (den >= 1 && den <= 31 && mesiac >= 1 && mesiac <= 12) return isoZo(rok, mesiac, den);
    return "";
  }

  // Samotné číslo v textovej podobe — môže to byť Excel serial uložený ako text.
  if (/^\d+$/.test(s)) return precitajDatum(Number(s), rok);
  return "";
}

/* Slová, ktoré v starých tabuľkách znamenajú „tento deň nemôže". Porovnávajú sa
   cez norm(), takže diakritika ani veľké písmená nehrajú rolu. */
const SLOVA_NEMOZE = new Set([
  "nemoze", "nemozem", "nemozu", "nema", "nedostupny", "nedostupna", "nedostupne",
  "off", "volno", "x", "xx", "cervena", "cervene", "nie", "ne", "pn", "dovolenka",
  "dovolena", "absencia", "chyba", "prec",
]);

/* Bunky, ktoré nehovoria nič — nesmú nič vyplniť ani nič prepísať. */
const SLOVA_PRAZDNE = new Set(["", "-", "--", "0", "n a", "na", "x x"]);

const SMENY = new Set(DAY_SHIFTS.map((s) => norm(s)));

/**
 * Prečíta obsah jednej bunky rozpisu.
 * Vráti { off, shift, duel, note } alebo null, keď bunka nehovorí nič
 * (prázdna, pomlčka…) — vtedy sa s existujúcou hodnotou v appke nič nerobí.
 */
export function precitajHodnotu(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? { off: true, shift: null, duel: false, note: "" } : null;

  const s = (v instanceof Date ? "" : String(v)).trim();
  if (!s) return null;
  if (SLOVA_PRAZDNE.has(norm(s))) return null;

  const kusy = s.split(/[\s,;+/|]+/).filter(Boolean);
  let off = false;
  let shift = null;
  let duel = false;
  const zvysok = [];

  for (const kus of kusy) {
    const n = norm(kus);
    if (!n) continue;
    if (SLOVA_NEMOZE.has(n)) { off = true; continue; }
    if (n === "duel" || n === "duely") { duel = true; continue; }
    if (!shift && SMENY.has(n)) { shift = n.toUpperCase(); continue; }
    // "smena a" / "zmena b" — samotné slovo zahodíme, písmeno berieme
    if (n === "smena" || n === "zmena") continue;
    zvysok.push(kus);
  }

  const note = zvysok.join(" ").trim();
  if (!off && !shift && !duel && !note) return null;
  return { off, shift, duel, note };
}

/** Preklopí pole polí (riadky sa stanú stĺpcami). */
export function transponuj(mriezka) {
  const sirka = mriezka.reduce((m, r) => Math.max(m, r.length), 0);
  const out = [];
  for (let c = 0; c < sirka; c++) out.push(mriezka.map((r) => (r ? r[c] : undefined)));
  return out;
}

/* Hlavičky stĺpcov, ktoré nie sú ľudia — v exporte z tejto appky aj v bežných
   tabuľkách stoja hneď vedľa dátumu. */
const NIE_JE_CLOVEK = new Set([
  "datum", "den", "cyklus", "tyzden", "poznamka", "pozn", "mesiac", "dna", "cislo", "por",
]);

/** Koľko buniek v poli sa dá prečítať ako dátum v sezóne. */
function pocetDatumov(pole, rok) {
  let n = 0;
  for (const v of pole || []) if (vSezone(precitajDatum(v, rok))) n++;
  return n;
}

/**
 * Zistí, ako je tabuľka otočená, a nájde v nej stĺpec s dátumami aj hlavičky ľudí.
 *
 * Výsledná `mriezka` je vždy otočená tak, že **dátumy idú dole** a každý človek
 * je stĺpec — to je aj tvar, v akom appka tabuľku exportuje.
 *
 * `orientacia`: "auto" | "osoby-stlpce" (dátumy pod sebou) | "osoby-riadky"
 * (dátumy vedľa seba). Ručné prepnutie je v paneli, keby sa automat pomýlil.
 */
export function analyzujTabulku(vstup, { rok = 2026, orientacia = "auto", crew = [] } = {}) {
  const povodna = (vstup || []).map((r) => (Array.isArray(r) ? r : [r]));
  const preklopena = transponuj(povodna);

  let smer = orientacia;
  if (smer !== "osoby-stlpce" && smer !== "osoby-riadky") {
    // Dátumy hľadáme v stĺpcoch pôvodnej tabuľky a v stĺpcoch preklopenej;
    // vyhráva tá, kde ich je v jednom rade viac.
    const vStlpci = preklopena.reduce((m, r) => Math.max(m, pocetDatumov(r, rok)), 0);
    const vRiadku = povodna.reduce((m, r) => Math.max(m, pocetDatumov(r, rok)), 0);
    smer = vRiadku > vStlpci ? "osoby-riadky" : "osoby-stlpce";
  }
  const mriezka = smer === "osoby-riadky" ? preklopena : povodna;

  // Stĺpec s dátumami = ten, v ktorom je najviac dátumov zo sezóny.
  const stlpce = transponuj(mriezka);
  let datumStlpec = -1;
  let najlepsi = 0;
  stlpce.forEach((st, c) => {
    const n = pocetDatumov(st, rok);
    if (n > najlepsi) { najlepsi = n; datumStlpec = c; }
  });

  const riadky = [];
  let mimoSezonu = 0;
  if (datumStlpec >= 0) {
    mriezka.forEach((r, i) => {
      const iso = precitajDatum(r[datumStlpec], rok);
      if (!iso) return;
      if (vSezone(iso)) riadky.push({ r: i, iso });
      else mimoSezonu++;
    });
  }

  /* Hlavičku hľadáme nad prvým dátumovým riadkom — je to ten riadok, kde je
     najviac vypísaného textu. Keď dátumy začínajú hneď od začiatku, berie sa
     prvý riadok. */
  const prvyDatum = riadky.length ? riadky[0].r : mriezka.length;
  let hlavickaRiadok = 0;
  let najviacTextu = -1;
  for (let i = 0; i < Math.max(prvyDatum, 1); i++) {
    const pocet = (mriezka[i] || []).filter((v) => String(v ?? "").trim()).length;
    if (pocet > najviacTextu) { najviacTextu = pocet; hlavickaRiadok = i; }
  }

  const hlavicky = mriezka[hlavickaRiadok] || [];
  const osoby = [];
  stlpce.forEach((st, c) => {
    if (c === datumStlpec) return;
    // Zátvorku za menom (v exporte je v nej rola) na párovanie nepotrebujeme.
    const hlavicka = String(hlavicky[c] ?? "").replace(/\(.*?\)/g, "").trim();
    if (!hlavicka) return;
    if (NIE_JE_CLOVEK.has(norm(hlavicka))) return;
    // Stĺpec, ktorý je v dátumových riadkoch celý prázdny, netreba nikomu priraďovať.
    const maObsah = riadky.some(({ r }) => String(st[r] ?? "").trim());
    if (!maObsah) return;
    osoby.push({ c, hlavicka, crewId: guessCrew(crew, hlavicka, "") });
  });

  return { orientacia: smer, mriezka, datumStlpec, hlavickaRiadok, riadky, osoby, mimoSezonu };
}

const rovnake = (a, b) =>
  Boolean(a.off) === Boolean(b.off) &&
  (a.shift || null) === (b.shift || null) &&
  Boolean(a.duel) === Boolean(b.duel) &&
  String(a.note || "") === String(b.note || "");

/** Ľudsky čitateľný obsah bunky — do prehľadu pred zápisom. */
export function popisBunky(b) {
  if (!b) return "prázdne";
  const kusy = [];
  if (b.off) kusy.push("NEMÔŽE");
  if (b.shift) kusy.push(b.shift);
  if (b.duel) kusy.push("Duel");
  if (b.note) kusy.push(b.note);
  return kusy.length ? kusy.join(" ") : "prázdne";
}

/**
 * Z rozanalyzovanej tabuľky a priradenia stĺpcov k ľuďom zostaví zoznam zmien.
 * Nič nezapisuje — zápis robí panel až po potvrdení.
 *
 * `priradenie`: { [index stĺpca]: crewId }. Stĺpce bez priradenia sa preskočia.
 * `dovolene`: nepovinné pole/Set crewId, ktoré smie prihlásený človek meniť.
 *
 * Vráti { zmeny: [{ iso, crewId, stara, nova, druh }] }, kde druh je
 * "nova" (bunka bola prázdna), "zmena" (bola vyplnená inak) alebo
 * "rovnaka" (v súbore je to isté, čo už je v appke).
 */
export function zostavNavrh({ mriezka, riadky, priradenie, cells = {}, dovolene = null }) {
  const povolene = dovolene ? new Set(dovolene) : null;
  const zmeny = [];

  for (const { r, iso } of riadky) {
    for (const [cRaw, crewId] of Object.entries(priradenie || {})) {
      if (!crewId) continue;
      if (povolene && !povolene.has(crewId)) continue;
      const c = Number(cRaw);
      const nova = precitajHodnotu((mriezka[r] || [])[c]);
      if (!nova) continue; // prázdna bunka v súbore nikdy nič nemaže

      const stara = cells[iso + "|" + crewId] || null;
      const druh = !stara ? "nova" : rovnake(stara, nova) ? "rovnaka" : "zmena";
      zmeny.push({ iso, crewId, stara, nova, druh });
    }
  }

  zmeny.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  return { zmeny };
}

/**
 * Aplikuje vybrané zmeny na objekt buniek a vráti nový objekt.
 * Používa sa v jedinom `commitCells`, aby celý import bol jeden krok späť
 * a jeden zápis na server.
 */
export function pouziNavrh(cells, zmeny) {
  const out = { ...cells };
  for (const z of zmeny) {
    const k = z.iso + "|" + z.crewId;
    const cur = out[k] || {};
    out[k] = {
      ...cur,
      off: Boolean(z.nova.off),
      shift: z.nova.shift || null,
      duel: Boolean(z.nova.duel),
      note: z.nova.note || "",
    };
  }
  return out;
}
