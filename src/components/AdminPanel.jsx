import { useState } from "react";
import { getApiBase, setApiBase, hasBreakGlassPassword, setBreakGlassPassword } from "../api";
import { USER_ROLES } from "../permissions";

/* Panel "Môj účet" — kto som, čo smiem, odhlásenie a technické nastavenie servera. */
export default function AdminPanel({ me, onLogout, onClose }) {
  const [apiBase, setApiBaseInput] = useState(getApiBase());
  const [saved, setSaved] = useState(false);

  const saveApiBase = () => {
    setApiBase(apiBase.trim());
    setSaved(true);
  };

  const roleInfo = USER_ROLES.find((r) => r.key === me?.role);

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
