export default function LogPanel({ log, onClose }) {
  return (
    <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 p-3 max-h-64 overflow-auto no-print">
      <div className="flex items-center mb-2">
        <div className="text-sm font-semibold">História zmien</div>
        <div className="grow" />
        <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm">Zavrieť</button>
      </div>
      {log.length === 0 && <div className="text-sm text-stone-500 dark:text-stone-400">Zatiaľ žiadne zmeny.</div>}
      <ul className="space-y-1">
        {log.map((e, i) => (
          <li key={i} className="text-xs font-mono text-stone-600 dark:text-stone-300">
            {new Date(e.t).toLocaleString("sk-SK")} — {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
