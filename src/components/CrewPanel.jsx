import { useState } from "react";

export default function CrewPanel({ crew, setCrew, moveCrew, onClose }) {
  const [name, setName] = useState("");
  return (
    <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 p-3 no-print">
      <div className="flex items-center mb-2">
        <div className="text-sm font-semibold">Kameramani</div>
        <div className="grow" />
        <button onClick={onClose} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 text-sm">Zavrieť</button>
      </div>
      <div className="space-y-1">
        {crew.map((c, i) => (
          <div key={c.id} className="flex gap-2 items-center">
            <button onClick={() => moveCrew(i, -1)} className="text-stone-400 dark:text-stone-500 px-1">▲</button>
            <button onClick={() => moveCrew(i, 1)} className="text-stone-400 dark:text-stone-500 px-1">▼</button>
            <input
              value={c.name}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700 w-48"
            />
            <input
              value={c.aliases.join(", ")}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))}
              placeholder="aliasy: číslo, prezývka z chatu"
              className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-xs border border-stone-300 dark:border-stone-700 grow min-w-40"
            />
            <button onClick={() => setCrew((cr) => cr.filter((x) => x.id !== c.id))} className="text-red-600 dark:text-red-400 px-2 text-sm">Zmazať</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nový kameraman" className="px-2 py-1 rounded-lg bg-white dark:bg-stone-800 text-sm border border-stone-300 dark:border-stone-700" />
        <button
          onClick={() => { if (!name.trim()) return; setCrew((c) => [...c, { id: "c" + Date.now(), name: name.trim(), aliases: [] }]); setName(""); }}
          className="px-3 py-1.5 rounded-lg text-sm bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors"
        >Pridať</button>
      </div>
    </div>
  );
}
