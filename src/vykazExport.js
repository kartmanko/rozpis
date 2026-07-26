import * as XLSX from "xlsx";
import { SK_MONTHS, ROLE_LABELS } from "./constants";
import { skDate } from "./dateUtils";
import { eurCislo, hod } from "./vykazy";

/* Export mesačných výkazov (Fáza 2).
   XLSX má dva hárky: prehľad za celý štáb a rozpis po dňoch.
   PDF sa robí cez tlač prehliadača — na mobile aj na počítači je to
   "Zdieľať -> Tlačiť -> Uložiť ako PDF", takže netreba žiadnu knižnicu navyše. */

function nazovSuboru(mesiacLabel, kto) {
  const cast = kto ? "-" + kto.replace(/\s+/g, "-").toLowerCase() : "";
  return `vykaz-${mesiacLabel.toLowerCase()}-2026${cast}`;
}

/** Prehľadový hárok: jeden riadok na človeka. */
function prehladAoa(vykazy) {
  const head = [
    "Meno", "Profesia", "Platené dni", "Smeny", "Duely", "Smena+Duel",
    "Dni nemôže", "Hodiny nadčasu", "Základ (€)", "Nadčas (€)", "Spolu (€)",
  ];
  const rows = vykazy.map((v) => [
    v.osoba.name,
    ROLE_LABELS[v.osoba.role || "kamera"] || v.osoba.role || "",
    v.pocetPlatenychDni,
    v.pocetSmien,
    v.pocetDuelov,
    v.pocetKombi,
    v.pocetOff,
    v.hodiny,
    eurCislo(v.zakladC),
    eurCislo(v.nadcasC),
    eurCislo(v.spoluC),
  ]);
  const sucet = vykazy.reduce(
    (a, v) => ({
      dni: a.dni + v.pocetPlatenychDni,
      hodiny: a.hodiny + v.hodiny,
      zaklad: a.zaklad + v.zakladC,
      nadcas: a.nadcas + v.nadcasC,
      spolu: a.spolu + v.spoluC,
    }),
    { dni: 0, hodiny: 0, zaklad: 0, nadcas: 0, spolu: 0 },
  );
  rows.push([
    "SPOLU", "", sucet.dni, "", "", "", "", sucet.hodiny,
    eurCislo(sucet.zaklad), eurCislo(sucet.nadcas), eurCislo(sucet.spolu),
  ]);
  return [head, ...rows];
}

/** Podrobný hárok: jeden riadok na odpracovaný deň. */
function dnyAoa(vykazy) {
  const head = ["Meno", "Dátum", "Čo", "Hodiny nadčasu", "Základ (€)", "Nadčas (€)", "Spolu (€)", "Poznámka"];
  const rows = [];
  for (const v of vykazy) {
    for (const r of v.riadky) {
      rows.push([
        v.osoba.name,
        skDate(r.iso) + "2026",
        r.popis,
        r.hodiny || "",
        eurCislo(r.zakladC),
        eurCislo(r.nadcasC),
        eurCislo(r.spoluC),
        r.hodinyBezSmeny ? `nahlásených ${hod(r.hodinyBezSmeny)} bez smeny — neplatí sa` : "",
      ]);
    }
  }
  return [head, ...rows];
}

export function exportVykazXLSX(vykazy, mesiacIdx, kto) {
  const mesiacLabel = mesiacIdx === null ? "cela-produkcia" : SK_MONTHS[mesiacIdx];
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(prehladAoa(vykazy));
  ws1["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Prehľad");

  const ws2 = XLSX.utils.aoa_to_sheet(dnyAoa(vykazy));
  ws2["!cols"] = [{ wch: 22 }, { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 38 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Po dňoch");

  XLSX.writeFile(wb, nazovSuboru(mesiacLabel, kto) + ".xlsx");
}

export function exportVykazCSV(vykazy, mesiacIdx, kto) {
  const mesiacLabel = mesiacIdx === null ? "cela-produkcia" : SK_MONTHS[mesiacIdx];
  const table = prehladAoa(vykazy);
  const csv = table.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nazovSuboru(mesiacLabel, kto) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** PDF = tlač prehliadača. Vytlačí sa iba to, čo je označené triedou "tlac-vykaz". */
export function tlacVykaz() {
  document.body.classList.add("tlac-rezim-vykaz");
  const uprac = () => {
    document.body.classList.remove("tlac-rezim-vykaz");
    window.removeEventListener("afterprint", uprac);
  };
  window.addEventListener("afterprint", uprac);
  window.print();
  // poistka pre prehliadače, ktoré "afterprint" nepošlú
  setTimeout(uprac, 3000);
}
