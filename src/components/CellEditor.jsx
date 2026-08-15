import { DAY_SHIFTS } from "../constants";
import { hodinyNadcasu, hodinovkaDnaC, nadcasDnaC, zakladDnaC, eur, hod, MAX_NADCAS_HODIN, mesiacUzavrety } from "../vykazy";

const SHIFT_ON = { A: "bg-f-a", B: "bg-f-b", C: "bg-f-c", R: "bg-f-r" };

/* Nahlásenie nadčasu k dňu (Fáza 2).
   Nadčas si nahlasuje človek sám, nič sa neschvaľuje — ale všetko je vidieť
   vo výkaze aj v Histórii, takže sa nedá zmeniť ticho.

   "zamknuty" (mesiac uzavretý) vypne ovládanie úplne — server by zmenu aj tak
   odmietol (nadcasVUzavretomMesiaci vo worker/src/auth.js, platí aj pre
   admina), ale bez tejto klientskej poistky by sa neplatná zmena zapísala
   lokálne a odvtedy by ticho blokovala úplne každé ďalšie uloženie, kým si to
   človek nevšimne (viď komentár pri "Vymeniť s…" nižšie — rovnaký mechanizmus). */
function NadcasRiadok({ cell, sadzba, onSet, zamknuty }) {
  const h = hodinyNadcasu(cell);
  const zaklad = zakladDnaC(cell, sadzba);
  const hodinovka = hodinovkaDnaC(cell, sadzba);
  const suma = nadcasDnaC(cell, sadzba);
  const zmen = (delta) => {
    const nova = Math.max(0, Math.min(MAX_NADCAS_HODIN, Math.round((h + delta) * 2) / 2));
    onSet({ nadcas: nova });
  };

  return (
    <div className="mt-2 pt-2 border-t border-f-hair">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-f-text">Nadčas</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => zmen(-0.5)}
            disabled={!h || zamknuty}
            className="w-11 h-11 rounded-lg bg-f-panel2 hover:bg-f-border text-f-text text-base font-bold disabled:opacity-30"
          >
            −
          </button>
          <span className="w-16 text-center font-mono text-sm font-bold text-f-text">{h ? hod(h) : "0 h"}</span>
          <button
            onClick={() => zmen(0.5)}
            disabled={zamknuty}
            className="w-11 h-11 rounded-lg bg-f-panel2 hover:bg-f-border text-f-text text-base font-bold disabled:opacity-30"
          >
            +
          </button>
        </div>
        {h > 0 && !zamknuty && (
          <button
            onClick={() => onSet({ nadcas: 0 })}
            className="px-2 py-1 rounded-lg text-[11px] bg-f-panel2 hover:bg-f-border text-f-muted"
          >
            Zrušiť
          </button>
        )}
        {suma > 0 && <span className="ml-auto font-mono text-sm font-extrabold text-f-text">+{eur(suma)}</span>}
      </div>
      {zamknuty && (
        <div className="text-[11px] text-f-accent mt-1.5">
          Tento mesiac je uzavretý — nadčas sa už nedá meniť (najprv treba uzávierku zrušiť).
        </div>
      )}
      {!zamknuty && h > 0 && !zaklad && (
        <div className="text-[11px] text-f-accent mt-1.5">
          V tento deň nie je pridelená smena ani Duel, takže sa nadčas nemá z čoho rátať — vo výkaze bude 0 €.
        </div>
      )}
      {!zamknuty && h > 0 && zaklad > 0 && (
        <div className="text-[11px] text-f-faint mt-1.5">
          {hod(h)} × {eur(hodinovka)} ({sadzba.nadcasPct} % z {eur(zaklad)} za tento deň).
        </div>
      )}
    </div>
  );
}

// access: "full" = celá bunka, "off" = iba prepínač "nemôžem" + nadčas (vlastný stĺpec člena štábu)
export default function CellEditor({ sel, crew, dovolene = [], cell, onSet, onSwap, onClose, skDate, access = "full", sadzba, uzavierky }) {
  const person = crew.find((c) => c.id === sel.crewId);
  const allowDuel = (person?.role || "kamera") === "kamera";
  const mesiacZamknuty = mesiacUzavrety(uzavierky, sel.iso);

  if (access === "off") {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 bg-f-panel3 border-t-[3px] border-f-accent p-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] no-print">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="text-sm font-semibold text-f-text">{person?.name} — {skDate(sel.iso)}</div>
          <div className="grow" />
          <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
        </div>
        <button
          onClick={() => onSet({ off: !cell.off })}
          className={`w-full px-3 py-3 rounded-lg text-sm font-bold transition-colors ${cell.off ? "bg-f-accent text-f-ink" : "bg-f-panel2 hover:bg-f-border text-f-text"}`}
        >
          {cell.off ? "× V tento deň nemôžem (klikni pre zrušenie)" : "Označiť: v tento deň nemôžem"}
        </button>
        {sadzba && <NadcasRiadok cell={cell} sadzba={sadzba} onSet={onSet} zamknuty={mesiacZamknuty} />}
        <div className="text-xs text-f-faint mt-2">
          Smeny prideľuje vedúci — ty si tu označuješ iba dni, keď nemôžeš, a nahlasuješ nadčas. Zmena sa uloží hneď.
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-f-panel3 border-t-[3px] border-f-accent p-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] no-print">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="text-sm font-semibold text-f-text">{person?.name} — {skDate(sel.iso)}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {/* Nadčas sa z "Vyčistiť" vynechá, keď je mesiac uzavretý — inak by to
            bol ďalší (mimo NadcasRiadok) spôsob, ako si lokálne zapísať zmenu
            nadčasu, ktorú server odmietne a ktorá by odvtedy ticho blokovala
            každé ďalšie uloženie, viď komentár pri NadcasRiadok vyššie. */}
        <button onClick={() => onSet(mesiacZamknuty ? { off: false, shift: null, duel: false } : { off: false, shift: null, duel: false, nadcas: 0 })} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-muted transition-colors">Vyčistiť</button>
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
          {/* Iba ľudia z vlastnej sekcie (dovolene = plný prístup) — server by
              výmenu do cudzej sekcie aj tak zamietol, ale bez tohto filtra by
              sa neplatná zmena zapísala lokálne a odvtedy by ticho blokovala
              úplne každé ďalšie ukladanie (aj tie neškodné), kým si to človek
              nevšimne a neobnoví appku. */}
          {crew.filter((c) => c.id !== sel.crewId && dovolene.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {sadzba && <NadcasRiadok cell={cell} sadzba={sadzba} onSet={onSet} zamknuty={mesiacZamknuty} />}
    </div>
  );
}
