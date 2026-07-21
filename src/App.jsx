import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate, todayIso } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, ADMIN_STORAGE_KEY, ROLES } from "./constants";
import { fetchData, saveData, ApiError, getApiBase } from "./api";
import { exportCSV, exportXLSX, printSchedule } from "./export";
import { BUILD_ID } from "./buildId.generated";
import { DEMO_DATA } from "./demoData";

import Legend from "./components/Legend";
import CellEditor from "./components/CellEditor";
import CrewPanel from "./components/CrewPanel";
import LogPanel from "./components/LogPanel";
import ImportPanel from "./components/ImportPanel";
import AdminPanel from "./components/AdminPanel";
import ScheduleTable from "./components/ScheduleTable";
import BulkActionBar from "./components/BulkActionBar";
import DayDetail from "./components/DayDetail";
import NadPanel from "./components/NadPanel";
import WhatsAppQueuePanel from "./components/WhatsAppQueuePanel";

const defaultCrew = () => DEFAULT_NAMES.map((n, i) => ({ id: "c" + i, name: n, aliases: [], role: "kamera" }));
const emptyCell = { off: false, shift: null, duel: false, note: "" };

/* --- kontrola verzie appky: keď je nasadený nový build, otvorená appka (napr. pripnutá na ploche iPhonu) sa sama obnoví --- */
async function fetchLatestBuildId() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.buildId || null;
  } catch {
    return null;
  }
}

