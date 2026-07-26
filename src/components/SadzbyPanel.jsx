import { ROLES } from "../constants";
import { DEFAULT_SADZBY, sadzbaProfesie, eur, naCenty } from "../vykazy";

/* Denné sadzby profesií (Fáza 2).
   Meniť ich smie iba hlavný admin a hlavný produkčný — server to kontroluje ešte raz.
   Ostatní panel vidia, ale iba na čítanie, nech vedia, z čoho sa im ráta výkaz. */

const POLIA = [
  { key: "den", label: "Smena (A/B/C/R)", hint: "Bežný odpracovaný deň." },
  { key: "duel", label: "Samotný Duel", hint: "Duel bez smeny — typicky piaty deň cyklu." },
  { key: "denDuel", label: "Smena + Duel", hint: "Keď v jeden deň robí smenu aj Duel." },
];

export default function SadzbyPanel({ sadzby, canEdit, onSetSadzba, onClose }) {
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-4 no-print">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Sadzby — koľko je deň</div>
        <div className="ml-auto text-[11px] font-bold uppercase tracking-wider text-f-faint cursor-pointer" onClick={onClose}>Zavrieť</div>
      </div>
      <div className="text-[11px] text-f-faint mb-3.5">
        {canEdit
          ? "Sumy v eurách za deň. Zmena sa prejaví vo všetkých výkazoch naraz, aj v už odrobených dňoch."
          : "Iba na prezeranie — sadzby mení hlavný admin alebo hlavný produkčný."}
      </div>

      <div className="flex flex-col gap-4">
        {ROLES.map((r) => {
          const s = sadzbaProfesie(sadzby, r.key);
          const predvolene = DEFAULT_SADZBY[r.key] || DEFAULT_SADZBY.kamera;
          const jeKamera = r.key === "kamera";
          const polia = jeKamera ? POLIA : POLIA.filter((p) => p.key === "den");
          return (
            <div key={r.key} className="border border-f-border rounded-lg p-3 bg-f-panel2/40">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-f-text mb-2">{r.label}</div>

              {polia.map((p) => {
                const hodnota = s[p.key];
                const zmenene = Number(hodnota) !== Number(predvolene[p.key]);
                return (
                  <div key={p.key} className="flex items-center gap-3 py-2 border-t border-f-hair">
                    <div className="min-w-0">
                      <div className="text-xs text-f-text">{p.label}</div>
                      <div className="text-[10px] text-f-faint2">{p.hint}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      {canEdit ? (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="1"
                            value={hodnota}
                            onChange={(e) => onSetSadzba(r.key, { [p.key]: e.target.value })}
                            className="w-24 px-2 py-1 rounded-lg bg-f-panel2 border border-f-border text-f-text text-xs font-mono text-right"
                          />
                          <span className="text-f-faint text-xs">€</span>
                        </>
                      ) : (
                        <span className="font-mono text-xs font-bold text-f-text">{eur(naCenty(hodnota))}</span>
                      )}
                      {zmenene && <span title="Zmenené oproti predvolenému" className="text-f-accent text-xs">•</span>}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center gap-3 py-2 border-t border-f-hair">
                <div className="min-w-0">
                  <div className="text-xs text-f-text">Nadčas — hodina</div>
                  <div className="text-[10px] text-f-faint2">
                    Percento z toho, čo v ten deň zarobil. Bežný deň {eur(naCenty(s.den) * (Number(s.nadcasPct) || 0) / 100)}/h
                    {jeKamera && <>, deň so smenou aj Duelom {eur(naCenty(s.denDuel) * (Number(s.nadcasPct) || 0) / 100)}/h</>}.
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  {canEdit ? (
                    <>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="1"
                        value={s.nadcasPct}
                        onChange={(e) => onSetSadzba(r.key, { nadcasPct: e.target.value })}
                        className="w-24 px-2 py-1 rounded-lg bg-f-panel2 border border-f-border text-f-text text-xs font-mono text-right"
                      />
                      <span className="text-f-faint text-xs">%</span>
                    </>
                  ) : (
                    <span className="font-mono text-xs font-bold text-f-text">{s.nadcasPct} %</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="text-[10px] text-f-faint2 mt-3 leading-relaxed">
          Réžia a loggeri Duel nerobia, preto majú iba jednu dennú sadzbu.
          Predvolené čísla sú len odhad — prepíš ich na skutočné.
        </div>
      )}
    </div>
  );
}
