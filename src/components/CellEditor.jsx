import { SHIFTS } from "../constants";

export default function CellEditor({ sel, crew, cell, onSet, onSwap, onClose, skDate }) {
  const person = crew.find((c) => c.id === sel.crewId);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-slate-900 border-t border-slate-700 p-3 no-print">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-sm font-semibold">{person?.name} — {skDate(sel.iso)}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => onSet({ off: false, shift: null })} className="px-3 py-1 rounded text-sm bg-slate-800 hover:bg-slate-700">Vyčistiť</button>
        <button onClick={() => onSet({ off: !cell.off })} className={`px-3 py-1 rounded text-sm ${cell.off ? "bg-red-700" : "bg-slate-800 hover:bg-slate-700"}`}>Nemôže</button>
        {SHIFTS.map((s) => (
          <button key={s} onClick={() => onSet({ shift: cell.shift === s ? null : s })} className={`px-3 py-1 rounded text-sm ${cell.shift === s ? "bg-emerald-600" : "bg-slate-800 hover:bg-slate-700"}`}>{s}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={cell.note}
          onChange={(e) => onSet({ note: e.target.value })}
          placeholder="poznámka"
          className="px-2 py-1 rounded bg-slate-800 text-sm border border-slate-700 grow min-w-40"
        />
        <select
          value=""
          onChange={(e) => e.target.value && onSwap(e.target.value)}
          className="px-2 py-1 rounded bg-slate-800 text-sm border border-slate-700"
        >
          <option value="">Vymeniť s…</option>
          {crew.filter((c) => c.id !== sel.crewId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}
