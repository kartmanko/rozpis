import { useState } from "react";
import { getApiBase, setApiBase } from "../api";

export default function AdminPanel({ isAdmin, onLogin, onLogout, onClose, lastError }) {
  const [pw, setPw] = useState("");
  const [apiBase, setApiBaseInput] = useState(getApiBase());

  const saveApiBase = () => setApiBase(apiBase.trim());

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">{isAdmin ? "Admin" : "Prihlásenie admina"}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      {!getApiBase() && (
        <div className="mb-3 p-2 rounded-lg bg-f-r/10 border border-f-r/50 text-xs text-f-r">
          Backend (Cloudflare Worker) ešte nie je nastavený. Zadaj jeho adresu nižšie
          (napr. <code>https://rozpis-worker.tvoj-ucet.workers.dev</code>) — bez toho appka
          nevie ukladať ani načítavať dáta.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <label className="text-xs text-f-faint">Adresa Workera:</label>
        <input
          value={apiBase}
          onChange={(e) => setApiBaseInput(e.target.value)}
          placeholder="https://rozpis-worker.tvoj-ucet.workers.dev"
          className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-56"
        />
        <button onClick={saveApiBase} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors">Uložiť</button>
      </div>

      {isAdmin ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-f-a">Si prihlásený ako admin — editácia je odomknutá.</span>
          <div className="grow" />
          <button onClick={onLogout} className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors">Odhlásiť sa</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="admin heslo"
            className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2"
            onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
          />
          <button onClick={() => onLogin(pw)} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-accent hover:brightness-110 text-f-ink transition-colors">Prihlásiť sa</button>
          {lastError && <span className="text-sm text-f-accent">{lastError}</span>}
        </div>
      )}
    </div>
  );
}
