import { useMemo, useState } from "react";
import { SK_MONTHS, ROLE_LABELS } from "../constants";
import { skDate } from "../dateUtils";
import { vykazOsobyObdobie, eur, hod } from "../vykazy";
import { exportVykazXLSX, exportVykazCSV, tlacVykaz } from "../vykazExport";

/* Mesačné výkazy (Fáza 2).
   Kto vidí čo: štáb a viewer iba svoj vlastný výkaz, vedúci a produkčný celý štáb.
   Server pri ukladaní kontroluje práva znova — tu ide iba o to, čo sa zobrazí. */

function Suhrn({ v }) {
  const kusky = [];
  if (v.pocetSmien) kusky.push(`${v.pocetSmien}× smena`);
  if (v.pocetDuelov) kusky.push(`${v.pocetDuelov}× Duel`);
  if (v.pocetKombi) kusky.push(`${v.pocetKombi}× smena + Duel`);
  if (v.hodiny) kusky.push(`${hod(v.hodiny)} nadčas`);
  if (v.pocetOff) kusky.push(`${v.pocetOff}× nemohol`);
  if (kusky.length) return <>{kusky.join(" · ")}</>;
  // Staršia uzávierka (spred tejto opravy) nemala uložený podrobný rozpis —
  // keby sa tu ticho ukázalo "žiadne odrobené dni" napriek kladnej sume
  // vyššie, vyzeralo by to ako protirečenie (a bolo by to zavádzajúce).
  if (!v.maRiadky && v.spoluC) return <>podrobnosti nie sú k tejto staršej uzávierke uložené</>;
  return <>žiadne odrobené dni</>;
}

