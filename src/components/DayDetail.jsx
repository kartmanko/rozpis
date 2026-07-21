import { useState, useEffect } from "react";
import { cycleInfo, toUTC } from "../dateUtils";
import { REHEARSALS, ROLES, SK_MONTHS, SK_DAYS_FULL } from "../constants";

export default function DayDetail({ iso, crew, cellOf, nad, canEdit, onSetNad, onClose }) {
  const ci = cycleInfo(iso);
  const reh = REHEARSALS.includes(iso);
  const d = new Date(toUTC(iso));
  const dayNum = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  const dowFull = SK_DAYS_FULL[d.getUTCDay()];

  const current = nad?.[iso] || { depart: "", return: "" };
  const [depart, setDepart] = useState(current.depart || "");
  const [ret, setRet] = useState(current.return || "");
  useEffect(() => {
    setDepart(current.depart || "");
    setRet(current.return || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);

  const commit = (patch) => {
    const next = { depart, return: ret, ...patch };
    onSetNad(iso, next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" onClick={onClose}>
      <div
        className="bg-white dark:bg-stone-900 rounded-xl shadow-xl border border-stone-200 dark:border-stone-700 w-[min(92vw,28rem)] max-h-[85vh] overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 mb-3">
          <div>
            <div className="text-base font-bold">{dowFull} {dayNum}.{monthIdx + 1}.2026</div>
            <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">
              {reh ? "skúšky" : ci.n ? `cyklus ${ci.n} · deň ${ci.pos}${ci.fifth ? " (5. deň)" : ""}` : "mimo cyklu"}
            </div>
          </div>
          <div className="grow" />
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm">Zavrieť</button>
        </div>

        <div className="space-y-3 mb-4">
          {ROLES.map((r) => {
            const people = crew.filter((c) => (c.role || "kamera") === r.key);
            if (!people.length) return null;
            const working = people
              .map((c) => ({ c, x: cellOf(iso, c.id) }))
              .filter(({ x }) => x.shift || x.duel);
            return (
              <div key={r.key}>
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">{r.label}</div>
                {working.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {working.map(({ c, x }) => (
                      <span key={c.id} className="px-2 py-1 rounded-lg bg-emerald-600 dark:bg-emerald-700 text-white text-xs font-semibold">
                        {c.name}{x.shift ? ` — ${x.shift}` : ""}{x.duel ? " · Duel" : ""}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-stone-400 dark:text-stone-500">nikto naplánovaný</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-stone-200 dark:border-stone-800 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1.5">NAD časy</div>
          {canEdit ? (
            <div className="flex gap-3 flex-wrap items-center">
              <label className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                Odchod z NAD
                <input
                  type="time"
                  value={depart}
                  onChange={(e) => { setDepart(e.target.value); commit({ depart: e.target.value }); }}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700"
                />
              </label>
              <label className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                Návrat na NAD
                <input
                  type="time"
                  value={ret}
                  onChange={(e) => { setRet(e.target.value); commit({ return: e.target.value }); }}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700"
                />
              </label>
            </div>
          ) : (
            <div className="text-sm font-mono">
              {current.depart || current.return
                ? `${current.depart || "—"} → ${current.return || "—"}`
                : <span className="text-stone-400 dark:text-stone-500">nezadané</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
