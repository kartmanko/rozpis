import React from "react";
import { cycleInfo } from "../dateUtils";
import { REHEARSALS, SK_MONTHS } from "../constants";

export default function ScheduleTable({ days, crew, cells, cellOf, canEdit, bulkMode, selectedKeys, onCellClick, onMoveCrew }) {
  return (
    <div className="overflow-auto">
      <table className="border-collapse text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-20 bg-slate-900 border border-slate-800 px-2 py-1 text-left w-28 min-w-28">Deň</th>
            {crew.map((c, i) => (
              <th key={c.id} className="bg-slate-900 border border-slate-800 px-1 py-1 w-24 min-w-24 align-bottom">
                <div className="text-xs leading-tight break-words">{c.name}</div>
                {canEdit && !bulkMode && (
                  <div className="flex justify-center gap-1 mt-1 no-print">
                    <button onClick={() => onMoveCrew(i, -1)} className="text-slate-500 hover:text-slate-200 px-1">◀</button>
                    <button onClick={() => onMoveCrew(i, 1)} className="text-slate-500 hover:text-slate-200 px-1">▶</button>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, idx) => {
            const ci = cycleInfo(d.iso);
            const reh = REHEARSALS.includes(d.iso);
            const newMonth = idx === 0 || days[idx - 1].month !== d.month;
            return (
              <React.Fragment key={d.iso}>
                {newMonth && (
                  <tr>
                    <td colSpan={crew.length + 1} className="sticky left-0 bg-slate-900 border border-slate-800 px-2 py-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
                      {SK_MONTHS[d.month]} 2026
                    </td>
                  </tr>
                )}
                <tr className={ci.fifth ? "bg-slate-800" : ""}>
                  <td className={`sticky left-0 z-10 border border-slate-800 px-2 py-1 font-mono text-xs whitespace-nowrap ${reh ? "bg-violet-600 text-white" : ci.fifth ? "bg-amber-500 text-slate-950 font-bold" : d.weekend ? "bg-slate-900 text-slate-400" : "bg-slate-900"}`}>
                    {d.day}.{d.month + 1}. {d.dow}
                    <span className="ml-1 opacity-70">{reh ? "skúšky" : ci.n ? `c${ci.n}/${ci.pos}` : ""}</span>
                  </td>
                  {crew.map((c) => {
                    const x = cellOf(d.iso, c.id);
                    const bad = x.off && (x.shift || x.duel);
                    const bg = x.off ? "bg-red-800" : x.shift ? "bg-emerald-700" : x.duel ? "bg-pink-700" : ci.fifth ? "bg-slate-800" : "bg-slate-900";
                    const k = d.iso + "|" + c.id;
                    const selected = bulkMode && selectedKeys?.has(k);
                    return (
                      <td
                        key={c.id}
                        onClick={(e) => canEdit && onCellClick({ iso: d.iso, crewId: c.id }, e)}
                        className={`relative border border-slate-800 px-1 py-1 text-center ${canEdit ? "cursor-pointer hover:brightness-125" : ""} ${bg} ${bad ? "ring-2 ring-inset ring-red-400" : ""} ${selected ? "ring-4 ring-inset ring-sky-400 bg-sky-900/50" : ""}`}
                      >
                        {selected && <span className="absolute top-0 right-0 text-[10px] leading-none bg-sky-400 text-slate-950 font-bold px-0.5 rounded-bl">✓</span>}
                        <span className="text-xs font-semibold">{x.shift || (x.off && !x.duel ? "×" : "")}</span>
                        {x.duel && <span className="block text-[10px] font-bold leading-tight text-pink-100">Duel</span>}
                        {x.note && <span className="block text-xs text-slate-200 truncate">{x.note}</span>}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky left-0 bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-slate-400">Počet smien</td>
            {crew.map((c) => {
              const n = Object.entries(cells).filter(([k, v]) => k.endsWith("|" + c.id) && v.shift).length;
              return <td key={c.id} className="bg-slate-900 border border-slate-800 px-1 py-1 text-center font-mono text-xs">{n}</td>;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
