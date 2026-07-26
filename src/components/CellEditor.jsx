import { DAY_SHIFTS } from "../constants";

const SHIFT_ON = { A: "bg-f-a", B: "bg-f-b", C: "bg-f-c", R: "bg-f-r" };

// access: "full" = celá bunka, "off" = iba prepínač "nemôžem" (vlastný stĺpec člena štábu)
export default function CellEditor({ sel, crew, cell, onSet, onSwap, onClose, skDate, access = "full" }) {
  const person = crew.find((c) => c.id === sel.crewId);
  const allowDuel = (person?.role || "kamera") === "kamera";

  if (access === "off") {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 bg-f-panel3 border-t-[3px] border-f-accent p-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] no-print">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="text-sm font-semibold text-f-text">{person?.name} — {skDate(sel.iso)}</div>
          <div className="grow" />
          <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2">Zavrieť</button>
        </div>
        <button
          onClick={() => onSet({ off: !cell.off })}
          className={`w-full px-3 py-3 rounded-lg text-sm font-bold transition-colors ${cell.off ? "bg-f-accent text-f-ink" : "bg-f-panel2 hover:bg-f-border text-f-text"}`}
        >
          {cell.off ? "× V tento deň nemôžem (klikni pre zrušenie)" : "Označiť: v tento deň nemôžem"}
        </button>
        <div className="text-xs text-f-faint mt-2">
          Smeny prideľuje vedúci — ty si tu označuješ iba dni, keď nemôžeš. Zmena sa uloží hneď.
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-f-panel3 border-t-[3px] border-f-accent p-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] no-print">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="text-sm font-semibold text-f-text">{person?.name} — {skDate(sel.iso)}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => onSet({ off: false, shift: null, duel: false })} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-muted transition-colors">Vyčistiť</button>
        <button onClick={() => onSet({ off: !cell.off })} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${cell.off ? "bg-f-accent text-f-ink" : "bg-f-panel2 hover:bg-f-border text-f-text"}`}>× Nemôže</button>
        {DAY_SHIFTS.map((s) => (
          <button key={s} onClick={() => onSet({ shift: cell.shift === s ? null : s })} className={`px-3 py-1.5 rounded-lg text-sm font-mono font-bold transition-colors ${cell.shift === s ? `${SHIFT_ON[s]} text-f-ink` : "bg-f-panel2 hover:bg-f-border text-f-text"}`}>{s}</button>
        ))}
        {allowDuel && (
          <button onClick={() => onSet({ duel: !cell.duel })} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${cell.duel ? "bg-f-duel text-f-ink" : "bg-f-panel2 hover:bg-f-border text-f-text"}`}>Duel</button>
        )}
      </div>
      {allowDuel && (
        <div className="text-xs text-f-faint -mt-1 mb-2">Duel sa dá zapnúť samostatne alebo spolu so smenou (typicky piaty deň cyklu). Platí iba pre rolu kamera.</div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={cell.note}
          onChange={(e) => onSet({ note: e.target.value })}
          placeholder="poznámka"
          className="px-2 py-1.5 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-40"
        />
        <select
          value=""
          onChange={(e) => e.target.value && onSwap(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text"
        >
          <option value="">Vymeniť s…</option>
          {crew.filter((c) => c.id !== sel.crewId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}
