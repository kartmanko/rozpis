import { useMemo, useState } from "react";
import { SK_MONTHS, SK_DAYS_FULL } from "../constants";
import { todayIso, skDate } from "../dateUtils";

/* "Domov štábu" (sekcia 4 finálneho briefu) — mesačný kalendár namiesto celej
   tabuľky rozpisu. Štáb (rola "stab") nemá dôvod listovať celým rozpisom celej
   posádky, zaujíma ho iba jeho vlastný stĺpec — a tabuľka s desiatkami stĺpcov
   je na telefóne na to zle čitateľná. Toto ukazuje iba jeho dni, po mesiacoch.

   Smenu, Duel a poznámku prideľuje vedúci (cellAccess vráti "off", nie "full")
   — v kalendári sú preto iba na čítanie. Prepínač "nemôžem" a nahlásenie nadčasu
   ostávajú funkčné, ale bez znovu-vymýšľania: klik na deň otvorí presne ten istý
   CellEditor (access="off"), čo používa aj tabuľka pri vlastnej bunke člena
   štábu — ukladanie teda ide cez už existujúci setCell/commitCells v App.jsx.

   "Môj dnešok" (dorobené dodatočne, tá istá sekcia briefu) — kartička nad
   kalendárom, nech človek nemusí v mriežke hľadať, kde je dnešok a čo sa
   v ňom deje. A "preklik na celý rozpis": klik na ČÍSLO dňa (nie na zvyšok
   bunky) otvorí ten istý DayDetail, čo používa tabuľka pre ostatné role
   (onDayClick={setDayDetailIso} v App.jsx) — takže štáb vidí aj to, čo sám
   upraviť nesmie: kto iný v ten deň pracuje, dispo, denné role. */

const SHIFT_BADGE = { A: "bg-f-a", B: "bg-f-b", C: "bg-f-c", R: "bg-f-r" };
const SK_DAYS_MON_FIRST = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

