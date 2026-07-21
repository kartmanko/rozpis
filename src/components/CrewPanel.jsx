import { useState } from "react";
import { ROLES } from "../constants";

export default function CrewPanel({ crew, setCrew, moveCrew, onClose }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("kamera");
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Štáb</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>
      <div className="space-y-1.5">
        {crew.map((c) => (
          <div key={c.id} className="flex gap-2 items-center flex-wrap">
            <button onClick={() => moveCrew(c.id, -1)} className="text-f-faint hover:text-f-text px-1">▲</button>
            <button onClick={() => moveCrew(c.id, 1)} className="text-f-faint hover:text-f-text px-1">▼</button>
            <select
              value={c.role || "kamera"}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, role: e.target.value } : x)))}
              className="px-2 py-1 rounded-lg bg-f-panel2 text-xs border border-f-border text-f-text"
            >
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <input
              value={c.name}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text w-48"
            />
            <input
              value={c.aliases.join(", ")}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))}
              placeholder="aliasy: číslo, prezývka z chatu"
              className="px-2 py-1 rounded-lg bg-f-panel2 text-xs border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-40"
            />
            <button onClick={() => setCrew((cr) => cr.filter((x) => x.id !== c.id))} className="text-f-accent px-2 text-sm">Zmazať</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text">
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nová osoba" className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2" />
        <button
          onClick={() => { if (!name.trim()) return; setCrew((c) => [...c, { id: "c" + Date.now(), name: name.trim(), aliases: [], role }]); setName(""); }}
          className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
        >Pridať</button>
      </div>
    </div>
  );
}
