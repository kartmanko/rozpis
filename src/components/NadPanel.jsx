import { NAD_SHIFTS } from "../constants";

// Časy NAD (ateliéry, odkiaľ vozia štáb na plac) sú univerzálne pre celú produkciu —
// viažu sa na smenu (A/B/C/R/Duel), nie na konkrétny dátum. Admin ich vyplní raz,
// mení len výnimočne. Pre viewera je panel len na čítanie.
export default function NadPanel({ nad, canEdit, onSetNad, onClose }) {
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-4 no-print">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">NAD — časy odchodov a návratov</div>
        <div className="ml-auto text-[11px] font-bold uppercase tracking-wider text-f-faint cursor-pointer" onClick={onClose}>Zavrieť</div>
      </div>
      <div className="text-[11px] text-f-faint mb-3.5">Odchod štábu z ateliérov na plac a návrat späť — rovnaké pre každý deň, viažu sa na smenu.</div>

      <div className="max-w-sm">
        {NAD_SHIFTS.map((s) => {
          const cur = nad?.[s.key] || { depart: "", return: "" };
          return (
            <div key={s.key} className="flex items-center gap-3 py-2.5 border-t border-f-hair font-mono text-xs">
              <div className="text-f-muted2 w-16">{s.label}</div>
              {canEdit ? (
                <div className="flex gap-2 items-center ml-auto">
                  <input
                    type="time"
                    value={cur.depart}
                    onChange={(e) => onSetNad(s.key, { depart: e.target.value })}
                    className="px-2 py-1 rounded-lg bg-f-panel2 border border-f-border text-f-text text-xs"
                  />
                  <span className="text-f-faint">→</span>
                  <input
                    type="time"
                    value={cur.return}
                    onChange={(e) => onSetNad(s.key, { return: e.target.value })}
                    className="px-2 py-1 rounded-lg bg-f-panel2 border border-f-border text-f-text text-xs"
                  />
                </div>
              ) : (
                <div className="ml-auto font-bold text-f-r">
                  {cur.depart || cur.return ? `${cur.depart || "—"} → ${cur.return || "—"}` : <em className="not-italic text-f-faint2">—</em>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