function DetailDni({ v }) {
  if (!v.maRiadky) {
    return (
      <div className="mt-1.5 border-t border-f-hair pt-1.5 text-[11px] text-f-faint2">
        {v.spoluC
          ? "Táto uzávierka vznikla ešte predtým, než appka ukladala aj rozpis podľa jednotlivých dní — vidno iba súčet vyššie."
          : "V tomto období nič."}
      </div>
    );
  }
  if (!v.riadky.length) return <div className="text-[11px] text-f-faint2 py-2">V tomto období nič.</div>;
  return (
    <div className="mt-1.5 border-t border-f-hair">
      {v.riadky.map((r) => (
        <div key={r.iso} className="flex items-baseline gap-2 py-1.5 border-b border-f-hair text-[11px] font-mono">
          <span className="text-f-muted2 w-14 shrink-0">{skDate(r.iso)}</span>
          <span className="text-f-text min-w-0 flex-1">
            {r.popis || "—"}
            {r.hodiny ? <span className="text-f-muted2"> + {hod(r.hodiny)}</span> : null}
            {r.hodinyBezSmeny ? (
              <span className="text-f-accent"> · nahlásených {hod(r.hodinyBezSmeny)} bez smeny, neplatí sa</span>
            ) : null}
          </span>
          <span className="text-f-text font-bold shrink-0">{r.spoluC ? eur(r.spoluC) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

export default function VykazyPanel({
  crew, dni, cellOf, sadzby, uzavierky, me, canSeeAll, mesiacIdx, mesiace, onSetMesiac, onClose,
}) {
  const [otvoreny, setOtvoreny] = useState(null);

  // koho výkazy vôbec smie tento človek vidieť
  const ktorych = useMemo(() => {
    if (canSeeAll) return crew;
    if (me?.crewId) return crew.filter((c) => String(c.id) === String(me.crewId));
    return [];
  }, [crew, canSeeAll, me]);

  // Pre uzavretý mesiac sa berie zmrazený záznam z uzávierky (presne to, čo
  // bolo vyplatené), nie prepočet naživo — inak by neskoršia zmena sadzby
  // alebo opravená bunka v rozpise ticho zmenila aj to, čo appka ukazuje ako
  // "uzavreté", a uzávierka by tak prestala byť dôkazom (viď UzavierkyPanel).
  const vykazy = useMemo(
    () => ktorych.map((osoba) => vykazOsobyObdobie({ osoba, dni, cellOf, sadzby, uzavierky })),
    [ktorych, dni, cellOf, sadzby, uzavierky],
  );

  const spolu = useMemo(
    () => vykazy.reduce((a, v) => ({
      zakladC: a.zakladC + v.zakladC,
      nadcasC: a.nadcasC + v.nadcasC,
      spoluC: a.spoluC + v.spoluC,
      hodiny: a.hodiny + v.hodiny,
      dni: a.dni + v.pocetPlatenychDni,
    }), { zakladC: 0, nadcasC: 0, spoluC: 0, hodiny: 0, dni: 0 }),
    [vykazy],
  );

  const mesiacLabel = mesiacIdx === null ? "celá produkcia" : `${SK_MONTHS[mesiacIdx]} 2026`;
  const ktoDoNazvu = !canSeeAll && vykazy[0] ? vykazy[0].osoba.name : "";

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-4 tlac-vykaz">
      <div className="flex items-center gap-2 mb-1 no-print">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">
          Výkazy — {canSeeAll ? "celý štáb" : "môj výkaz"}
        </div>
        <button onClick={onClose} className="ml-auto text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>

      {/* výber mesiaca */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 no-print">
        <button
          onClick={() => onSetMesiac(null)}
          className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${mesiacIdx === null ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:text-f-text"}`}
        >
          Celá produkcia
        </button>
        {mesiace.map((m) => (
          <button
            key={m}
            onClick={() => onSetMesiac(m)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${mesiacIdx === m ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:text-f-text"}`}
          >
            {SK_MONTHS[m]}
          </button>
        ))}
      </div>

      {/* hlavička na papier */}
      <div className="hidden print:block mb-3">
        <div className="text-sm font-extrabold">FARMA 18 — výkaz {mesiacLabel}</div>
      </div>

      {vykazy.length === 0 ? (
        <div className="text-[11px] text-f-faint2 py-3">
          Tvoj účet zatiaľ nie je prepojený s človekom v rozpise, takže sa nemá čo zrátať.
          Prepojenie nastaví hlavný admin v Prístupoch.
        </div>
      ) : (
        <>
          {/* súčet za všetkých — len pre vedúcich a produkčného */}
          {canSeeAll && (
            <div className="flex items-baseline gap-2 py-2 mb-1 border-y border-f-border">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-f-text">
                Spolu {mesiacLabel}
                {vykazy.length > 0 && vykazy.every((v) => v.zamrznuty) && (
                  <span className="ml-1.5" title="Zmrazené uzávierkou — nemení sa ani pri neskoršej zmene sadzby alebo rozpisu">🔒</span>
                )}
              </div>
              <div className="text-[10px] text-f-faint2">{spolu.dni} platených dní · {hod(spolu.hodiny) || "0 h"} nadčas</div>
              <div className="ml-auto font-mono text-sm font-extrabold text-f-text">{eur(spolu.spoluC)}</div>
            </div>
          )}

          <div className="flex flex-col">
            {vykazy.map((v, i) => {
              const je = String(otvoreny) === String(v.osoba.id);
              return (
                <div key={v.osoba.id} className={`py-2 border-b border-f-hair tlac-strana ${i > 0 && canSeeAll ? "tlac-zlom-pred" : ""}`}>
                  <button
                    onClick={() => setOtvoreny(je ? null : v.osoba.id)}
                    className="w-full text-left flex items-baseline gap-2"
                  >
                    <span className="text-xs font-bold text-f-text min-w-0 truncate">{v.osoba.name}</span>
                    <span className="text-[10px] text-f-faint2 shrink-0 hidden sm:inline">
                      {ROLE_LABELS[v.osoba.role || "kamera"]}
                    </span>
                    {v.zamrznuty && (
                      <span className="text-[10px] shrink-0" title="Zmrazené uzávierkou — nemení sa ani pri neskoršej zmene sadzby alebo rozpisu">🔒</span>
                    )}
                    <span className="ml-auto font-mono text-xs font-extrabold text-f-text shrink-0">{eur(v.spoluC)}</span>
                    <span className="text-f-faint text-[10px] shrink-0 no-print">{je ? "▲" : "▼"}</span>
                  </button>

                  <div className="text-[10px] text-f-faint2 mt-0.5">
                    <Suhrn v={v} />
                    {v.nadcasC ? <> · z toho nadčas {eur(v.nadcasC)}</> : null}
                  </div>

                  <div className={je ? "" : "hidden print:block"}>
                    <DetailDni v={v} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* sťahovanie */}
          <div className="flex flex-wrap gap-2 mt-3 no-print">
            <button
              onClick={() => exportVykazXLSX(vykazy, mesiacIdx, ktoDoNazvu)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
            >
              Stiahnuť XLSX
            </button>
            <button
              onClick={() => exportVykazCSV(vykazy, mesiacIdx, ktoDoNazvu)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
            >
              CSV
            </button>
            <button
              onClick={tlacVykaz}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
            >
              Tlač / PDF
            </button>
          </div>

          <div className="text-[10px] text-f-faint2 mt-2 leading-relaxed no-print">
            Nadčas si každý nahlasuje sám v detaile dňa — hodina je percento z toho, čo v ten deň zarobil.
            Vedúci aj produkčný vidia každú nahlásenú hodinu a vedia ju opraviť; každá zmena je v Histórii.
          </div>
        </>
      )}
    </div>
  );
}
