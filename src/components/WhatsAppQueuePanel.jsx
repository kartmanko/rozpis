export default function WhatsAppQueuePanel({ pendingHook, crew, onResolve, onClose }) {
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">WhatsApp bridge — nepriradené správy</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>
      <div className="text-xs text-f-faint mb-2">
        Toto sú správy z WhatsApp bridge, ktorých telefónne číslo appka nevie priradiť k nikomu zo štábu. Nič sa nezapíše, kým tu ručne nevyberieš osobu — telefón sa potom zapamätá ako alias, nabudúce sa už priradí automaticky.
      </div>

      {!pendingHook.length && <div className="text-sm text-f-faint">Žiadne čakajúce správy.</div>}

      <div className="space-y-2">
        {pendingHook.map((r) => (
          <div key={r.id} className="flex gap-2 items-start flex-wrap border border-f-border rounded-lg p-2 bg-f-panel2">
            <div className="text-xs grow min-w-48">
              <div className="font-semibold flex items-center gap-1 flex-wrap text-f-text">
                {r.sender || "neznámy odosielateľ"} {r.phone && <span className="text-f-muted2 font-mono">{r.phone}</span>}
                {r.isCorrection && <span className="px-1.5 py-0.5 rounded bg-f-r text-f-bg text-[10px] font-bold uppercase">Oprava</span>}
              </div>
              <div className="text-f-muted2">{r.text}</div>
              {r.noRestrictions && <div className="font-mono text-f-muted">bez obmedzení</div>}
              {(r.unavailable || []).length > 0 && (
                <div className="font-mono text-f-accent">
                  nemôže: {r.unavailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                </div>
              )}
              {(r.correctedAvailable || []).length > 0 && (
                <div className="font-mono text-f-a">
                  znova môže (oprava): {r.correctedAvailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                </div>
              )}
            </div>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && onResolve(r, e.target.value)}
              className="px-2 py-1 rounded-lg text-sm border bg-f-r/20 border-f-r text-f-r"
            >
              <option value="">— kto to je? —</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => onResolve(r, null)} className="text-f-faint text-sm px-2">Zahodiť</button>
          </div>
        ))}
      </div>
    </div>
  );
}
