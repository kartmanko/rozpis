import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, ADMIN_STORAGE_KEY } from "./constants";
import { fetchData, saveData, ApiError, getApiBase } from "./api";
import { exportCSV, exportXLSX, printSchedule } from "./export";

import Legend from "./components/Legend";
import CellEditor from "./components/CellEditor";
import CrewPanel from "./components/CrewPanel";
import LogPanel from "./components/LogPanel";
import ImportPanel from "./components/ImportPanel";
import AdminPanel from "./components/AdminPanel";
import ScheduleTable from "./components/ScheduleTable";

const defaultCrew = () => DEFAULT_NAMES.map((n, i) => ({ id: "c" + i, name: n, aliases: [] }));

export default function App() {
  const days = useMemo(buildDays, []);

  const [crew, setCrew] = useState(defaultCrew);
  const [cells, setCells] = useState({}); // "iso|crewId" -> { off, shift, note }
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

  const key = (iso, cid) => iso + "|" + cid;
  const cellOf = (iso, cid) => cells[key(iso, cid)] || { off: false, shift: null, note: "" };

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
      const cur = prev[k] || { off: false, shift: null, note: "" };
      const next = { ...cur, ...patch };
      const empty = !next.off && !next.shift && !next.note;
      const out = { ...prev };
      if (empty) delete out[k]; else out[k] = next;
      return out;
    });
    setDirty(true);
  }, []);

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
    () => Object.entries(cells).filter(([, v]) => v.off && v.shift).length,
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
          <Legend className="bg-amber-500" label="5. deň cyklu" />
          <Legend className="bg-violet-600" label="skúšky" />
          {conflictsCount > 0 && <span className="text-red-400">⚠ {conflictsCount}× smena v deň, keď kameraman nemôže</span>}
          {saving && <span className="text-sky-400">Ukladám…</span>}
          {status && <span className="text-slate-300">{status}</span>}
          {connError && <span className="text-amber-400">{connError}</span>}
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

      <ScheduleTable
        days={days}
        crew={crew}
        cells={cells}
        cellOf={cellOf}
        canEdit={canEdit}
        onCellClick={setSel}
        onMoveCrew={moveCrew}
      />

      {sel && canEdit && (
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
    </div>
  );
}
