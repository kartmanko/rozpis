/* Čítanie starých tabuliek (XLSX/CSV) — beží bez prehliadača aj bez servera.

   Spustenie:  node test-tabulka-import.mjs

   Najdôležitejšie, čo tu stráži: prázdna bunka v súbore nesmie nikdy nič
   zmazať a už vyplnená bunka sa nesmie prepísať bez vedomého potvrdenia. */

import {
  precitajDatum,
  precitajHodnotu,
  transponuj,
  analyzujTabulku,
  zostavNavrh,
  pouziNavrh,
  popisBunky,
  vSezone,
} from "./src/tabulkaImport.js";

let ok = 0, zle = 0;
const t = (nazov, podmienka, extra = "") => {
  if (podmienka) { ok++; console.log("  OK   " + nazov); }
  else { zle++; console.log("  ZLE  " + nazov + (extra ? "  << " + extra : "")); }
};

const CREW = [
  { id: "c0", name: "Daniel Lörincz", aliases: [], role: "kamera" },
  { id: "c1", name: "Denis Hazlinger", aliases: [], role: "kamera" },
  { id: "c2", name: "Jakub Balko", aliases: [], role: "rezia" },
];

console.log("\n=== 1. Dátumy ===");
{
  t("ISO tvar", precitajDatum("2026-08-05") === "2026-08-05");
  t("ISO s lomkami", precitajDatum("2026/8/5") === "2026-08-05");
  t("slovenský tvar s rokom", precitajDatum("5.8.2026") === "2026-08-05");
  t("slovenský tvar bez roku", precitajDatum("5.8.") === "2026-08-05");
  t("s medzerou", precitajDatum("5. 8.") === "2026-08-05");
  t("s názvom dňa pred dátumom", precitajDatum("St 5.8.") === "2026-08-05");
  t("lomka namiesto bodky", precitajDatum("5/8") === "2026-08-05");
  t("Excel serial", precitajDatum(46239) === "2026-08-05", precitajDatum(46239));
  t("Excel serial ako text", precitajDatum("46239") === "2026-08-05");
  t("Date objekt", precitajDatum(new Date(Date.UTC(2026, 7, 5))) === "2026-08-05");
  t("prázdna bunka nie je dátum", precitajDatum("") === "" && precitajDatum(null) === "");
  t("meno nie je dátum", precitajDatum("Daniel Lörincz") === "");
  t("poradové číslo nie je dátum", precitajDatum(7) === "");
  t("nezmyselný deň/mesiac sa odmietne", precitajDatum("45.99") === "");
  t("sezóna: prvý deň patrí dnu", vSezone("2026-07-30"));
  t("sezóna: posledný deň patrí dnu", vSezone("2026-10-17"));
  t("sezóna: deň pred štartom je vonku", !vSezone("2026-07-29"));
  t("sezóna: deň po konci je vonku", !vSezone("2026-10-18"));
}

console.log("\n=== 2. Obsah buniek ===");
{
  const h = (v) => precitajHodnotu(v);
  t("prázdna bunka nehovorí nič", h("") === null && h(null) === null && h(undefined) === null);
  t("pomlčka nehovorí nič", h("-") === null && h("–") === null);
  t("nula nehovorí nič", h("0") === null);
  t("N/A nehovorí nič", h("N/A") === null);

  t("„nemôže“ je červená", h("nemôže").off === true);
  t("veľké písmená a bez diakritiky tiež", h("NEMOZE").off === true);
  t("krížik je červená", h("X").off === true);
  t("„volno“ je červená", h("volno").off === true);
  t("červená nemá smenu", h("nemôže").shift === null);

  t("smena A", h("A").shift === "A" && h("A").off === false);
  t("malé písmeno smeny", h("b").shift === "B");
  t("smena R", h("R").shift === "R");
  t("„smena C“ — slovo sa zahodí", h("smena C").shift === "C", JSON.stringify(h("smena C")));

  t("duel sám", h("Duel").duel === true && h("Duel").shift === null);
  t("smena a duel spolu", h("A Duel").shift === "A" && h("A Duel").duel === true);
  t("oddelené čiarkou", h("A, Duel").duel === true);
  t("oddelené lomkou", h("A/Duel").duel === true);

  t("čo nepoznám, ide do poznámky", h("dovoz o 7:00").note === "dovoz o 7:00");
  t("smena aj poznámka naraz", (() => { const x = h("A dovoz 7:00"); return x.shift === "A" && x.note === "dovoz 7:00"; })());
  t("červená aj poznámka naraz", (() => { const x = h("nemôže svadba"); return x.off === true && x.note === "svadba"; })());

  t("popis bunky pre človeka", popisBunky({ off: true, shift: "A", duel: true, note: "pozn" }) === "NEMÔŽE A Duel pozn");
  t("popis prázdnej bunky", popisBunky(null) === "prázdne");
}

