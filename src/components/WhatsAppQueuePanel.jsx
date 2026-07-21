export default function WhatsAppQueuePanel({ pendingHook, crew, onResolve, onClose }) {
  return (
    <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 p-3 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-sm font-semibold">WhatsApp bridge — nepriradené správy</div>
        <div className="grow" />
        <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm">Zavrieť</button>
      </div>
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
        Toto sú správy z WhatsApp bridge, ktorých telefónne číslo appka nevie priradiť k nikomu zo štábu. Nič sa nezapíše, kým tu ručne nevyberieš osobu — telefón sa potom zapamätá ako alias, nabudúce sa už priradí automaticky.
      </div>

      {!pendingHook.length && <div className="text-sm text-stone-400 dark:text-stone-500">Žiadne čakajúce správy.</div>}

      <div className="space-y-2">
        {pendingHook.map((r) => (
          <div key={r.id} className="flex gap-2 items-start flex-wrap border border-stone-200 dark:border-stone-800 rounded-lg p-2">
            <div className="text-xs grow min-w-48">
              <div className="font-semibold flex items-center gap-1 flex-wrap">
                {r.sender || "neznámy odosielateľ"} {r.phone && <span className="text-stone-500 dark:text-stone-400 font-mono">{r.phone}</span>}
                {r.isCorrection && <span className="px-1.5 py-0.5 rounded bg-amber-600 dark:bg-amber-700 text-white text-[10px] font-bold uppercase">Oprava</span>}
              </div>
              <div className="text-stone-500 dark:text-stone-400">{r.text}</div>
              {r.noRestrictions && <div className="font-mono text-stone-600 dark:text-stone-300">bez obmedzení</div>}
              {(r.unavailable || []).length > 0 && (
                <div className="font-mono text-red-600 dark:text-red-300">
                  nemôže: {r.unavailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                </div>
              )}
              {(r.correctedAvailable || []).length > 0 && (
                <div className="font-mono text-emerald-600 dark:text-emerald-300">
                  znova môže (oprava): {r.correctedAvailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                </div>
              )}
            </div>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && onResolve(r, e.target.value)}
              className="px-2 py-1 rounded-lg text-sm border bg-amber-100 dark:bg-amber-900 border-amber-400 dark:border-amber-600"
            >
              <option value="">— kto to je? —</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => onResolve(r, null)} className="text-stone-500 dark:text-stone-400 text-sm px-2">Zahodiť</button>
          </div>
        ))}
      </div>
    </div>
  );
}
