import { DAY_SHIFTS } from "../constants";

export default function BulkActionBar({ count, onApply, onClearSelection, onExit }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-slate-900 border-t border-slate-700 p-3 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-sm font-semibold">Hromadný výber — {count} {count === 1 ? "bunka" : count < 5 ? "bunky" : "buniek"}</div>
        <div className="grow" />
        <button onClick={onClearSelection} className="text-slate-400 hover:text-slate-100 text-sm px-2">Zrušiť výber</button>
        <button onClick={onExit} className="text-slate-400 hover:text-slate-100 text-sm px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-1">
        <button onClick={() => onApply({ off: false, shift: null, duel: false })} disabled={!count} className="px-3 py-1 rounded text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-40">Vyčistiť</button>
        <button onClick={() => onApply({ off: true })} disabled={!count} className="px-3 py-1 rounded text-sm bg-red-800 hover:bg-red-700 disabled:opacity-40">Nemôže</button>
        {DAY_SHIFTS.map((s) => (
          <button key={s} onClick={() => onApply({ shift: s })} disabled={!count} className="px-3 py-1 rounded text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40">{s}</button>
        ))}
        <button onClick={() => onApply({ duel: true })} disabled={!count} className="px-3 py-1 rounded text-sm bg-pink-700 hover:bg-pink-600 disabled:opacity-40">+ Duel</button>
        <button onClick={() => onApply({ duel: false })} disabled={!count} className="px-3 py-1 rounded text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-40">- Duel</button>
      </div>
      <div className="text-xs text-slate-500">
        Klikaním na bunky v tabuľke ich pridávaš/uberáš z výberu. Podrž Shift a klikni na ďalšiu bunku v tom istom
        stĺpci alebo riadku, nech označíš celý rozsah naraz.
      </div>
    </div>
  );
}
