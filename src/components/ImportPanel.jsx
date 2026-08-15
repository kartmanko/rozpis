import { useEffect, useState } from "react";
import { guessCrew } from "../matching";
import { parseScreenshot, ApiError } from "../api";
import { vSezone } from "../tabulkaImport";

// Vision modelu sa dátum nedá veriť naslepo (rovnaký dôvod ako pri REPORT_DATE_PROMPT
// na serveri) — zle tvarovaný alebo mimo sezóny dátum by sa uložil ako bunka, ktorú
// tabuľka (iteruje iba po dňoch sezóny) nikdy nezobrazí. Admin by si myslel, že deň
// zapísal, a v skutočnosti by sa nestalo nič, potichu.
const jeIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const platneDni = (pole) => (Array.isArray(pole) ? pole : []).filter((d) => jeIso(d) && vSezone(d));

export default function ImportPanel({ crew, dovolene, setCrew, setCell, addLog, onClose, setStatus, onRegisterCloseGuard }) {
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
        });
        // hádanie mena smie trafiť iba niekoho z vlastnej sekcie — inak by sa
        // rovno predvyplnil niekto cudzí a "Zapísať do tabuľky" by to poslalo ďalej
        const povoleny = crew.filter((c) => (dovolene || []).includes(c.id));
        (parsed.items || parsed || []).forEach((p) =>
          found.push({
            ...p,
            unavailable: platneDni(p.unavailable),
            correctedAvailable: platneDni(p.correctedAvailable),
            crewId: guessCrew(povoleny, p.sender, p.phone),
          })
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
      if (!r.crewId || !(dovolene || []).includes(r.crewId)) return;
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

  const handleZavriet = () => {
    if (rows.length && !confirm("Zavrieť? Zahodí to rozpoznané screenshoty, ktoré si ešte nezapísal(a) do rozpisu.")) return;
    onClose();
  };

  // rozpoznané, ale ešte NEzapísané screenshoty ("rows") sú rozostavaná práca,
  // za ktorú sa platí (Vision API) — bez tejto registrácie by Escape aj
  // prepnutie na iný panel z menu vedeli celý rozpoznaný dávku ticho zahodiť
  // (na rozdiel od tlačidla "Zavrieť" tento panel doteraz vôbec nemal žiadnu
  // poistku, viď komentár v App.jsx pri registerPanelCloseGuard).
  useEffect(() => {
    if (!onRegisterCloseGuard) return;
    onRegisterCloseGuard(() => rows.length === 0 || confirm("Zavrieť? Zahodí to rozpoznané screenshoty, ktoré si ešte nezapísal(a) do rozpisu."));
    return () => onRegisterCloseGuard(null);
  }, [rows, onRegisterCloseGuard]);

  return (
    <div className="bg-f-panel3 border-t-[3px] border-f-accent p-3.5 no-print">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <div className="text-xs font-extrabold uppercase tracking-widest text-f-text">Import screenshotov z WhatsApp</div>
        <div className="grow" />
        <label className="text-xs text-f-faint">
          Predvolený mesiac:{" "}
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="bg-f-panel2 border border-f-border rounded-lg px-2 py-1 text-f-text">
            <option value={8}>August</option>
            <option value={9}>September</option>
            <option value={10}>Október</option>
          </select>
        </label>
        <button onClick={handleZavriet} className="text-[11px] font-bold uppercase tracking-wider text-f-faint hover:text-f-text">Zavrieť</button>
      </div>

      <input type="file" accept="image/*" multiple onChange={(e) => e.target.files?.length && analyze(e.target.files)} className="text-sm text-f-muted" />
      {busy && <div className="text-sm text-f-r mt-2">Čítam screenshoty…</div>}
      {err && <div className="text-sm text-f-accent mt-2">{err}</div>}

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {unresolved > 0 && <div className="text-xs text-f-r">Pri {unresolved} správach neviem, o koho ide — vyber osobu.</div>}
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-start flex-wrap border border-f-border rounded-lg p-2 bg-f-panel2">
              <div className="text-xs grow min-w-48">
                <div className="font-semibold flex items-center gap-1 flex-wrap text-f-text">
                  {r.sender} {r.phone && <span className="text-f-muted2 font-mono">{r.phone}</span>}
                  {r.isCorrection && <span className="px-1.5 py-0.5 rounded bg-f-r text-f-ink text-[10px] font-bold uppercase">Oprava</span>}
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
                value={r.crewId}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, crewId: e.target.value } : x)))}
                className={`px-2 py-1 rounded-lg text-sm border ${r.crewId ? "bg-f-panel2 border-f-border text-f-text" : "bg-f-r/20 border-f-r text-f-r"}`}
              >
                <option value="">— kto to je? —</option>
                {/* iba ľudia z vlastnej sekcie — server by zápis do cudzej aj tak
                    zamietol, ale ticho by odvtedy blokoval každé ďalšie uloženie */}
                {crew.filter((c) => (dovolene || []).includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-f-faint text-sm px-2">Preskočiť</button>
            </div>
          ))}
          <button onClick={apply} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-f-a text-f-ink hover:brightness-110 transition-colors">Zapísať do tabuľky</button>
        </div>
      )}
    </div>
  );
}

const fileToB64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("Súbor sa nepodarilo načítať."));
    r.readAsDataURL(file);
  });
