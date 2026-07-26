import { cycleInfo, toUTC } from "../dateUtils";
import { REHEARSALS, ROLES, SK_DAYS_FULL } from "../constants";

const SHIFT_ORDER = { A: 0, B: 1, C: 2, R: 3 };
const CHIP_BADGE = {
  A: "bg-f-a",
  B: "bg-f-b",
  C: "bg-f-c",
  R: "bg-f-r",
};

export default function DayDetail({ iso, crew, cellOf, reporty, dispo, onClose }) {
  const ci = cycleInfo(iso);
  const reh = REHEARSALS.includes(iso);
  const d = new Date(toUTC(iso));
  const dayNum = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  const dowFull = SK_DAYS_FULL[d.getUTCDay()];

  /* Denné reporty priradené k tomuto dňu (Fáza 4). Môže ich byť aj viac —
     každá správa z reportovej skupiny je samostatný report. */
  const dnesneReporty = Object.values(reporty || {})
    .filter((r) => r.datum === iso)
    .sort((a, b) => String(a.prislo).localeCompare(String(b.prislo)));

  /* Harmonogram dňa z dispozície (Fáza 5). Je tu iba to, čo už niekto v paneli
     „Dispo“ potvrdil — nepotvrdené návrhy sa v detaile dňa neukazujú. */
  const denneDispo = (dispo || {})[iso];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 no-print" onClick={onClose}>
      <div
        className="bg-f-panel3 border-t-[3px] sm:border-t-[3px] border-f-accent shadow-xl w-full sm:w-[min(92vw,26rem)] sm:rounded-b-xl max-h-[85vh] overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2.5 mb-0.5">
          <div className="text-2xl font-extrabold tracking-tight text-f-text">{dayNum}.{monthIdx + 1}.</div>
          <div className="text-xs text-f-muted2">{dowFull.toLowerCase()}</div>
          <div className="ml-auto text-[11px] font-bold uppercase tracking-wider text-f-faint cursor-pointer" onClick={onClose}>Zavrieť</div>
        </div>
        <div className="font-mono text-[10.5px] text-f-r tracking-wide mb-3.5">
          {reh ? "SKÚŠKY" : ci.n ? `CYKLUS ${ci.n} · DEŇ ${ci.pos}/5` : "MIMO CYKLU"}
        </div>

        {ROLES.map((r) => {
          const people = crew.filter((c) => (c.role || "kamera") === r.key);
          const working = people
            .map((c) => ({ c, x: cellOf(iso, c.id) }))
            .filter(({ x }) => x.shift || x.duel)
            .sort((p1, p2) => (SHIFT_ORDER[p1.x.shift] ?? 9) - (SHIFT_ORDER[p2.x.shift] ?? 9));
          if (!working.length) return null;
          return (
            <div key={r.key} className="flex gap-2.5 items-start py-2.5 border-t border-f-hair">
              <div className="text-[9.5px] font-bold tracking-wider text-f-faint w-14 flex-none pt-1 uppercase">{r.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {working.map(({ c, x }) => (
                  <span key={c.id} className="text-xs font-semibold pl-1 pr-2.5 py-1 rounded-lg bg-f-panel2 text-f-text/90 border border-f-border flex gap-1.5 items-center">
                    {x.shift && <u className={`not-italic font-mono text-[10.5px] font-bold text-f-ink rounded px-1.5 py-0.5 ${CHIP_BADGE[x.shift] || "bg-f-a"}`}>{x.shift}</u>}
                    {x.duel && <u className="not-italic font-mono text-[10.5px] font-bold text-f-ink rounded px-1.5 py-0.5 bg-f-duel">D</u>}
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        {denneDispo && (denneDispo.harmonogram || []).length > 0 && (
          <div className="border-t border-f-hair pt-2.5 mt-2.5">
            <div className="text-[9.5px] font-bold tracking-wider text-f-faint uppercase mb-1.5">Harmonogram</div>
            <div className="space-y-0.5">
              {denneDispo.harmonogram.map((h, i) => (
                <div key={i} className="text-[12.5px] text-f-text flex gap-2.5">
                  <span className="font-mono text-[11.5px] font-bold text-f-accent shrink-0 w-11">{h.cas}</span>
                  <span className="min-w-0">{h.text}</span>
                </div>
              ))}
            </div>
            {denneDispo.poznamky && (
              <div className="text-[11.5px] text-f-muted2 whitespace-pre-wrap mt-1.5">{denneDispo.poznamky}</div>
            )}
          </div>
        )}

        {dnesneReporty.length > 0 && (
          <div className="border-t border-f-hair pt-2.5 mt-2.5">
            <div className="text-[9.5px] font-bold tracking-wider text-f-faint uppercase mb-1.5">
              Report{dnesneReporty.length > 1 ? `y (${dnesneReporty.length})` : ""}
            </div>
            {dnesneReporty.map((r) => (
              <div key={r.id} className="mb-2 last:mb-0">
                <div className="text-[10px] text-f-faint2">
                  {r.autor || "neznámy"}
                  {r.zdrojDatumu === "sprava" && <span className="text-f-accent"> · dátum podľa dňa doručenia</span>}
                </div>
                <div className="text-[12.5px] text-f-text whitespace-pre-wrap leading-relaxed">{r.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
