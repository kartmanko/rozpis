import { useMemo, useState } from "react";
import { toUTC } from "../dateUtils";
import { SK_DAYS_FULL } from "../constants";

/** "2026-08-15" -> "sobota 15.8.2026"; nezmyselný dátum sa nemá tváriť ako dátum. */
function denText(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "bez dňa";
  const d = new Date(toUTC(iso));
  if (Number.isNaN(d.getTime())) return "bez dňa";
  return `${SK_DAYS_FULL[d.getUTCDay()].toLowerCase()} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

/* Denné reporty (Fáza 4).

   Reporty chodia z osobitnej WhatsApp skupiny, ktorú admin v paneli
   „WhatsApp chaty" prepne na druh „Reporty". Jedna správa = jeden report.
   Obsah sa nijako nerozoberá — server v ňom hľadá iba dátum dňa, ktorého sa
   report týka. Keď dátum v texte nie je, priradí sa deň, kedy správa prišla,
   a v zozname je to zreteľne označené, aby to vedel niekto prehodiť. */

export default function ReportyPanel({ reporty, canEdit, onSetDatum, onPotvrdDen, onZmazat, onClose }) {
  const [hladanie, setHladanie] = useState("");
  const [otvoreny, setOtvoreny] = useState(null);

  const zoznam = useMemo(() => {
    const h = hladanie.trim().toLowerCase();
    return Object.values(reporty || {})
      .filter((r) => !h || String(r.text || "").toLowerCase().includes(h) || String(r.autor || "").toLowerCase().includes(h))
      // najnovší deň hore; v rámci dňa najnovšia správa hore
      .sort((a, b) => String(b.datum).localeCompare(String(a.datum)) || String(b.prislo).localeCompare(String(a.prislo)));
  }, [reporty, hladanie]);

  const celkom = Object.keys(reporty || {}).length;

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Denné reporty</div>
        <span className="text-[11px] text-f-faint2 font-mono">{celkom}</span>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      {!celkom && (
        <div className="text-sm text-f-faint leading-relaxed">
          Zatiaľ tu nie je žiadny report. Reporty sa sem dostanú samy zo skupiny, ktorú
          v paneli „WhatsApp chaty" prepneš na druh <b>Reporty</b>.
        </div>
      )}

      {celkom > 0 && (
        <>
          <input
            value={hladanie}
            onChange={(e) => setHladanie(e.target.value)}
            placeholder="Hľadať v reportoch…"
            className="w-full mb-2.5 bg-f-panel2 border border-f-border rounded-lg px-2.5 py-1.5 text-sm text-f-text placeholder:text-f-faint2"
          />

          {!zoznam.length && <div className="text-sm text-f-faint">Nič sa nenašlo.</div>}

          <div className="space-y-1.5">
            {zoznam.map((r) => {
              const rozbaleny = otvoreny === r.id;
              return (
                <div key={r.id} className="border border-f-border rounded-lg bg-f-panel2 overflow-hidden">
                  <button
                    onClick={() => setOtvoreny(rozbaleny ? null : r.id)}
                    className="w-full text-left p-2 flex items-start gap-2"
                  >
                    <div className="min-w-0 grow">
                      <div className="text-xs font-bold text-f-text">
                        {denText(r.datum)}
                        {r.zdrojDatumu === "sprava" && (
                          <span className="ml-1.5 text-[10px] font-normal text-f-accent">dátum podľa dňa doručenia</span>
                        )}
                      </div>
                      <div className="text-[10px] text-f-faint2 truncate">{r.autor || "neznámy"}</div>
                      {!rozbaleny && (
                        <div className="text-[11px] text-f-muted2 mt-0.5 line-clamp-2">{String(r.text || "").slice(0, 160)}</div>
                      )}
                    </div>
                    <span className="text-f-faint text-xs shrink-0 pt-0.5">{rozbaleny ? "▲" : "▼"}</span>
                  </button>

                  {rozbaleny && (
                    <div className="px-2 pb-2">
                      <div className="text-[12.5px] text-f-text whitespace-pre-wrap leading-relaxed border-t border-f-hair pt-2">
                        {r.text}
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Deň</label>
                          <input
                            type="date"
                            value={r.datum || ""}
                            onChange={(e) => onSetDatum(r.id, e.target.value)}
                            className="bg-f-panel border border-f-border rounded-md px-2 py-1 text-xs text-f-text"
                          />
                          {r.zdrojDatumu === "sprava" && (
                            <button
                              onClick={() => onPotvrdDen(r.id)}
                              className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-a text-f-ink"
                            >
                              Deň sedí
                            </button>
                          )}
                          <button
                            onClick={() => { if (confirm("Naozaj zmazať tento report?")) { onZmazat(r.id); setOtvoreny(null); } }}
                            className="ml-auto px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-panel hover:bg-f-r hover:text-f-ink text-f-muted"
                          >
                            Zmazať
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!canEdit && celkom > 0 && (
        <div className="text-[11px] text-f-faint2 mt-2">Iba na čítanie — deň reportu smú prehodiť vedúci a hlavný admin.</div>
      )}
    </div>
  );
}
