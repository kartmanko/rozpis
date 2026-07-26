import { useState, useEffect, useCallback } from "react";
import { getApiBase, setApiBase, hasBreakGlassPassword, setBreakGlassPassword, pushTest } from "../api";
import { USER_ROLES } from "../permissions";
import { stavUpozorneni, zapniUpozornenia, vypniUpozornenia } from "../push";

/* Panel "Môj účet" — kto som, čo smiem, upozornenia, odhlásenie a technické nastavenie servera. */
export default function AdminPanel({ me, onLogout, onClose }) {
  const [apiBase, setApiBaseInput] = useState(getApiBase());
  const [saved, setSaved] = useState(false);

  const saveApiBase = () => {
    setApiBase(apiBase.trim());
    setSaved(true);
  };

  const roleInfo = USER_ROLES.find((r) => r.key === me?.role);

  /* --- upozornenia do telefónu (Fáza 6) --- */
  const [push, setPush] = useState(null);   // { stav, text }
  const [pracuje, setPracuje] = useState(false);
  const [hlaska, setHlaska] = useState("");

  const obnovStav = useCallback(async () => {
    try {
      setPush(await stavUpozorneni());
    } catch {
      setPush({ stav: "nejde", text: "Stav upozornení sa nedá zistiť." });
    }
  }, []);

  useEffect(() => { obnovStav(); }, [obnovStav]);

  const prepni = async () => {
    setPracuje(true);
    setHlaska("");
    const zapnute = push?.stav === "zapnute";
    const v = zapnute ? await vypniUpozornenia() : await zapniUpozornenia();
    if (!v.ok) setHlaska(v.chyba || "Nepodarilo sa to.");
    else setHlaska(zapnute ? "Upozornenia vypnuté." : "Hotovo — upozornenia sú zapnuté.");
    await obnovStav();
    setPracuje(false);
  };

  const skuska = async () => {
    setPracuje(true);
    setHlaska("");
    try {
      const v = await pushTest();
      setHlaska(v && v.poslane ? "Skúšobné upozornenie odoslané — malo prísť do pár sekúnd." : "Server nemá kam poslať — najprv zapni upozornenia.");
    } catch (e) {
      setHlaska("Skúška zlyhala: " + (e && e.message));
    }
    setPracuje(false);
  };

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Môj účet</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      <div className="p-2.5 rounded-lg bg-f-panel2 border border-f-border mb-3">
        <div className="text-sm font-semibold text-f-text">{me?.name || me?.email || "Neznámy"}</div>
        {me?.email && <div className="text-xs font-mono text-f-faint">{me.email}</div>}
        <div className="text-xs text-f-a mt-1.5">{roleInfo?.label || me?.role}</div>
        {roleInfo?.hint && <div className="text-[11px] text-f-faint mt-0.5">{roleInfo.hint}</div>}
        {me?.demo && <div className="text-[11px] text-f-accent mt-1.5">Demo režim — dáta sú len v tomto prehliadači.</div>}
      </div>

      {!me?.demo && (
        <div className="p-2.5 rounded-lg bg-f-panel2 border border-f-border mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-f-faint mb-1.5">Upozornenia do telefónu</div>

          {push?.stav === "treba-plochu" ? (
            <div className="text-xs text-f-text leading-relaxed">
              {push.text}
              <div className="text-[11px] text-f-faint mt-1.5">
                Otvor appku v Safari, ťukni na ikonu zdieľania dole a vyber „Pridať na plochu“. Potom sa sem vráť a upozornenia zapni.
              </div>
            </div>
          ) : push?.stav === "nejde" || push?.stav === "zakazane" ? (
            <div className="text-xs text-f-text leading-relaxed">{push.text}</div>
          ) : (
            <>
              <div className="text-xs text-f-faint mb-2">
                {push?.stav === "zapnute"
                  ? "Toto zariadenie dostáva upozornenia o potvrdených dispozíciách a zmenách v rozpise."
                  : "Zapni si upozornenia, nech ti neujde zmena v rozpise."}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={prepni}
                  disabled={pracuje || !push}
                  className={
                    "px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 " +
                    (push?.stav === "zapnute" ? "bg-f-panel3 hover:bg-f-border text-f-text" : "bg-f-accent text-f-ink hover:opacity-90")
                  }
                >
                  {push?.stav === "zapnute" ? "Vypnúť upozornenia" : "Zapnúť upozornenia"}
                </button>
                {push?.stav === "zapnute" && (
                  <button
                    onClick={skuska}
                    disabled={pracuje}
                    className="px-3 py-1.5 rounded-lg text-sm bg-f-panel3 hover:bg-f-border text-f-text transition-colors disabled:opacity-50"
                  >
                    Skúšobné upozornenie
                  </button>
                )}
              </div>
            </>
          )}

          {hlaska && <div className="text-[11px] text-f-a mt-2">{hlaska}</div>}
        </div>
      )}

      {!me?.demo && (
        <button
          onClick={onLogout}
          className="w-full mb-3 px-3 py-2 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
        >
          Odhlásiť sa
        </button>
      )}

      <details>
        <summary className="text-[11px] font-bold uppercase tracking-wider text-f-faint cursor-pointer">Technické nastavenie</summary>

        <div className="flex flex-wrap gap-2 items-center mt-2.5">
          <label className="text-xs text-f-faint">Adresa servera:</label>
          <input
            value={apiBase}
            onChange={(e) => { setApiBaseInput(e.target.value); setSaved(false); }}
            placeholder="https://api.kartmanko.cc"
            className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-56"
          />
          <button onClick={saveApiBase} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors">Uložiť</button>
          {saved && <span className="text-xs text-f-a">Uložené — obnov stránku.</span>}
        </div>

        {hasBreakGlassPassword() && (
          <div className="mt-2.5 p-2 rounded-lg bg-f-accent/10 border border-f-accent/50 text-xs text-f-text">
            <div>Si prihlásený núdzovým admin heslom, nie cez mail.</div>
            <button
              onClick={() => { setBreakGlassPassword(""); window.location.reload(); }}
              className="mt-1.5 px-2 py-0.5 rounded-lg bg-f-accent text-f-ink font-bold"
            >
              Zrušiť núdzový prístup
            </button>
          </div>
        )}
      </details>
    </div>
  );
}
