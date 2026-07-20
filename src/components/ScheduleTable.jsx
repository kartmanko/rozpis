import React from "react";
import { cycleInfo } from "../dateUtils";
import { REHEARSALS, SK_MONTHS } from "../constants";

export default function ScheduleTable({ days, crew, cells, cellOf, canEdit, bulkMode, selectedKeys, onCellClick, onMoveCrew }) {
  return (
    <div className="mx-3 sm:mx-4 mb-4 rounded-xl border border-stone-200 dark:border-stone-800 shadow-sm overflow-hidden bg-white dark:bg-stone-900">
      <div className="overflow-auto">
        <table className="border-collapse text-sm w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-20 bg-stone-50 dark:bg-stone-900 border-b border-r border-stone-200 dark:border-stone-800 px-3 py-2 text-left w-28 min-w-28 font-semibold text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Deň</th>
              {crew.map((c, i) => (
                <th key={c.id} className="bg-stone-50 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-1 py-2 w-24 min-w-24 align-bottom">
                  <div className="text-xs font-semibold leading-tight break-words">{c.name}</div>
                  {canEdit && !bulkMode && (
                    <div className="flex justify-center gap-1 mt-1 no-print">
                      <button onClick={() => onMoveCrew(i, -1)} className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 px-1">◀</button>
                      <button onClick={() => onMoveCrew(i, 1)} className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 px-1">▶</button>
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
                      <td colSpan={crew.length + 1} className="sticky left-0 bg-stone-100 dark:bg-stone-800/60 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-stone-500 dark:text-stone-400">
                        {SK_MONTHS[d.month]} 2026
                      </td>
                    </tr>
                  )}
                  <tr className={`border-b border-stone-100 dark:border-stone-800/60 ${ci.fifth ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                    <td className={`sticky left-0 z-10 border-r border-stone-200 dark:border-stone-800 px-3 py-1.5 font-mono text-xs whitespace-nowrap ${reh ? "bg-violet-600 text-white" : ci.fifth ? "bg-amber-400 text-stone-950 font-bold" : d.weekend ? "bg-stone-50 text-stone-500 dark:bg-stone-900 dark:text-stone-400" : "bg-white dark:bg-stone-900"}`}>
                      {d.day}.{d.month + 1}. {d.dow}
                      <span className="ml-1 opacity-70">{reh ? "skúšky" : ci.n ? `c${ci.n}/${ci.pos}` : ""}</span>
                    </td>
                    {crew.map((c) => {
                      const x = cellOf(d.iso, c.id);
                      const bad = x.off && (x.shift || x.duel);
                      const k = d.iso + "|" + c.id;
                      const selected = bulkMode && selectedKeys?.has(k);
                      return (
                        <td
                          key={c.id}
                          onClick={(e) => canEdit && onCellClick({ iso: d.iso, crewId: c.id }, e)}
                          className={`relative px-1 py-1.5 text-center align-middle ${canEdit ? "cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60" : ""} ${bad ? "ring-2 ring-inset ring-red-400" : ""} ${selected ? "ring-4 ring-inset ring-sky-400 bg-sky-50 dark:bg-sky-900/30" : ""}`}
                        >
                          {selected && <span className="absolute top-0 right-0 text-[10px] leading-none bg-sky-400 text-stone-950 font-bold px-0.5 rounded-bl">✓</span>}
                          <div className="flex flex-col items-center justify-center gap-0.5 min-h-[1.75rem]">
                            {x.off && (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 text-xs font-bold">×</span>
                            )}
                            {x.shift && (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold">{x.shift}</span>
                            )}
                            {x.duel && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-pink-100 dark:bg-pink-900/50 text-pink-700 dark:text-pink-300 leading-tight">Duel</span>
                            )}
                            {x.note && <span className="text-[10px] text-stone-500 dark:text-stone-400 truncate max-w-full">{x.note}</span>}
                          </div>
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
              <td className="sticky left-0 bg-stone-50 dark:bg-stone-900 border-t border-r border-stone-200 dark:border-stone-800 px-3 py-2 text-xs font-semibold text-stone-500 dark:text-stone-400">Počet smien</td>
              {crew.map((c) => {
                const n = Object.entries(cells).filter(([k, v]) => k.endsWith("|" + c.id) && v.shift).length;
                return <td key={c.id} className="bg-stone-50 dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800 px-1 py-2 text-center font-mono text-xs font-semibold">{n}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