export default function App() {
  const days = useMemo(buildDays, []);

  const [crew, setCrew] = useState(defaultCrew);
  const [cells, setCells] = useState({}); // "iso|crewId" -> { off, shift, duel, note }
  const [nad, setNadState] = useState({}); // "A"|"B"|"C"|"R"|"duel" -> { depart, return } — univerzálne, neviaže sa na dátum
  const [pendingHook, setPendingHookState] = useState([]); // nepriradené správy z WhatsApp bridge
  const [log, setLog] = useState([]);
  const [version, setVersion] = useState(0);

  const [loaded, setLoaded] = useState(false);
  const [connError, setConnError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [adminPassword, setAdminPassword] = useState(() => {
    try { return localStorage.getItem(ADMIN_STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    try { return !!localStorage.getItem(ADMIN_STORAGE_KEY); } catch { return false; }
  });
  const [loginError, setLoginError] = useState("");

  const [panel, setPanel] = useState(null); // "crew" | "import" | "log" | "admin" | "hook" | "nad"
  const [menu, setMenu] = useState(null); // "export" | "more" | null
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState("");
  const [dayDetailIso, setDayDetailIso] = useState(null);

  /* --- role štábu (kamera / réžia / logger) — jeden dátový model, tabuľka sa iba filtruje --- */
  const [activeRole, setActiveRole] = useState("kamera");
  const filteredCrew = useMemo(() => crew.filter((c) => (c.role || "kamera") === activeRole), [crew, activeRole]);

  /* --- automatická kontrola novej verzie appky (na otvorenie, návrat do popredia, aj periodicky) --- */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const latest = await fetchLatestBuildId();
      if (!cancelled && latest && latest !== BUILD_ID) {
        window.location.reload();
      }
    };
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(check, 5 * 60 * 1000);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(t); };
  }, []);

  /* --- hromadný výber --- */
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const anchorRef = useRef(null);

  const key = (iso, cid) => iso + "|" + cid;
  const cellOf = (iso, cid) => cells[key(iso, cid)] || emptyCell;

  /* --- načítanie zo servera (Krok 1: bez nastaveného Workera appka beží čisto na lokálnych ukážkových dátach) --- */
  const load = useCallback(async () => {
    if (!getApiBase()) {
      setCrew(DEMO_DATA.crew);
      setCells(DEMO_DATA.cells);
      setNadState(DEMO_DATA.nad);
      setPendingHookState([]);
      setLog(DEMO_DATA.log);
      setVersion(1);
      setConnError("Demo režim (Krok 1) — dáta sú len lokálne v prehliadači, nič sa neukladá na server.");
      setConflict(false);
      setDirty(false);
      setLoaded(true);
      return;
    }
    try {
      const d = await fetchData();
      if (d.crew?.length) setCrew(d.crew);
      setCells(d.cells || {});
      setNadState(d.nad || {});
      setPendingHookState(d.pendingHook || []);
      setLog(d.log || []);
      setVersion(d.version || 0);
      setConnError("");
      setConflict(false);
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setConnError("Backend nie je nastavený — otvor Admin (cez ⋯) a zadaj adresu Cloudflare Workera.");
      } else {
        setConnError("Nepodarilo sa načítať dáta zo servera: " + e.message);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* --- automatické odscrollovanie na dnešný deň pri otvorení appky --- */
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => scrollToToday(), 200);
    return () => clearTimeout(t);
  }, [loaded]);

  const scrollToToday = () => {
    const el = document.querySelector(`[data-iso="${todayIso()}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* --- auto-refresh (iba viewer, alebo admin bez rozpracovaných zmien) --- */
  useEffect(() => {
    const t = setInterval(() => {
      if (getApiBase() && (!isAdmin || !dirty)) load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isAdmin, dirty, load]);

  /* --- debounované ukladanie (iba admin) — v Kroku 1 (bez Workera) sa iba nastaví "uložené" lokálne --- */
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded || !isAdmin || conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!getApiBase()) {
        setDirty(false);
        setStatus("Demo režim — zmeny sú len lokálne v tomto prehliadači (Krok 1).");
        return;
      }
      setSaving(true);
      try {
        const res = await saveData({ crew, cells, nad, pendingHook, log, baseVersion: version, password: adminPassword });
        setVersion(res.version);
        setDirty(false);
        setStatus("Uložené na server.");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(true);
          setStatus("");
        } else if (e instanceof ApiError && e.status === 401) {
          setIsAdmin(false);
          setLoginError("Heslo už neplatí, prihlás sa znova.");
          setStatus("");
        } else {
          setStatus("Uloženie zlyhalo: " + e.message);
        }
      }
      setSaving(false);
    }, 600);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, cells, nad, pendingHook, log]);

  const addLog = useCallback((text) => {
    setLog((l) => [{ t: new Date().toISOString(), text }, ...l].slice(0, 400));
    setDirty(true);
  }, []);

  const setCell = useCallback((iso, cid, patch) => {
    setCells((prev) => {
      const k = iso + "|" + cid;
      const cur = prev[k] || emptyCell;
      const next = { ...cur, ...patch };
      const empty = !next.off && !next.shift && !next.duel && !next.note;
      const out = { ...prev };
      if (empty) delete out[k]; else out[k] = next;
      return out;
    });
    setDirty(true);
  }, []);

  // NAD časy sú univerzálne podľa smeny (A/B/C/R/Duel), nie podľa dátumu.
  const setNad = useCallback((shiftKey, patch) => {
    setNadState((prev) => {
      const cur = prev[shiftKey] || { depart: "", return: "" };
      const next = { ...cur, ...patch };
      const out = { ...prev };
      if (!next.depart && !next.return) delete out[shiftKey]; else out[shiftKey] = next;
      return out;
    });
    setDirty(true);
  }, []);

  /* --- potvrdenie/zahodenie nepriradenej správy z WhatsApp bridge --- */
  const resolveHook = useCallback(
    (entry, crewId) => {
      if (crewId) {
        setCells((prev) => {
          const out = { ...prev };
          (entry.unavailable || []).forEach((iso) => {
            const k = iso + "|" + crewId;
            const cur = out[k] || emptyCell;
            out[k] = { ...cur, off: true };
          });
          (entry.correctedAvailable || []).forEach((iso) => {
            const k = iso + "|" + crewId;
            const cur = out[k] || emptyCell;
            const next = { ...cur, off: false };
            const empty = !next.off && !next.shift && !next.duel && !next.note;
            if (empty) delete out[k]; else out[k] = next;
          });
          return out;
        });
        setCrew((cr) =>
          cr.map((c) => {
            if (c.id !== crewId) return c;
            const add = [entry.phone, entry.sender].filter(Boolean).filter((a) => !c.aliases.includes(a));
            return add.length ? { ...c, aliases: [...c.aliases, ...add] } : c;
          })
        );
        const name = crew.find((c) => c.id === crewId)?.name || entry.sender;
        const bits = [];
        if (entry.noRestrictions) bits.push("bez obmedzení");
        if ((entry.unavailable || []).length) bits.push(`${entry.unavailable.length} dní nemôže`);
        if ((entry.correctedAvailable || []).length) bits.push(`${entry.correctedAvailable.length} dní opravených (znova môže)`);
        addLog(`WhatsApp bridge (potvrdené): ${name} — ${bits.length ? bits.join(", ") : "žiadna zmena"}`);
      }
      setPendingHookState((prev) => prev.filter((e) => e.id !== entry.id));
      setDirty(true);
    },
    [crew, addLog]
  );

  /* --- hromadná úprava vybraných buniek --- */
  const applyBulk = useCallback(
    (patch) => {
      if (!selectedKeys.size) return;
      setCells((prev) => {
        const out = { ...prev };
        selectedKeys.forEach((k) => {
          const cur = out[k] || emptyCell;
          const next = { ...cur, ...patch };
          const empty = !next.off && !next.shift && !next.duel && !next.note;
          if (empty) delete out[k]; else out[k] = next;
        });
        return out;
      });
      setDirty(true);
      addLog(`Hromadná úprava — ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"}`);
    },
    [selectedKeys, addLog]
  );

  const wrappedSetCrew = useCallback((updater) => { setCrew(updater); setDirty(true); }, []);

  /* --- výmena smeny --- */
  const swap = (iso, aId, bId) => {
    const a = cellOf(iso, aId), b = cellOf(iso, bId);
    setCell(iso, aId, { ...b });
    setCell(iso, bId, { ...a });
    const nameOf = (id) => crew.find((c) => c.id === id)?.name || "?";
    addLog(`Výmena ${skDate(iso)}: ${nameOf(aId)} ↔ ${nameOf(bId)}`);
  };

  /* --- poradie stĺpcov ---
     moveCrew berie id osoby (nie index) — potrebné, lebo tabuľka je filtrovaná podľa
     aktívnej role a poradie sa musí posúvať v rámci rovnakej role vo full zozname crew. */
  const moveCrew = (id, dir) => {
    wrappedSetCrew((c) => {
      const role = c.find((x) => x.id === id)?.role || "kamera";
      const sameRole = c.filter((x) => (x.role || "kamera") === role);
      const idx = sameRole.findIndex((x) => x.id === id);
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= sameRole.length) return c;
      const targetId = sameRole[targetIdx].id;
      const fullIdxA = c.findIndex((x) => x.id === id);
      const fullIdxB = c.findIndex((x) => x.id === targetId);
      const out = c.slice();
      [out[fullIdxA], out[fullIdxB]] = [out[fullIdxB], out[fullIdxA]];
      return out;
    });
  };

  /* --- klik na bunku: buď hromadný výber, alebo editor jednej bunky --- */
  const computeRangeKeys = (a, b) => {
    if (a.crewId === b.crewId) {
      const idxA = days.findIndex((d) => d.iso === a.iso);
      const idxB = days.findIndex((d) => d.iso === b.iso);
      if (idxA === -1 || idxB === -1) return [key(b.iso, b.crewId)];
      const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
      return days.slice(lo, hi + 1).map((d) => key(d.iso, a.crewId));
    }
    if (a.iso === b.iso) {
      const idxA = crew.findIndex((c) => c.id === a.crewId);
      const idxB = crew.findIndex((c) => c.id === b.crewId);
      if (idxA === -1 || idxB === -1) return [key(b.iso, b.crewId)];
      const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
      return crew.slice(lo, hi + 1).map((c) => key(a.iso, c.id));
    }
    return [key(b.iso, b.crewId)];
  };

  const handleCellClick = (pos, event) => {
    if (!bulkMode) { setSel(pos); return; }
    const k = key(pos.iso, pos.crewId);
    const anchor = anchorRef.current;
    const isRangeSelect = Boolean(event?.shiftKey && anchor);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (isRangeSelect) {
        computeRangeKeys(anchor, pos).forEach((rk) => next.add(rk));
      } else if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
    anchorRef.current = pos;
  };

  const toggleBulkMode = () => {
    setBulkMode((v) => !v);
    setSelectedKeys(new Set());
    anchorRef.current = null;
    setSel(null);
  };

  /* --- admin prihlásenie --- */
  const handleLogin = (pw) => {
    if (!pw) return;
    try { localStorage.setItem(ADMIN_STORAGE_KEY, pw); } catch { /* ticho */ }
    setAdminPassword(pw);
    setIsAdmin(true);
    setLoginError("");
    setStatus("Prihlásenie overí prvá úprava alebo uloženie.");
  };
  const handleLogout = () => {
    try { localStorage.removeItem(ADMIN_STORAGE_KEY); } catch { /* ticho */ }
    setIsAdmin(false);
    setAdminPassword("");
  };

  const resolveConflict = async () => {
    await load();
  };

  const bulkAllowsDuel = useMemo(() => {
    if (!selectedKeys.size) return true;
    return [...selectedKeys].every((k) => {
      const cid = k.split("|")[1];
      const c = crew.find((cc) => cc.id === cid);
      return (c?.role || "kamera") === "kamera";
    });
  }, [selectedKeys, crew]);

  const conflictsCount = useMemo(
    () => Object.entries(cells).filter(([, v]) => v.off && (v.shift || v.duel)).length,
    [cells]
  );

  const canEdit = isAdmin;
  const togglePanel = (p) => { setPanel(panel === p ? null : p); setMenu(null); };

  return (
    <div className="min-h-screen bg-f-bg text-f-text font-sans">
      <header className="sticky top-0 z-40 bg-f-bg border-b-[3px] border-f-accent px-3.5 py-2.5 no-print">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0">
            <div className="text-lg font-extrabold tracking-tight uppercase truncate">
              FARMA<span className="text-f-accent">18</span>
            </div>
            <div className="text-[9px] font-mono text-f-faint tracking-wide truncate">30.7.–17.10.2026 · CYKLUS 5</div>
          </div>
          <button onClick={scrollToToday} className="text-[10px] font-bold uppercase tracking-wider text-f-muted2 hover:text-f-text border border-f-border rounded-md px-2 py-1">Dnes</button>
          <div className="grow" />

          <div className="flex items-center gap-1 relative">
            <button title="Obnoviť" onClick={load} className="w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">⟳</button>

            <button title="Export" onClick={() => setMenu(menu === "export" ? null : "export")} className="w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">↓</button>
            {menu === "export" && (
              <div className="absolute top-10 right-20 z-50 bg-f-panel3 border border-f-border rounded-lg shadow-xl p-1.5 w-36 flex flex-col gap-0.5">
                <button onClick={() => { exportCSV(days, crew, cellOf); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">CSV</button>
                <button onClick={() => { exportXLSX(days, crew, cellOf); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">XLSX</button>
                <button onClick={() => { printSchedule(); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Tlač / PDF</button>
              </div>
            )}

            <button title="NAD časy" onClick={() => togglePanel("nad")} className={`w-8 h-8 rounded-md border flex items-center justify-center ${panel === "nad" ? "border-f-accent bg-f-accent text-f-bg" : "border-f-border bg-f-panel text-f-muted hover:text-f-text"}`}>⏱</button>

            <button title="Viac" onClick={() => setMenu(menu === "more" ? null : "more")} className="relative w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">
              ⋯
              {pendingHook.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-bg text-[9px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
            </button>
            {menu === "more" && (
              <div className="absolute top-10 right-0 z-50 bg-f-panel3 border border-f-border rounded-lg shadow-xl p-1.5 w-56 flex flex-col gap-0.5">
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-2.5 py-2 text-[10px] border-b border-f-hair mb-1">
                  <Legend className="bg-f-a" label="A" />
                  <Legend className="bg-f-b" label="B" />
                  <Legend className="bg-f-c" label="C" />
                  <Legend className="bg-f-r" label="R" />
                  <Legend className="bg-f-duel" label="Duel" />
                </div>
                <button onClick={() => togglePanel("log")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">História</button>
                <button onClick={() => togglePanel("admin")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">{isAdmin ? "Admin" : "Prihlásenie"}</button>
                {canEdit && (
                  <>
                    <div className="border-t border-f-hair my-1" />
                    <button onClick={() => { toggleBulkMode(); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">{bulkMode ? "Ukončiť hromadný výber" : "Hromadný výber"}</button>
                    <button onClick={() => togglePanel("import")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Import z chatu</button>
                    <button onClick={() => togglePanel("crew")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Štáb</button>
                    <button onClick={() => togglePanel("hook")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                      WhatsApp fronta
                      {pendingHook.length > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-bg text-[9px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex mt-2.5 border-b border-f-hair">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setActiveRole(r.key)}
              className={`flex-1 text-center py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${activeRole === r.key ? "bg-f-text text-f-bg" : "text-f-faint hover:text-f-muted"}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {(conflictsCount > 0 || saving || status || connError || conflict) && (
          <div className="flex gap-3 mt-2 text-[11px] flex-wrap items-center font-mono">
            {conflictsCount > 0 && <span className="text-f-accent font-semibold">⚠ {conflictsCount}× smena v deň, keď niekto nemôže</span>}
            {saving && <span className="text-f-r">Ukladám…</span>}
            {status && <span className="text-f-muted">{status}</span>}
            {connError && <span className="text-f-r">{connError}</span>}
          </div>
        )}
        {conflict && (
          <div className="mt-2 p-2 rounded-lg bg-f-accent/10 border border-f-accent/50 text-xs text-f-text flex items-center gap-2 flex-wrap">
            Niekto iný medzitým zmenil dáta na serveri — tvoje posledné zmeny sa neuložili.
            <button onClick={resolveConflict} className="px-2 py-0.5 rounded-lg bg-f-accent text-f-bg font-bold">Načítať znova (zahodí moje neuložené zmeny)</button>
          </div>
        )}
      </header>

      {panel === "admin" && (
        <AdminPanel isAdmin={isAdmin} onLogin={handleLogin} onLogout={handleLogout} onClose={() => setPanel(null)} lastError={loginError} />
      )}
      {panel === "crew" && canEdit && <CrewPanel crew={crew} setCrew={wrappedSetCrew} moveCrew={moveCrew} onClose={() => setPanel(null)} />}
      {panel === "log" && <LogPanel log={log} onClose={() => setPanel(null)} />}
      {panel === "nad" && <NadPanel nad={nad} canEdit={canEdit} onSetNad={setNad} onClose={() => setPanel(null)} />}
      {panel === "hook" && canEdit && (
        <WhatsAppQueuePanel pendingHook={pendingHook} crew={crew} onResolve={resolveHook} onClose={() => setPanel(null)} />
      )}
      {panel === "import" && canEdit && (
        <ImportPanel crew={crew} setCrew={wrappedSetCrew} setCell={setCell} addLog={addLog} onClose={() => setPanel(null)} setStatus={setStatus} adminPassword={adminPassword} />
      )}

      {bulkMode && canEdit && (
        <div className="px-3.5 py-2 bg-f-accent/10 border-b border-f-accent/40 text-xs text-f-text no-print">
          {selectedKeys.size === 0
            ? "Hromadný výber je zapnutý — klikaj na bunky v tabuľke, ktoré chceš označiť."
            : `Označených ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"} — vyber akciu dole, alebo pokračuj v označovaní ďalších.`}
        </div>
      )}

      {/* rezerva miesta dole, nech fixný panel (editor bunky / hromadný výber) neprekrýva posledné riadky tabuľky */}
      <div style={{ paddingBottom: bulkMode ? 210 : sel && canEdit ? 190 : 0 }}>
        <ScheduleTable
          days={days}
          crew={filteredCrew}
          cells={cells}
          cellOf={cellOf}
          canEdit={canEdit}
          bulkMode={bulkMode}
          selectedKeys={selectedKeys}
          onCellClick={handleCellClick}
          onMoveCrew={moveCrew}
          onDayClick={setDayDetailIso}
          openDayIso={dayDetailIso}
        />
      </div>

      {dayDetailIso && (
        <DayDetail
          iso={dayDetailIso}
          crew={crew}
          cellOf={cellOf}
          onClose={() => setDayDetailIso(null)}
        />
      )}

      {sel && canEdit && !bulkMode && (
        <CellEditor
          sel={sel}
          crew={crew}
          cell={cellOf(sel.iso, sel.crewId)}
          skDate={skDate}
          onSet={(patch) => setCell(sel.iso, sel.crewId, patch)}
          onSwap={(otherId) => { swap(sel.iso, sel.crewId, otherId); setSel(null); }}
          onClose={() => setSel(null)}
        />
      )}

      {bulkMode && canEdit && (
        <BulkActionBar
          count={selectedKeys.size}
          allowDuel={bulkAllowsDuel}
          onApply={applyBulk}
          onClearSelection={() => { setSelectedKeys(new Set()); anchorRef.current = null; }}
          onExit={toggleBulkMode}
        />
      )}
    </div>
  );
}
