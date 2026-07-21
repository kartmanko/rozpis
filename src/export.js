import * as XLSX from "xlsx";
import { cycleInfo } from "./dateUtils";
import { REHEARSALS, ROLE_LABELS } from "./constants";

function buildRows(days, crew, cellOf) {
  const head = ["Dátum", "Deň", "Cyklus", ...crew.map((c) => `${c.name} (${ROLE_LABELS[c.role || "kamera"] || c.role})`)];
  const rows = days.map((d) => {
    const ci = cycleInfo(d.iso);
    const cyc = REHEARSALS.includes(d.iso) ? "skúšky" : ci.n ? `${ci.n}/${ci.pos}${ci.fifth ? " *" : ""}` : "";
    return [
      `${d.day}.${d.month + 1}.2026`, d.dow, cyc,
      ...crew.map((c) => {
        const x = cellOf(d.iso, c.id);
        const parts = [];
        if (x.off) parts.push("NEMÔŽE");
        if (x.shift) parts.push(x.shift);
        if (x.duel) parts.push("Duel");
        if (x.note) parts.push(x.note);
        return parts.join(" ");
      }),
    ];
  });
  return [head, ...rows];
}

export function exportCSV(days, crew, cellOf) {
  const table = buildRows(days, crew, cellOf);
  const csv = table.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rozpis-kameramanov.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportXLSX(days, crew, cellOf) {
  const table = buildRows(days, crew, cellOf);
  const ws = XLSX.utils.aoa_to_sheet(table);
  ws["!cols"] = [{ wch: 10 }, { wch: 6 }, { wch: 8 }, ...crew.map(() => ({ wch: 14 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rozpis");
  XLSX.writeFile(wb, "rozpis-kameramanov.xlsx");
}

export function printSchedule() {
  window.print();
}
