import { DAY_SHIFTS } from "../constants";

export default function BulkActionBar({ count, allowDuel, onApply, onClearSelection, onExit }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-700 p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-sm font-semibold">Hromadný výber — {count} {count === 1 ? "bunka" : count < 5 ? "bunky" : "buniek"}</div>
        <div className="grow" />
        <button onClick={onClearSelection} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm px-2">Zrušiť výber</button>
        <button onClick={onExit} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-1">
        <button onClick={() => onApply({ off: false, shift: null, duel: false })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-40 transition-colors">Vyčistiť</button>
        <button onClick={() => onApply({ off: true })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 transition-colors">Nemôže</button>
        {DAY_SHIFTS.map((s) => (
          <button key={s} onClick={() => onApply({ shift: s })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition-colors">{s}</button>
        ))}
        {allowDuel && (
          <>
            <button onClick={() => onApply({ duel: true })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-40 transition-colors">+ Duel</button>
            <button onClick={() => onApply({ duel: false })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-40 transition-colors">- Duel</button>
          </>
        )}
        {!allowDuel && count > 0 && (
          <div className="text-xs text-stone-500 dark:text-stone-500 self-center">Duel je len pre rolu kamera — vo výbere sú aj iné role.</div>
        )}
      </div>
      <div className="text-xs text-stone-500 dark:text-stone-500">
        Klikaním na bunky v tabuľke ich pridávaš/uberáš z výberu. Podrž Shift a klikni na ďalšiu bunku v tom istom
        stĺpci alebo riadku, nech označíš celý rozsah naraz.
      </div>
    </div>
  );
}
