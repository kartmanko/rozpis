export default function LogPanel({ log, onClose }) {
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 max-h-64 overflow-auto no-print">
      <div className="flex items-center mb-2">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">História zmien</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>
      {log.length === 0 && <div className="text-sm text-f-faint">Zatiaľ žiadne zmeny.</div>}
      <ul className="space-y-1">
        {log.map((e, i) => (
          <li key={i} className="text-xs font-mono text-f-muted">
            {new Date(e.t).toLocaleString("sk-SK")} — {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
