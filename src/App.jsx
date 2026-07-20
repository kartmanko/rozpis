import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, ADMIN_STORAGE_KEY, SK_MONTHS } from "./constants";
import { fetchData, saveData, ApiError, getApiBase } from "./api";
import { exportCSV, exportXLSX, printSchedule } from "./export";

import Legend from "./components/Legend";
import CellEditor from "./components/CellEditor";
import CrewPanel from "./components/CrewPanel";
import LogPanel from "./components/LogPanel";
import ImportPanel from "./components/ImportPanel";
import AdminPanel from "./components/AdminPanel";
import ScheduleTable from "./components/ScheduleTable";
import BulkActionBar from "./components/BulkActionBar";

const defaultCrew = () => DEFAULT_NAMES.map((n, i) => ({ id: "c" + i, name: n, aliases: [] }));
const emptyCell = { off: false, shift: null, duel: false, note: "" };

export default function App() {
  const days = useMemo(buildDays, []);

  const [crew, setCrew] = useState(defaultCrew);
  const [cells, setCells] = useState({}); // "iso|crewId" -> { off, shift, duel, note }
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

  const [panel, setPanel] = useState(null); // "crew" | "import" | "log" | "admin"
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState("");

  /* --- hromadný výber --- */
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const anchorRef = useRef(null);

  /* --- filter na mesiac --- */
  const [activeMonth, setActiveMonth] = useState(null); // null = všetky
  const monthsAvailable = useMemo(() => {
    const seen = new Set();
    const list = [];
    days.forEach((d) => {
      if (!seen.has(d.month)) { seen.add(d.month); list.push(d.month); }
    });
    return list;
  }, [days]);
  const filteredDays = useMemo(
    () => (activeMonth === null ? days : days.filter((d) => d.month === activeMonth)),
    [days, activeMonth]
  );

  const key = (iso, cid) => iso + "|" + cid;
  const cellOf = (iso, cid) => cells[key(iso, cid)] || emptyCell;

  /* --- načítanie zo servera --- */
  const load = useCallback(async () => {
    try {
      const d = await fetchData();
      if (d.crew?.length) setCrew(d.crew);
      setCells(d.cells || {});
      setLog(d.log || []);
      setVersion(d.version || 0);
      setConnError("");
      setConflict(false);
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setConnError("Backend nie je nastavený — otvor „Admin“ a zadaj adresu Cloudflare Workera.");
      } else {
        setConnError("Nepodarilo sa načítať dáta zo servera: " + e.message);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* --- auto-refresh (iba viewer, alebo admin bez rozpracovaných zmien) --- */
  useEffect(() => {
    const t = setInterval(() => {
      if (!isAdmin || !dirty) load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isAdmin, dirty, load]);

  /* --- debounované ukladanie (iba admin) --- */
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded || !isAdmin || conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await saveData({ crew, cells, log, baseVersion: version, password: adminPassword });
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
  }, [crew, cells, log]);

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

  /* --- poradie stĺpcov --- */
  const moveCrew = (i, dir) => {
    wrappedSetCrew((c) => {
      const j = i + dir;
      if (j < 0 || j >= c.length) return c;
      const out = c.slice();
      [out[i], out[j]] = [out[j], out[i]];
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
    // Snapshot the anchor BEFORE mutating the ref: setSelectedKeys's updater runs
    // during React's deferred state flush, by which point anchorRef.current would
    // already equal the new `pos` if we mutated it first — collapsing every
    // shift-click range down to a single cell.
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

  const conflictsCount = useMemo(
    () => Object.entries(cells).filter(([, v]) => v.off && (v.shift || v.duel)).length,
    [cells]
  );

  const canEdit = isAdmin;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 bg-slate-950 border-b border-slate-800 px-3 py-2 no-print">
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <div className="text-sm font-semibold tracking-wide">FARMA 18 — rozpis kameramanov</div>
            <div className="text-xs text-slate-400 font-mono">30.7. – 17.10.2026 · cyklus 5 dní od 5.8.</div>
          </div>
          <div className="grow" />
          <button onClick={load} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">Obnoviť</button>
          {canEdit && (
            <button onClick={toggleBulkMode} className={`px-3 py-1 text-sm rounded ${bulkMode ? "bg-sky-600 hover:bg-sky-500" : "bg-slate-800 hover:bg-slate-700"}`}>
              Hromadný výber
            </button>
          )}
          {canEdit && (
            <button onClick={() => setPanel(panel === "import" ? null : "import")} className="px-3 py-1 text-sm rounded bg-sky-700 hover:bg-sky-600">Import z chatu</button>
          )}
          {canEdit && (
            <button onClick={() => setPanel(panel === "crew" ? null : "crew")} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">Kameramani</button>
          )}
          <button onClick={() => setPanel(panel === "log" ? null : "log")} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">História</button>
          <button onClick={() => exportCSV(days, crew, cellOf)} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">CSV</button>
          <button onClick={() => exportXLSX(days, crew, cellOf)} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">XLSX</button>
          <button onClick={printSchedule} className="px-3 py-1 text-sm rounded bg-slate-800 hover:bg-slate-700">Tlač / PDF</button>
          <button onClick={() => setPanel(panel === "admin" ? null : "admin")} className={`px-3 py-1 text-sm rounded ${isAdmin ? "bg-emerald-700 hover:bg-emerald-600" : "bg-slate-800 hover:bg-slate-700"}`}>
            {isAdmin ? "Admin" : "Prihlásenie"}
          </button>
        </div>
        <div className="flex gap-3 mt-2 text-xs text-slate-400 flex-wrap items-center">
          <Legend className="bg-red-800" label="nemôže" />
          <Legend className="bg-emerald-700" label="točí" />
          <Legend className="bg-pink-700" label="Duel" />
          <Legend className="bg-amber-500" label="5. deň cyklu" />
          <Legend className="bg-violet-600" label="skúšky" />
          {conflictsCount > 0 && <span className="text-red-400">⚠ {conflictsCount}× smena v deň, keď kameraman nemôže</span>}
          {saving && <span className="text-sky-400">Ukladám…</span>}
          {status && <span className="text-slate-300">{status}</span>}
          {connError && <span className="text-amber-400">{connError}</span>}
        </div>
        <div className="flex gap-1 mt-2 flex-wrap no-print">
          <button
            onClick={() => setActiveMonth(null)}
            className={`px-2 py-0.5 text-xs rounded ${activeMonth === null ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            Všetky
          </button>
          {monthsAvailable.map((m) => (
            <button
              key={m}
              onClick={() => setActiveMonth(m)}
              className={`px-2 py-0.5 text-xs rounded ${activeMonth === m ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {SK_MONTHS[m]}
            </button>
          ))}
        </div>
        {conflict && (
          <div className="mt-2 p-2 rounded bg-red-900/40 border border-red-700 text-xs text-red-200 flex items-center gap-2 flex-wrap">
            Niekto iný medzitým zmenil dáta na serveri — tvoje posledné zmeny sa neuložili.
            <button onClick={resolveConflict} className="px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white">Načítať znova (zahodí moje neuložené zmeny)</button>
          </div>
        )}
      </header>

      {panel === "admin" && (
        <AdminPanel isAdmin={isAdmin} onLogin={handleLogin} onLogout={handleLogout} onClose={() => setPanel(null)} lastError={loginError} />
      )}
      {panel === "crew" && canEdit && <CrewPanel crew={crew} setCrew={wrappedSetCrew} moveCrew={moveCrew} onClose={() => setPanel(null)} />}
      {panel === "log" && <LogPanel log={log} onClose={() => setPanel(null)} />}
      {panel === "import" && canEdit && (
        <ImportPanel crew={crew} setCrew={wrappedSetCrew} setCell={setCell} addLog={addLog} onClose={() => setPanel(null)} setStatus={setStatus} adminPassword={adminPassword} />
      )}

      {bulkMode && canEdit && (
        <div className="px-3 py-2 bg-sky-950 border-b border-sky-800 text-xs text-sky-200 no-print">
          {selectedKeys.size === 0
            ? "Hromadný výber je zapnutý — klikaj na bunky v tabuľke, ktoré chceš označiť (označené dostanú modrý rámik a ✓)."
            : `Označených ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"} — vyber akciu dole, alebo pokračuj v označovaní ďalších.`}
        </div>
      )}

      {/* rezerva miesta dole, nech fixný panel (editor bunky / hromadný výber) neprekrýva posledné riadky tabuľky */}
      <div style={{ paddingBottom: bulkMode ? 210 : sel && canEdit ? 190 : 0 }}>
        <ScheduleTable
          days={filteredDays}
          crew={crew}
          cells={cells}
          cellOf={cellOf}
          canEdit={canEdit}
          bulkMode={bulkMode}
          selectedKeys={selectedKeys}
          onCellClick={handleCellClick}
          onMoveCrew={moveCrew}
        />
      </div>

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
          onApply={applyBulk}
          onClearSelection={() => { setSelectedKeys(new Set()); anchorRef.current = null; }}
          onExit={toggleBulkMode}
        />
      )}
    </div>
  );
}
