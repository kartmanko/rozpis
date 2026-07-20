import { useState } from "react";
import { getApiBase, setApiBase } from "../api";

export default function AdminPanel({ isAdmin, onLogin, onLogout, onClose, lastError }) {
  const [pw, setPw] = useState("");
  const [apiBase, setApiBaseInput] = useState(getApiBase());

  const saveApiBase = () => setApiBase(apiBase.trim());

  return (
    <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 p-3 no-print">
      <div className="flex items-center mb-2">
        <div className="text-sm font-semibold">{isAdmin ? "Admin" : "Prihlásenie admina"}</div>
        <div className="grow" />
        <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm">Zavrieť</button>
      </div>

      {!getApiBase() && (
        <div className="mb-3 p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200">
          Backend (Cloudflare Worker) ešte nie je nastavený. Zadaj jeho adresu nižšie
          (napr. <code>https://rozpis-worker.tvoj-ucet.workers.dev</code>) — bez toho appka
          nevie ukladať ani načítavať dáta.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <label className="text-xs text-stone-500 dark:text-stone-400">Adresa Workera:</label>
        <input
          value={apiBase}
          onChange={(e) => setApiBaseInput(e.target.value)}
          placeholder="https://rozpis-worker.tvoj-ucet.workers.dev"
          className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700 grow min-w-56"
        />
        <button onClick={saveApiBase} className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Uložiť</button>
      </div>

      {isAdmin ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Si prihlásený ako admin — editácia je odomknutá.</span>
          <div className="grow" />
          <button onClick={onLogout} className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Odhlásiť sa</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="admin heslo"
            className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700"
            onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
          />
          <button onClick={() => onLogin(pw)} className="px-3 py-1.5 rounded-lg text-sm bg-orange-600 hover:bg-orange-500 text-white transition-colors">Prihlásiť sa</button>
          {lastError && <span className="text-sm text-red-600 dark:text-red-400">{lastError}</span>}
        </div>
      )}
    </div>
  );
}