const isoOfYMD = (y, monthIdx, d) => `${y}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function MojKalendar({ me, crew, days, cellOf, dispo, denneRoly, onCellClick, onDayClick }) {
  const person = useMemo(() => (crew || []).find((c) => c.id === me?.crewId) || null, [crew, me]);

  // mesiace, v ktorých sezóna vôbec beží (rovnaká konvencia ako UzavierkyPanel)
  const mesiace = useMemo(() => {
    const seen = [];
    for (const d of days) { const m = d.iso.slice(0, 7); if (!seen.includes(m)) seen.push(m); }
    return seen;
  }, [days]);

  const [mesiacIdx, setMesiacIdx] = useState(() => {
    const ted = todayIso().slice(0, 7);
    const i = mesiace.indexOf(ted);
    return i >= 0 ? i : 0;
  });
  const mesiac = mesiace[mesiacIdx] || mesiace[0] || "";

  const dniByIso = useMemo(() => new Map(days.map((d) => [d.iso, d])), [days]);

  // Týždne ako riadky, dni ako bunky (pondelok prvý, slovenská konvencia). Dni mimo
  // sezóny (napr. pred štartom produkcie, ale v tom istom kalendárnom mesiaci) ostanú
  // prázdne bunky — appka pre ne nemá žiadne dáta.
  const tyzdne = useMemo(() => {
    if (!mesiac) return [];
    const [y, m] = mesiac.split("-").map(Number);
    const monthIdx = m - 1;
    const prvyDen = new Date(Date.UTC(y, monthIdx, 1));
    const offset = (prvyDen.getUTCDay() + 6) % 7; // 0 = pondelok
    const pocetDni = new Date(Date.UTC(y, monthIdx + 1, 0)).getUTCDate();
    const bunky = [];
    for (let i = 0; i < offset; i++) bunky.push(null);
    for (let d = 1; d <= pocetDni; d++) bunky.push(dniByIso.get(isoOfYMD(y, monthIdx, d)) || null);
    while (bunky.length % 7 !== 0) bunky.push(null);
    const out = [];
    for (let i = 0; i < bunky.length; i += 7) out.push(bunky.slice(i, i + 7));
    return out;
  }, [mesiac, dniByIso]);

  if (!person) {
    return (
      <div data-testid="moj-kalendar" className="p-4 text-sm text-f-faint">
        Tvoj účet nie je priradený k nikomu v štábe — kalendár nemá čo zobraziť. Ozvi sa adminovi.
      </div>
    );
  }

  const today = todayIso();
  const jeVSezone = dniByIso.has(today);
  const dnesX = jeVSezone ? cellOf(today, person.id) : null;
  const dnesDennaRola = jeVSezone ? (denneRoly || []).find((r) => r.iso === today) : null;
  const menoZCrew = (id) => crew.find((c) => c.id === id)?.name || null;
  const dnesReziser = dnesDennaRola?.reziser ? menoZCrew(dnesDennaRola.reziser) : null;
  const dnesStory = (dnesDennaRola?.storyProduceri || []).map(menoZCrew).filter(Boolean);
  const dnesDispo = jeVSezone ? (dispo || {})[today] : null;
  const dowDnes = SK_DAYS_FULL[new Date(today + "T00:00:00Z").getUTCDay()];

  return (
    <div data-testid="moj-kalendar" className="p-3.5">
      <div className="text-xs font-extrabold uppercase tracking-widest text-f-text mb-2.5">Môj kalendár — <span className="normal-case">{person.name}</span></div>

      {jeVSezone && (
        <button
          data-testid="dnesok-karta"
          onClick={() => onDayClick && onDayClick(today)}
          className="w-full text-left rounded-lg border border-f-accent bg-f-today p-2.5 mb-3.5"
        >
          <div className="flex items-baseline gap-2 mb-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-f-a">Dnes</div>
            <div className="text-xs font-semibold text-f-text">{skDate(today)} {dowDnes.toLowerCase()}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {dnesX?.shift ? (
              <span className={`inline-block font-mono text-[11px] font-bold text-f-ink rounded px-1.5 py-0.5 ${SHIFT_BADGE[dnesX.shift] || "bg-f-a"}`}>{dnesX.shift}</span>
            ) : (
              <span className="text-xs text-f-faint2">bez smeny</span>
            )}
            {dnesX?.duel && <span className="inline-block font-mono text-[10px] font-bold text-f-ink bg-f-duel rounded px-1.5 py-0.5">DUEL</span>}
            {dnesX?.off && <span className="text-xs font-bold text-f-accent">nemôžem</span>}
            {Number(dnesX?.nadcas) > 0 && (
              <span className="text-[10px] font-mono text-f-muted2 border border-f-border rounded px-1.5 py-0.5">+{Number(dnesX.nadcas)}h nadčas</span>
            )}
          </div>
          {(dnesReziser || dnesStory.length > 0) && (
            <div className="text-[11px] text-f-text mt-1.5">
              {dnesReziser && <span><span className="text-f-faint2">Režisér dňa: </span>{dnesReziser} </span>}
              {dnesStory.length > 0 && <span><span className="text-f-faint2">Story dňa: </span>{dnesStory.join(", ")}</span>}
            </div>
          )}
          {dnesDispo?.miesto && (
            <div className="text-[11px] text-f-text mt-1"><span className="text-f-faint2">Miesto: </span>{dnesDispo.miesto}</div>
          )}
          {(dnesDispo?.harmonogram || [])[0] && (
            <div className="text-[11px] text-f-text mt-0.5">
              <span className="text-f-faint2">Zraz: </span>
              <span className="font-mono">{dnesDispo.harmonogram[0].cas}</span> {dnesDispo.harmonogram[0].text}
            </div>
          )}
          <div className="text-[10px] text-f-faint2 mt-1.5">Detail dňa →</div>
        </button>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setMesiacIdx((i) => Math.max(0, i - 1))}
          disabled={mesiacIdx <= 0}
          className="px-2 py-1 rounded-md text-xs font-bold bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30"
        >
          ‹
        </button>
        <div className="text-sm font-extrabold text-f-text min-w-32 text-center">
          {mesiac ? `${SK_MONTHS[Number(mesiac.slice(5, 7)) - 1]} ${mesiac.slice(0, 4)}` : "—"}
        </div>
        <button
          onClick={() => setMesiacIdx((i) => Math.min(mesiace.length - 1, i + 1))}
          disabled={mesiacIdx >= mesiace.length - 1}
          className="px-2 py-1 rounded-md text-xs font-bold bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {SK_DAYS_MON_FIRST.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-f-faint2 py-1">{d}</div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {tyzdne.map((tyzden, ti) => (
          <div key={ti} className="grid grid-cols-7 gap-1">
            {tyzden.map((d, di) => {
              if (!d) return <div key={di} />;
              const x = cellOf(d.iso, person.id);
              const isToday = d.iso === today;
              return (
                <button
                  key={d.iso}
                  data-iso={d.iso}
                  onClick={() => onCellClick({ iso: d.iso, crewId: person.id })}
                  className={`rounded-md border p-1 min-h-[62px] flex flex-col items-start gap-0.5 text-left ${
                    isToday ? "border-f-accent bg-f-today" : "border-f-border bg-f-panel hover:bg-f-panel2"
                  }`}
                >
                  <span
                    className={`inline-block text-[10px] font-mono rounded px-1.5 py-1 -mx-1.5 -my-1 ${onDayClick ? "hover:bg-f-border underline decoration-dotted underline-offset-2" : ""} ${isToday ? "text-f-a font-bold" : "text-f-faint2"}`}
                    title={onDayClick ? "Detail dňa — kto ešte pracuje, dispo" : undefined}
                    onClick={(e) => {
                      if (!onDayClick) return;
                      e.stopPropagation();
                      onDayClick(d.iso);
                    }}
                  >
                    {d.day}
                  </span>
                  <div className="flex flex-wrap gap-0.5">
                    {x.shift && (
                      <span className={`inline-block font-mono text-[10px] font-bold text-f-ink rounded px-1 ${SHIFT_BADGE[x.shift] || "bg-f-a"}`}>{x.shift}</span>
                    )}
                    {x.duel && <span className="inline-block font-mono text-[9px] font-bold text-f-ink bg-f-duel rounded px-1">DUEL</span>}
                    {x.off && <span className="text-f-accent text-xs font-bold leading-none">×</span>}
                  </div>
                  {Number(x.nadcas) > 0 && (
                    <span className="text-[9px] font-mono text-f-muted2 border border-f-border rounded px-1">+{Number(x.nadcas)}h</span>
                  )}
                  {x.note && <span className="text-[9px] text-f-muted truncate w-full">{x.note}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="text-[11px] text-f-faint2 mt-3 leading-relaxed">
        Klikni na deň — vieš si označiť „nemôžem" a nahlásiť nadčas. Smeny, Duel a poznámku
        prideľuje vedúci, tu sú len na čítanie.
      </div>
    </div>
  );
}
