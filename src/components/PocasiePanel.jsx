import { popisPocasia, casNaHHMM, skDenSkratka } from "../pocasie";

/* Sekcia 7 briefu: "V menu: predpoveď na celý týždeň." Server posiela dáta,
   ktoré si sám cachuje ~1x za hodinu — appka ich tu len vypíše, žiadne ďalšie
   volania odtiaľto nejdú. */
export default function PocasiePanel({ pocasie, onClose }) {
  const dni = pocasie?.dni || [];
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-4 no-print">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Počasie — Doľany</div>
        <button onClick={onClose} className="ml-auto text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>
      <div className="text-[11px] text-f-faint mb-3.5">
        Predpoveď na týždeň dopredu, zdroj Open-Meteo.
        {pocasie?.ziskane && (
          <>
            {" "}Naposledy načítané{" "}
            {new Date(pocasie.ziskane).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
            {pocasie.stale && " (staršie dáta — čerstvé sa teraz nepodarilo načítať)"}.
          </>
        )}
      </div>

      {!dni.length && <div className="text-sm text-f-faint2">Počasie sa nepodarilo načítať.</div>}

      {!!dni.length && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
          {dni.map((d) => {
            const p = popisPocasia(d.kod);
            return (
              <div key={d.datum} className="rounded-lg bg-f-panel2 border border-f-border px-3 py-2.5 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-f-muted2">
                  {skDenSkratka(d.datum)} {d.datum.slice(8, 10)}.{d.datum.slice(5, 7)}.
                </div>
                <div className="text-2xl my-1" title={p.text}>{p.ikona}</div>
                <div className="text-[11px] text-f-faint mb-1">{p.text}</div>
                <div className="text-sm font-mono">
                  <span className="font-bold text-f-text">{d.tMax ?? "—"}°</span>
                  <span className="text-f-faint2"> / {d.tMin ?? "—"}°</span>
                </div>
                {(d.vychod || d.zapad) && (
                  <div className="text-[10px] font-mono text-f-faint2 mt-1">
                    ↑{casNaHHMM(d.vychod)} ↓{casNaHHMM(d.zapad)}
                  </div>
                )}
                {Number.isFinite(d.zrazky) && (
                  <div className="text-[10px] font-mono text-f-faint2">💧{d.zrazky}%</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
