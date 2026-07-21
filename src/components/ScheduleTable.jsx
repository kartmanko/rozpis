import React from "react";
import { cycleInfo, surname, todayIso } from "../dateUtils";
import { REHEARSALS, SK_MONTHS } from "../constants";

const SHIFT_BADGE = {
  A: "bg-f-a",
  B: "bg-f-b",
  C: "bg-f-c",
  R: "bg-f-r",
};

export default function ScheduleTable({ days, crew, cells, cellOf, canEdit, bulkMode, selectedKeys, onCellClick, onMoveCrew, onDayClick, openDayIso }) {
  const today = todayIso();
  return (
    <div className="overflow-auto bg-f-bg">
      <table className="border-collapse text-sm w-full font-sans">
        <thead className="sticky top-0 z-30">
          <tr>
            <th className="sticky left-0 z-30 bg-f-bg border-b border-f-border2 px-3.5 py-2.5 text-left w-24 min-w-24 text-[10px] font-bold uppercase tracking-wider text-f-muted2">Deň</th>
            {crew.map((c, i) => (
              <th key={c.id} className="bg-f-bg border-b border-f-border2 px-1 py-2.5 w-20 min-w-20 align-bottom text-[10px] font-bold uppercase tracking-wider text-f-muted2">
                <div className="leading-tight break-words normal-case">{surname(c.name)}</div>
                {canEdit && !bulkMode && (
                  <div className="flex justify-center gap-1 mt-1 no-print">
                    <button onClick={() => onMoveCrew(c.id, -1)} className="text-f-faint hover:text-f-text px-1">◀</button>
                    <button onClick={() => onMoveCrew(c.id, 1)} className="text-f-faint hover:text-f-text px-1">▶</button>
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
            const isToday = d.iso === today;
            const isOpenDay = d.iso === openDayIso;
            return (
              <React.Fragment key={d.iso}>
                {newMonth && (
                  <tr className="sticky z-20" style={{ top: 41 }}>
                    <td colSpan={crew.length + 1} className="bg-f-panel border-b border-f-hair px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-f-faint">
                      {SK_MONTHS[d.month]} 2026
                    </td>
                  </tr>
                )}
                <tr
                  data-iso={d.iso}
                  className={isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : ""}
                >
                  <td
                    onClick={() => onDayClick && onDayClick(d.iso)}
                    className={`sticky left-0 z-10 border-b border-f-hair px-3.5 h-8 font-mono text-[11.5px] whitespace-nowrap ${onDayClick ? "cursor-pointer hover:brightness-125" : ""} ${isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : "bg-f-bg"} ${isOpenDay ? "shadow-[inset_3px_0_0_0_#ff4d17]" : ""}`}
                  >
                    <span className={reh ? "text-f-reh" : isToday ? "text-f-a font-bold" : ci.fifth ? "text-f-r font-semibold" : "text-f-text/90"}>
                      {d.day}.{d.month + 1}. {d.dow}
                    </span>
                    <span className="ml-1 text-[9.5px] text-f-faint2">{reh ? "SKÚŠKY" : ci.n ? `${ci.n}/${ci.pos}` : ""}</span>
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
                        className={`relative border-b border-f-hair h-8 text-center ${canEdit ? "cursor-pointer hover:brightness-125" : ""} ${isToday ? "bg-f-today" : ci.fifth ? "bg-f-fifthbg" : ""} ${bad ? "ring-2 ring-inset ring-red-500/70" : ""} ${selected ? "ring-2 ring-inset ring-f-accent bg-f-accent/10" : ""}`}
                      >
                        {selected && <span className="absolute top-0 right-0 text-[9px] leading-none bg-f-accent text-f-bg font-bold px-1 rounded-bl">✓</span>}
                        <div className="flex flex-col items-center justify-center gap-0.5 leading-none">
                          {x.shift && (
                            <span className={`inline-block min-w-[22px] font-mono text-xs font-bold text-f-bg rounded px-1 py-0.5 ${SHIFT_BADGE[x.shift] || "bg-f-a"}`}>{x.shift}</span>
                          )}
                          {x.duel && (
                            <span className="inline-block min-w-[34px] font-mono text-[9px] font-bold text-f-bg bg-f-duel rounded px-1 py-0.5 tracking-wide">DUEL</span>
                          )}
                          {x.off && !x.shift && !x.duel && <span className="text-f-accent text-base font-bold leading-none">×</span>}
                          {x.note && <span className="text-[10px] text-f-muted truncate max-w-[70px]">{x.note}</span>}
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
            <td className="sticky left-0 bg-f-panel border-t border-f-border2 px-3.5 py-1.5 text-[10px] uppercase tracking-wide text-f-faint">Počet smien</td>
            {crew.map((c) => {
              const n = Object.entries(cells).filter(([k, v]) => k.endsWith("|" + c.id) && v.shift).length;
              return <td key={c.id} className="bg-f-panel border-t border-f-border2 px-1 py-1.5 text-center font-mono text-xs text-f-muted">{n}</td>;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
