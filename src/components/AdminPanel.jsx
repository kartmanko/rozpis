import { useState } from "react";
import { getApiBase, setApiBase } from "../api";

export default function AdminPanel({ isAdmin, onLogin, onLogout, onClose, lastError }) {
  const [pw, setPw] = useState("");
  const [apiBase, setApiBaseInput] = useState(getApiBase());

  const saveApiBase = () => setApiBase(apiBase.trim());

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-3 no-print">
      <div className="flex items-center mb-2">
        <div className="text-sm font-semibold">{isAdmin ? "Admin" : "Prihlásenie admina"}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-sm">Zavrieť</button>
      </div>

      {!getApiBase() && (
        <div className="mb-3 p-2 rounded bg-amber-900/40 border border-amber-700 text-xs text-amber-200">
          Backend (Cloudflare Worker) ešte nie je nastavený. Zadaj jeho adresu nižšie
          (napr. <code>https://rozpis-worker.tvoj-ucet.workers.dev</code>) — bez toho appka
          nevie ukladať ani načítavať dáta.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <label className="text-xs text-slate-400">Adresa Workera:</label>
        <input
          value={apiBase}
          onChange={(e) => setApiBaseInput(e.target.value)}
          placeholder="https://rozpis-worker.tvoj-ucet.workers.dev"
          className="px-2 py-1 rounded bg-slate-800 text-sm border border-slate-700 grow min-w-56"
        />
        <button onClick={saveApiBase} className="px-3 py-1 rounded text-sm bg-slate-800 hover:bg-slate-700">Uložiť</button>
      </div>

      {isAdmin ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-emerald-400">Si prihlásený ako admin — editácia je odomknutá.</span>
          <div className="grow" />
          <button onClick={onLogout} className="px-3 py-1 rounded text-sm bg-slate-800 hover:bg-slate-700">Odhlásiť sa</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="admin heslo"
            className="px-2 py-1 rounded bg-slate-800 text-sm border border-slate-700"
            onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
          />
          <button onClick={() => onLogin(pw)} className="px-3 py-1 rounded text-sm bg-sky-700 hover:bg-sky-600">Prihlásiť sa</button>
          {lastError && <span className="text-sm text-red-400">{lastError}</span>}
        </div>
      )}
    </div>
  );
}
