import { useMemo, useState } from "react";
import { SK_MONTHS } from "../constants";
import { vykazOsoby, eur, hod } from "../vykazy";

/* Uzávierka mesiaca + história vyplateného (sekcia 6 finálneho briefu).

   Admin (alebo hlavný produkčný) uzavrie mesiac — appka vtedy zráta výkaz KAŽDÉHO
   v štábe presne taký, aký je v tejto chvíli, a ULOŽÍ ho ako zmrazenú kópiu na
   server. To je ten "dôkaz pri duálnom režime" z briefu: aj keby sa neskôr zmenili
   sadzby alebo niekto opravil bunku v rozpise, uzavretý mesiac to nezmení — vidno
   presne to, čo bolo v deň uzávierky.

   Kým je mesiac uzavretý, nadčas v ňom nejde zmeniť (server to stráži). Zrušiť sa
   dá — ale iba označením "zrušené", pôvodný záznam ostáva navždy vidieť ako dôkaz,
   že mesiac bol uzavretý a kedy/kým bol zrušený. Nič sa nikdy tichým prepisom nestratí. */

/** "2026-08" -> "August 2026" */
function mesiacLabel(mesiac) {
  const [y, m] = String(mesiac || "").split("-").map(Number);
  if (!y || !m) return mesiac;
  return `${SK_MONTHS[m - 1]} ${y}`;
}

function kedLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("sk-SK", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function UzavierkyPanel({ uzavierky, crew, cellOf, sadzby, days, canEdit, onUzavriet, onZrusit, onClose }) {
  const mesiace = useMemo(() => {
    const seen = [];
    for (const d of days) { const m = d.iso.slice(0, 7); if (!seen.includes(m)) seen.push(m); }
    return seen;
  }, [days]);

  const [vybranyMesiac, setVybranyMesiac] = useState(mesiace[0] || "");

  // história pre vybraný mesiac — všetky záznamy (aj zrušené), najnovší hore
  const historiaMesiaca = useMemo(
    () => (uzavierky || []).filter((u) => u.mesiac === vybranyMesiac).sort((a, b) => String(b.ked).localeCompare(String(a.ked))),
    [uzavierky, vybranyMesiac],
  );
  const aktivna = historiaMesiaca.find((u) => !u.zrusene) || null;

  // živý náhľad (kým mesiac nie je uzavretý) — presne to isté, čo by sa zmrazilo
  const nahlad = useMemo(() => {
    if (aktivna) return null; // uzavretý mesiac sa už nedopočítava naživo, ukazuje sa zmrazený záznam
    const dniMesiaca = days.filter((d) => d.iso.slice(0, 7) === vybranyMesiac);
    return crew.map((osoba) => vykazOsoby({ osoba, dni: dniMesiaca, cellOf, sadzby }));
  }, [aktivna, days, vybranyMesiac, crew, cellOf, sadzby]);

  const spoluZaznamu = (vyplatene) => (vyplatene || []).reduce((a, v) => a + (v.spoluC || 0), 0);

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Uzávierky mesiacov</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      <div className="text-[11px] text-f-faint2 mb-2.5 leading-relaxed">
        Uzavretím sa zmrazí výkaz celého štábu presne taký, aký je v tejto chvíli — slúži ako
        dôkaz, čo bolo vyplatené. Nadčas v uzavretom mesiaci sa už nedá meniť, kým sa uzávierka nezruší.
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2.5">
        {mesiace.map((m) => {
          const uzavrety = (uzavierky || []).some((u) => u.mesiac === m && !u.zrusene);
          return (
            <button
              key={m}
              onClick={() => setVybranyMesiac(m)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 ${
                vybranyMesiac === m ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:text-f-text"
              }`}
            >
              {SK_MONTHS[Number(m.slice(5, 7)) - 1]}
              {uzavrety && <span title="Uzavreté">🔒</span>}
            </button>
          );
        })}
      </div>

      {!vybranyMesiac && <div className="text-sm text-f-faint">Zatiaľ nie je z čoho vyberať.</div>}

      {vybranyMesiac && (
        <>
          <div className="text-xs font-bold text-f-text mb-2">{mesiacLabel(vybranyMesiac)}</div>

          {aktivna ? (
            <div className="rounded-md bg-f-panel border border-f-border p-2.5 mb-3">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[11px] font-bold text-f-a">🔒 Uzavreté</span>
                <span className="text-[10px] text-f-faint2">{kedLabel(aktivna.ked)} · {aktivna.kym?.name || aktivna.kym?.email || "neznámy"}</span>
                <span className="ml-auto font-mono text-sm font-extrabold text-f-text">{eur(spoluZaznamu(aktivna.vyplatene))}</span>
              </div>
              <div className="space-y-1">
                {(aktivna.vyplatene || []).map((v) => (
                  <div key={v.crewId} className="flex items-baseline gap-2 text-[11.5px] border-t border-f-hair pt-1">
                    <span className="text-f-text font-bold min-w-0 truncate">{v.meno}</span>
                    {v.hodiny ? <span className="text-f-faint2 shrink-0">{hod(v.hodiny)} nadčas</span> : null}
                    <span className="ml-auto font-mono text-f-text shrink-0">{eur(v.spoluC)}</span>
                  </div>
                ))}
                {!(aktivna.vyplatene || []).length && <div className="text-[11px] text-f-faint2">Nikto v tomto mesiaci nič nezarobil.</div>}
              </div>
              {canEdit && (
                <button
                  onClick={() => { if (confirm(`Naozaj zrušiť uzávierku za ${mesiacLabel(vybranyMesiac)}? Záznam ostane v histórii, ale nadčas sa dá znova meniť.`)) onZrusit(aktivna.id); }}
                  className="mt-2.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-panel2 hover:bg-f-r hover:text-f-ink text-f-muted"
                >
                  Zrušiť uzávierku
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-md bg-f-panel border border-f-border p-2.5 mb-3">
              <div className="text-[11px] text-f-faint2 mb-2">Mesiac nie je uzavretý — toto je náhľad, čo by sa zmrazilo.</div>
              <div className="space-y-1">
                {(nahlad || []).map((v) => (
                  <div key={v.osoba.id} className="flex items-baseline gap-2 text-[11.5px] border-t border-f-hair pt-1">
                    <span className="text-f-text font-bold min-w-0 truncate">{v.osoba.name}</span>
                    {v.hodiny ? <span className="text-f-faint2 shrink-0">{hod(v.hodiny)} nadčas</span> : null}
                    <span className="ml-auto font-mono text-f-text shrink-0">{eur(v.spoluC)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline gap-2 mt-2 pt-2 border-t border-f-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-f-faint">Spolu</span>
                <span className="ml-auto font-mono text-sm font-extrabold text-f-text">
                  {eur((nahlad || []).reduce((a, v) => a + v.spoluC, 0))}
                </span>
              </div>
              {canEdit && (
                <button
                  onClick={() => { if (confirm(`Uzavrieť ${mesiacLabel(vybranyMesiac)}? Výkaz sa zmrazí presne taký, aký je teraz, a nadčas sa v tomto mesiaci prestane dať meniť.`)) onUzavriet(vybranyMesiac); }}
                  className="mt-2.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-f-a text-f-ink"
                >
                  Uzavrieť mesiac
                </button>
              )}
            </div>
          )}

          {historiaMesiaca.length > (aktivna ? 1 : 0) && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-f-faint mb-1">História tohto mesiaca</div>
              <div className="space-y-1">
                {historiaMesiaca.filter((u) => u !== aktivna).map((u) => (
                  <div key={u.id} className="flex items-center gap-2 flex-wrap rounded-md bg-f-panel2 border border-f-border px-2 py-1.5 text-[11px]">
                    <span className={u.zrusene ? "text-f-faint2 line-through" : "text-f-text"}>
                      {kedLabel(u.ked)} · {u.kym?.name || u.kym?.email || "neznámy"}
                    </span>
                    {u.zrusene && <span className="text-f-faint2">zrušené {kedLabel(u.zrusene)}</span>}
                    <span className="ml-auto font-mono text-f-faint2">{eur(spoluZaznamu(u.vyplatene))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!canEdit && (
        <div className="text-[11px] text-f-faint2 mt-2.5">Iba na čítanie — uzávierku smie robiť iba hlavný admin alebo hlavný produkčný.</div>
      )}
    </div>
  );
}
