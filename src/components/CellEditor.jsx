import { DAY_SHIFTS } from "../constants";

export default function CellEditor({ sel, crew, cell, onSet, onSwap, onClose, skDate }) {
  const person = crew.find((c) => c.id === sel.crewId);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-700 p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] no-print">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-sm font-semibold">{person?.name} — {skDate(sel.iso)}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => onSet({ off: false, shift: null, duel: false })} className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Vyčistiť</button>
        <button onClick={() => onSet({ off: !cell.off })} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${cell.off ? "bg-red-600 text-white" : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"}`}>Nemôže</button>
        {DAY_SHIFTS.map((s) => (
          <button key={s} onClick={() => onSet({ shift: cell.shift === s ? null : s })} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${cell.shift === s ? "bg-emerald-600 text-white" : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"}`}>{s}</button>
        ))}
        <button onClick={() => onSet({ duel: !cell.duel })} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${cell.duel ? "bg-pink-600 text-white" : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"}`}>Duel</button>
      </div>
      <div className="text-xs text-stone-500 dark:text-stone-500 -mt-1 mb-2">Duel sa dá zapnúť samostatne alebo spolu so smenou A/B/C (typicky piaty deň cyklu).</div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={cell.note}
          onChange={(e) => onSet({ note: e.target.value })}
          placeholder="poznámka"
          className="px-2 py-1.5 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700 grow min-w-40"
        />
        <select
          value=""
          onChange={(e) => e.target.value && onSwap(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700"
        >
          <option value="">Vymeniť s…</option>
          {crew.filter((c) => c.id !== sel.crewId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}
