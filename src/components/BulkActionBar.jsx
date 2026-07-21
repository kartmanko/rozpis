import { DAY_SHIFTS } from "../constants";

const SHIFT_BG = { A: "bg-f-a", B: "bg-f-b", C: "bg-f-c", R: "bg-f-r" };

export default function BulkActionBar({ count, allowDuel, onApply, onClearSelection, onExit }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-f-panel3 border-t-[3px] border-f-accent p-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-sm font-semibold text-f-text">Hromadný výber — {count} {count === 1 ? "bunka" : count < 5 ? "bunky" : "buniek"}</div>
        <div className="grow" />
        <button onClick={onClearSelection} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2">Zrušiť výber</button>
        <button onClick={onExit} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-1 items-center">
        <button onClick={() => onApply({ off: false, shift: null, duel: false })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-muted disabled:opacity-40 transition-colors">Vyčistiť</button>
        <button onClick={() => onApply({ off: true })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-accent hover:brightness-110 text-f-ink disabled:opacity-40 transition-colors">× Nemôže</button>
        {DAY_SHIFTS.map((s) => (
          <button key={s} onClick={() => onApply({ shift: s })} disabled={!count} className={`px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-f-ink disabled:opacity-40 transition-colors hover:brightness-110 ${SHIFT_BG[s]}`}>{s}</button>
        ))}
        {allowDuel && (
          <>
            <button onClick={() => onApply({ duel: true })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-duel hover:brightness-110 text-f-ink disabled:opacity-40 transition-colors">+ Duel</button>
            <button onClick={() => onApply({ duel: false })} disabled={!count} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-muted disabled:opacity-40 transition-colors">- Duel</button>
          </>
        )}
        {!allowDuel && count > 0 && (
          <div className="text-xs text-f-faint self-center">Duel je len pre rolu kamera — vo výbere sú aj iné role.</div>
        )}
      </div>
      <div className="text-xs text-f-faint">
        Klikaním na bunky v tabuľke ich pridávaš/uberáš z výberu. Podrž Shift a klikni na ďalšiu bunku v tom istom
        stĺpci alebo riadku, nech označíš celý rozsah naraz.
      </div>
    </div>
  );
}
