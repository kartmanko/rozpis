import { useRef, useState } from "react";
import { ROLES } from "../constants";

export default function CrewPanel({ crew, setCrew, moveCrew, addLog, onClose }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("kamera");
  const roleLabel = (key) => ROLES.find((r) => r.key === key)?.label || key;

  // Meno/aliasy strieľajú onChange na každý úder klávesy — logovať priamo tam by
  // "História zmien" zasypalo riadkami za jedno prepísanie. Rovnaký vzor ako pri
  // SadzbyPanel: hodnota sa zapamätá pri fokuse, riadok pribudne až pri opustení
  // poľa a iba keď sa naozaj zmenila.
  const zaciatokRef = useRef({});
  const onFocusZapamataj = (kluc, hodnota) => { zaciatokRef.current[kluc] = hodnota; };
  const onBlurZaloguj = (kluc, popis, teraz) => {
    const predtym = zaciatokRef.current[kluc];
    if (predtym === undefined || predtym === teraz) return;
    addLog && addLog(`Štáb — ${popis}: „${predtym}“ → „${teraz}“`);
  };
  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center mb-2.5">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Štáb</div>
        <div className="grow" />
        <button onClick={onClose} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text px-2 py-1.5 -m-1.5">Zavrieť</button>
      </div>
      <div className="space-y-1.5">
        {crew.map((c) => (
          <div key={c.id} className="flex gap-2 items-center flex-wrap">
            <button onClick={() => moveCrew(c.id, -1)} className="text-f-faint hover:text-f-text px-1">▲</button>
            <button onClick={() => moveCrew(c.id, 1)} className="text-f-faint hover:text-f-text px-1">▼</button>
            <select
              value={c.role || "kamera"}
              onChange={(e) => {
                const novaRola = e.target.value;
                setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, role: novaRola } : x)));
                if (novaRola !== (c.role || "kamera")) addLog && addLog(`Štáb — ${c.name}: rola „${roleLabel(c.role || "kamera")}“ → „${roleLabel(novaRola)}“`);
              }}
              className="px-2 py-1 rounded-lg bg-f-panel2 text-xs border border-f-border text-f-text"
            >
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <input
              value={c.name}
              onFocus={() => onFocusZapamataj("meno." + c.id, c.name)}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              onBlur={() => onBlurZaloguj("meno." + c.id, "meno", c.name)}
              className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text w-48"
            />
            <input
              value={c.aliases.join(", ")}
              onFocus={() => onFocusZapamataj("aliasy." + c.id, c.aliases.join(", "))}
              onChange={(e) => setCrew((cr) => cr.map((x) => (x.id === c.id ? { ...x, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))}
              onBlur={() => onBlurZaloguj("aliasy." + c.id, `aliasy (${c.name})`, c.aliases.join(", "))}
              placeholder="aliasy: číslo, prezývka z chatu"
              className="px-2 py-1 rounded-lg bg-f-panel2 text-xs border border-f-border text-f-text placeholder:text-f-faint2 grow min-w-40"
            />
            <button
              onClick={() => {
                setCrew((cr) => cr.filter((x) => x.id !== c.id));
                addLog && addLog(`Štáb — vymazaný: ${c.name}`);
              }}
              className="text-f-accent px-2 text-sm"
            >Zmazať</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text">
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nová osoba" className="px-2 py-1 rounded-lg bg-f-panel2 text-sm border border-f-border text-f-text placeholder:text-f-faint2" />
        <button
          onClick={() => {
            if (!name.trim()) return;
            // Date.now() samotný nestačí — na rozdiel od kontaktov/uzávierok
            // (kde je zvykom pridať aj náhodnú príponu) by dve rýchlo za sebou
            // pridané osoby v tej istej milisekunde (napr. dvojité odoslanie
            // dotyku na mobile) dostali rovnaké id a odvtedy by zdieľali
            // bunky v rozpise (kľúč "iso|crewId") aj všetky vyhľadávania podľa id.
            const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            setCrew((c) => [...c, { id, name: name.trim(), aliases: [], role }]);
            addLog && addLog(`Štáb — pridaný: ${name.trim()} (${roleLabel(role)})`);
            setName("");
          }}
          className="px-3 py-1.5 rounded-lg text-sm bg-f-panel2 hover:bg-f-border text-f-text transition-colors"
        >Pridať</button>
      </div>
    </div>
  );
}