console.log("\n=== 3. Otočenie tabuľky ===");
{
  const preklop = transponuj([[1, 2, 3], [4, 5, 6]]);
  t("transpozícia otočí riadky a stĺpce", JSON.stringify(preklop) === JSON.stringify([[1, 4], [2, 5], [3, 6]]));

  // tvar, v akom appka exportuje: dátum dole, ľudia v stĺpcoch
  const exportny = [
    ["Dátum", "Deň", "Cyklus", "Daniel Lörincz (Kamery)", "Denis Hazlinger (Kamery)"],
    ["2026-08-05", "St", "1/1", "A", "nemôže"],
    ["2026-08-06", "Št", "1/2", "B", "A"],
  ];
  const a = analyzujTabulku(exportny, { crew: CREW });
  t("rozpozná ľudí v stĺpcoch", a.orientacia === "osoby-stlpce", a.orientacia);
  t("nájde stĺpec s dátumami", a.datumStlpec === 0, String(a.datumStlpec));
  t("nájde oba dni", a.riadky.length === 2, JSON.stringify(a.riadky));
  t("„Deň“ a „Cyklus“ nepovažuje za ľudí", a.osoby.length === 2, JSON.stringify(a.osoby.map((o) => o.hlavicka)));
  t("meno so zátvorkou spáruje s človekom", a.osoby[0].crewId === "c0", JSON.stringify(a.osoby[0]));
  t("spáruje aj druhého", a.osoby[1].crewId === "c1");

  // to isté otočené: ľudia v riadkoch, dátumy vedľa seba
  const otoceny = transponuj(exportny);
  const b = analyzujTabulku(otoceny, { crew: CREW });
  t("rozpozná ľudí v riadkoch", b.orientacia === "osoby-riadky", b.orientacia);
  t("po otočení nájde tie isté dni", b.riadky.length === 2);
  t("po otočení nájde tých istých ľudí", b.osoby.length === 2 && b.osoby[0].crewId === "c0");

  // ručné prepnutie musí mať prednosť pred automatom
  const c = analyzujTabulku(exportny, { crew: CREW, orientacia: "osoby-riadky" });
  t("ručné prepnutie prebije automat", c.orientacia === "osoby-riadky");

  // dni mimo sezóny sa počítajú, ale nespracúvajú
  const mimo = [
    ["Dátum", "Daniel Lörincz"],
    ["2026-06-01", "A"],
    ["2026-08-05", "B"],
  ];
  const d = analyzujTabulku(mimo, { crew: CREW });
  t("deň mimo sezóny sa preskočí", d.riadky.length === 1 && d.riadky[0].iso === "2026-08-05");
  t("a spočíta sa", d.mimoSezonu === 1, String(d.mimoSezonu));

  // neznáme meno sa nespáruje samo
  const cudzi = [["Dátum", "Kto To Je"], ["2026-08-05", "A"]];
  const e = analyzujTabulku(cudzi, { crew: CREW });
  t("neznáme meno ostane nepriradené", e.osoby.length === 1 && e.osoby[0].crewId === "");

  // úplne prázdny stĺpec nikoho nepotrebuje
  const prazdny = [["Dátum", "Daniel Lörincz", "Jakub Balko"], ["2026-08-05", "A", ""]];
  const f = analyzujTabulku(prazdny, { crew: CREW });
  t("celkom prázdny stĺpec sa neponúka", f.osoby.length === 1 && f.osoby[0].crewId === "c0", JSON.stringify(f.osoby));

  // hlavička nemusí byť v prvom riadku
  const snadpisom = [
    ["FARMA 18 — rozpis", "", ""],
    ["Dátum", "Daniel Lörincz", "Denis Hazlinger"],
    ["2026-08-05", "A", "B"],
  ];
  const g = analyzujTabulku(snadpisom, { crew: CREW });
  t("hlavičku nájde aj pod nadpisom", g.osoby.length === 2 && g.osoby[0].crewId === "c0", JSON.stringify(g.osoby.map((o) => o.hlavicka)));
}

