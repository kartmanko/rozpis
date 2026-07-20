export default function LogPanel({ log, onClose }) {
  return (
    <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3 max-h-64 overflow-auto no-print">
      <div className="flex items-center mb-2">
        <div className="text-sm font-semibold">História zmien</div>
        <div className="grow" />
        <button onClick={onClose} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 text-sm">Zavrieť</button>
      </div>
      {log.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-400">Zatiaľ žiadne zmeny.</div>}
      <ul className="space-y-1">
        {log.map((e, i) => (
          <li key={i} className="text-xs font-mono text-slate-600 dark:text-slate-300">
            {new Date(e.t).toLocaleString("sk-SK")} — {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
