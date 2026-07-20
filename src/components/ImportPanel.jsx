import { useState } from "react";
import { guessCrew } from "../matching";
import { parseScreenshot, ApiError } from "../api";
import { SK_MONTHS } from "../constants";

const fileToB64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Súbor sa nepodarilo načítať."));
    r.readAsDataURL(file);
  });

export default function ImportPanel({ crew, setCrew, setCell, addLog, onClose, setStatus, adminPassword }) {
  const [month, setMonth] = useState(8);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]); // { sender, phone, text, unavailable[], noRestrictions, crewId }
  const [err, setErr] = useState("");

  const analyze = async (files) => {
    setErr("");
    setBusy(true);
    const found = [];
    try {
      for (const f of Array.from(files)) {
        const b64 = await fileToB64(f);
        const parsed = await parseScreenshot({
          base64: b64,
          mediaType: f.type || "image/png",
          month,
          password: adminPassword,
        });
        (parsed.items || parsed || []).forEach((p) =>
          found.push({ ...p, crewId: guessCrew(crew, p.sender, p.phone) })
        );
      }
      setRows((r) => [...r, ...found]);
      if (!found.length) setErr("V screenshote som nenašiel žiadne obmedzenia.");
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 401
          ? "Nesprávne admin heslo — prihlás sa znova."
          : "Analýza zlyhala: " + e.message
      );
    }
    setBusy(false);
  };

  const apply = () => {
    let applied = 0;
    rows.forEach((r) => {
      if (!r.crewId) return;
      // zapamätaj si alias, nech sa appka nabudúce nepýta
      setCrew((cr) =>
        cr.map((c) => {
          if (c.id !== r.crewId) return c;
          const add = [r.phone, r.sender].filter(Boolean).filter((a) => !c.aliases.includes(a));
          return add.length ? { ...c, aliases: [...c.aliases, ...add] } : c;
        })
      );
      (r.unavailable || []).forEach((iso) => {
        setCell(iso, r.crewId, { off: true });
        applied++;
      });
      (r.correctedAvailable || []).forEach((iso) => {
        setCell(iso, r.crewId, { off: false });
        applied++;
      });
      const name = crew.find((c) => c.id === r.crewId)?.name || r.sender;
      const bits = [];
      if (r.noRestrictions) bits.push("bez obmedzení");
      if ((r.unavailable || []).length) bits.push(`${r.unavailable.length} dní nemôže`);
      if ((r.correctedAvailable || []).length) bits.push(`${r.correctedAvailable.length} dní opravených (znova môže)`);
      addLog(`Import: ${name} — ${bits.length ? bits.join(", ") : "žiadna zmena"}`);
    });
    setRows([]);
    setStatus(`Import hotový, zapísaných ${applied} dní.`);
    onClose();
  };

  const unresolved = rows.filter((r) => !r.crewId).length;

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-3 no-print">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-sm font-semibold">Import screenshotov z WhatsApp</div>
        <div className="grow" />
        <label className="text-xs text-slate-400">
          Predvolený mesiac:{" "}
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100">
            <option value={8}>August</option>
            <option value={9}>September</option>
            <option value={10}>Október</option>
          </select>
        </label>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-sm">Zavrieť</button>
      </div>

      <input type="file" accept="image/*" multiple onChange={(e) => e.target.files?.length && analyze(e.target.files)} className="text-sm" />
      {busy && <div className="text-sm text-sky-400 mt-2">Čítam screenshoty…</div>}
      {err && <div className="text-sm text-red-400 mt-2">{err}</div>}

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {unresolved > 0 && <div className="text-xs text-amber-400">Pri {unresolved} správach neviem, o koho ide — vyber kameramana.</div>}
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-start flex-wrap border border-slate-800 rounded p-2">
              <div className="text-xs grow min-w-48">
                <div className="font-semibold flex items-center gap-1 flex-wrap">
                  {r.sender} {r.phone && <span className="text-slate-400 font-mono">{r.phone}</span>}
                  {r.isCorrection && <span className="px-1.5 py-0.5 rounded bg-amber-700 text-amber-100 text-[10px] font-bold uppercase">Oprava</span>}
                </div>
                <div className="text-slate-400">{r.text}</div>
                {r.noRestrictions && <div className="font-mono text-slate-300">bez obmedzení</div>}
                {(r.unavailable || []).length > 0 && (
                  <div className="font-mono text-red-300">
                    nemôže: {r.unavailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                  </div>
                )}
                {(r.correctedAvailable || []).length > 0 && (
                  <div className="font-mono text-emerald-300">
                    znova môže (oprava): {r.correctedAvailable.map((d) => d.slice(8) + "." + Number(d.slice(5, 7)) + ".").join(" ")}
                  </div>
                )}
              </div>
              <select
                value={r.crewId}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, crewId: e.target.value } : x)))}
                className={`px-2 py-1 rounded text-sm border ${r.crewId ? "bg-slate-800 border-slate-700" : "bg-amber-900 border-amber-600"}`}
              >
                <option value="">— kto to je? —</option>
                {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-slate-400 text-sm px-2">Preskočiť</button>
            </div>
          ))}
          <button onClick={apply} className="px-3 py-1 rounded text-sm bg-emerald-700 hover:bg-emerald-600">Zapísať do tabuľky</button>
        </div>
      )}
    </div>
  );
}