console.log("\n=== 4. Návrh zmien ===");
{
  const tabulka = [
    ["Dátum", "Daniel Lörincz", "Denis Hazlinger"],
    ["2026-08-05", "A", "nemôže"],
    ["2026-08-06", "", "A"],        // prázdna bunka u Daniela
    ["2026-08-07", "B", "B"],
  ];
  const a = analyzujTabulku(tabulka, { crew: CREW });
  const priradenie = Object.fromEntries(a.osoby.map((o) => [o.c, o.crewId]));

  const cells = {
    "2026-08-06|c0": { off: true, shift: null, duel: false, note: "" },   // toto sa v súbore nespomína
    "2026-08-07|c0": { off: false, shift: "C", duel: false, note: "" },   // v súbore je B — konflikt
    "2026-08-07|c1": { off: false, shift: "B", duel: false, note: "" },   // v súbore to isté
  };

  const { zmeny } = zostavNavrh({ mriezka: a.mriezka, riadky: a.riadky, priradenie, cells });
  const podla = (d) => zmeny.filter((z) => z.druh === d);

  t("prázdna bunka v súbore nič nenavrhne", !zmeny.some((z) => z.iso === "2026-08-06" && z.crewId === "c0"), JSON.stringify(zmeny));
  t("nové bunky sa nájdu", podla("nova").length === 3, JSON.stringify(podla("nova")));
  t("konflikt sa označí ako zmena", podla("zmena").length === 1 && podla("zmena")[0].iso === "2026-08-07");
  t("rovnaká hodnota sa označí ako rovnaká", podla("rovnaka").length === 1);
  t("zmeny sú zoradené podľa dátumu", zmeny[0].iso <= zmeny[zmeny.length - 1].iso);

  // zápis bez prepisovania
  const iba = podla("nova");
  const po = pouziNavrh(cells, iba);
  t("zápis vyplní prázdne bunky", po["2026-08-05|c0"].shift === "A" && po["2026-08-05|c1"].off === true);
  t("zápis bez prepisovania nechá konflikt tak", po["2026-08-07|c0"].shift === "C");
  t("zápis nezmaže bunku, o ktorej súbor mlčí", po["2026-08-06|c0"].off === true);
  t("pôvodný objekt sa nezmenil", cells["2026-08-05|c0"] === undefined);

  // zápis vrátane prepisovania
  const po2 = pouziNavrh(cells, [...podla("nova"), ...podla("zmena")]);
  t("s prepisovaním sa konflikt prepíše", po2["2026-08-07|c0"].shift === "B");

  // nadčas na bunke sa importom nesmie stratiť
  const sNadcasom = { "2026-08-05|c0": { off: false, shift: null, duel: false, note: "", nadcas: 3 } };
  const po3 = pouziNavrh(sNadcasom, zostavNavrh({ mriezka: a.mriezka, riadky: a.riadky, priradenie, cells: sNadcasom }).zmeny.filter((z) => z.druh !== "rovnaka"));
  t("nahlásený nadčas prežije import", po3["2026-08-05|c0"].nadcas === 3, JSON.stringify(po3["2026-08-05|c0"]));

  // obmedzenie práv: vedúci kamery nesmie zapisovať réžii
  const tab2 = [["Dátum", "Daniel Lörincz", "Jakub Balko"], ["2026-08-05", "A", "B"]];
  const b = analyzujTabulku(tab2, { crew: CREW });
  const pr2 = Object.fromEntries(b.osoby.map((o) => [o.c, o.crewId]));
  const obm = zostavNavrh({ mriezka: b.mriezka, riadky: b.riadky, priradenie: pr2, cells: {}, dovolene: ["c0"] });
  t("do cudzej sekcie import nesiahne", obm.zmeny.length === 1 && obm.zmeny[0].crewId === "c0", JSON.stringify(obm.zmeny));

  // nepriradený stĺpec sa preskočí
  const bez = zostavNavrh({ mriezka: b.mriezka, riadky: b.riadky, priradenie: { ...pr2, [b.osoby[1].c]: "" }, cells: {} });
  t("nepriradený stĺpec sa preskočí", bez.zmeny.length === 1);
}

console.log(`\n=========  ${ok} OK, ${zle} zlyhalo  =========\n`);
process.exit(zle ? 1 : 0);
