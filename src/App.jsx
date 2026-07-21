import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, ADMIN_STORAGE_KEY, SK_MONTHS, ROLES } from "./constants";
import { fetchData, saveData, ApiError, getApiBase } from "./api";
import { exportCSV, exportXLSX, printSchedule } from "./export";
import { BUILD_ID } from "./buildId.generated";

import Legend from "./components/Legend";
import CellEditor from "./components/CellEditor";
import CrewPanel from "./components/CrewPanel";
import LogPanel from "./components/LogPanel";
import ImportPanel from "./components/ImportPanel";
import AdminPanel from "./components/AdminPanel";
import ScheduleTable from "./components/ScheduleTable";
import BulkActionBar from "./components/BulkActionBar";
import ThemeToggle from "./components/ThemeToggle";
import DayDetail from "./components/DayDetail";
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

/* --- svetlá / tmavá / auto téma --- */
const THEME_KEY = "rozpis_theme"; // "light" | "dark" | "system"
const prefersDark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const applyTheme = (t) => document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && prefersDark()));

export default function App() {
  const days = useMemo(buildDays, []);

  const [crew, setCrew] = useState(defaultCrew);
  const [cells, setCells] = useState({}); // "iso|crewId" -> { off, shift, duel, note }
  const [nad, setNadState] = useState({}); // "iso" -> { depart, return }
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

  const [panel, setPanel] = useState(null); // "crew" | "import" | "log" | "admin"
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ticho */ }
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

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
      setNadState(d.nad || {});
      setPendingHookState(d.pendingHook || []);
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

  const setNad = useCallback((iso, patch) => {
    setNadState((prev) => {
      const cur = prev[iso] || { depart: "", return: "" };
      const next = { ...cur, ...patch };
      const out = { ...prev };
      if (!next.depart && !next.return) delete out[iso]; else out[iso] = next;
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

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors">
      <div className="h-1 bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 no-print" />
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-stone-950/90 backdrop-blur border-b border-stone-200 dark:border-stone-800 px-3 py-2.5 no-print shadow-sm">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="text-base sm:text-sm font-extrabold tracking-tight truncate">
              <span className="text-orange-600 dark:text-orange-500">FARMA 18</span>
              <span className="hidden sm:inline text-stone-400 dark:text-stone-500"> — rozpis kameramanov</span>
            </div>
            <div className="text-[11px] sm:text-xs text-stone-500 dark:text-stone-400 font-mono truncate">30.7. – 17.10.2026 · cyklus 5 dní od 5.8.</div>
          </div>
          <div className="grow" />
          <ThemeToggle theme={theme} onChange={setTheme} />

          {/* plný panel akcií na väčších obrazovkách */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap justify-end">
            <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Obnoviť</button>
            {canEdit && (
              <button onClick={toggleBulkMode} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${bulkMode ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"}`}>
                Hromadný výber
              </button>
            )}
            {canEdit && (
              <button onClick={() => setPanel(panel === "import" ? null : "import")} className="px-3 py-1.5 text-sm rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors">Import z chatu</button>
            )}
            {canEdit && (
              <button onClick={() => setPanel(panel === "crew" ? null : "crew")} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Kameramani</button>
            )}
            <button onClick={() => setPanel(panel === "log" ? null : "log")} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">História</button>
            {canEdit && (
              <button onClick={() => setPanel(panel === "hook" ? null : "hook")} className="relative px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">
                WhatsApp fronta
                {pendingHook.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-stone-950 text-[10px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
              </button>
            )}
            <button onClick={() => exportCSV(days, crew, cellOf)} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">CSV</button>
            <button onClick={() => exportXLSX(days, crew, cellOf)} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">XLSX</button>
            <button onClick={printSchedule} className="px-3 py-1.5 text-sm rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors">Tlač / PDF</button>
            <button onClick={() => setPanel(panel === "admin" ? null : "admin")} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${isAdmin ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"}`}>
              {isAdmin ? "Admin" : "Prihlásenie"}
            </button>
          </div>

          {/* hamburger menu na mobile */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            className={`sm:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${menuOpen ? "bg-orange-600 text-white" : "bg-stone-100 dark:bg-stone-800"}`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="sm:hidden mt-2.5 grid grid-cols-2 gap-1.5">
            {canEdit && (
              <button onClick={() => { setPanel(panel === "import" ? null : "import"); setMenuOpen(false); }} className="col-span-2 px-3 py-2 text-sm rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors">Import z chatu</button>
            )}
            {canEdit && (
              <button onClick={() => { toggleBulkMode(); setMenuOpen(false); }} className={`px-3 py-2 text-sm rounded-lg transition-colors ${bulkMode ? "bg-orange-600 text-white" : "bg-stone-100 dark:bg-stone-800"}`}>Hromadný výber</button>
            )}
            <button onClick={() => { load(); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">Obnoviť</button>
            {canEdit && (
              <button onClick={() => { setPanel(panel === "crew" ? null : "crew"); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">Kameramani</button>
            )}
            <button onClick={() => { setPanel(panel === "log" ? null : "log"); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">História</button>
            {canEdit && (
              <button onClick={() => { setPanel(panel === "hook" ? null : "hook"); setMenuOpen(false); }} className="relative px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">
                WhatsApp fronta{pendingHook.length > 0 ? ` (${pendingHook.length})` : ""}
              </button>
            )}
            <button onClick={() => { exportCSV(days, crew, cellOf); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">CSV</button>
            <button onClick={() => { exportXLSX(days, crew, cellOf); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">XLSX</button>
            <button onClick={() => { printSchedule(); setMenuOpen(false); }} className="px-3 py-2 text-sm rounded-lg bg-stone-100 dark:bg-stone-800">Tlač / PDF</button>
            <button
              onClick={() => { setPanel(panel === "admin" ? null : "admin"); setMenuOpen(false); }}
              className={`col-span-2 px-3 py-2 text-sm rounded-lg transition-colors ${isAdmin ? "bg-emerald-600 text-white" : "bg-stone-100 dark:bg-stone-800"}`}
            >
              {isAdmin ? "Admin" : "Prihlásenie"}
            </button>
          </div>
        )}
        <div className="flex gap-3 mt-2 text-xs text-stone-500 dark:text-stone-400 flex-wrap items-center">
          <Legend className="bg-red-700 dark:bg-red-800" label="nemôže" />
          <Legend className="bg-emerald-600 dark:bg-emerald-700" label="točí" />
          <Legend className="bg-pink-600 dark:bg-pink-700" label="Duel" />
          <Legend className="bg-amber-500" label="5. deň cyklu" />
          <Legend className="bg-violet-600" label="skúšky" />
          {conflictsCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium">⚠ {conflictsCount}× smena v deň, keď kameraman nemôže</span>}
          {saving && <span className="text-orange-600 dark:text-orange-400">Ukladám…</span>}
          {status && <span className="text-stone-600 dark:text-stone-300">{status}</span>}
          {connError && <span className="text-amber-600 dark:text-amber-400">{connError}</span>}
        </div>
        <div className="flex gap-1 mt-2 flex-wrap no-print">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setActiveRole(r.key)}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-colors ${activeRole === r.key ? "bg-stone-800 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 mt-2 flex-wrap no-print">
          <button
            onClick={() => setActiveMonth(null)}
            className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${activeMonth === null ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"}`}
          >
            Všetky
          </button>
          {monthsAvailable.map((m) => (
            <button
              key={m}
              onClick={() => setActiveMonth(m)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${activeMonth === m ? "bg-orange-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"}`}
            >
              {SK_MONTHS[m]}
            </button>
          ))}
        </div>
        {conflict && (
          <div className="mt-2 p-2 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-xs text-red-700 dark:text-red-200 flex items-center gap-2 flex-wrap">
            Niekto iný medzitým zmenil dáta na serveri — tvoje posledné zmeny sa neuložili.
            <button onClick={resolveConflict} className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-500 text-white">Načítať znova (zahodí moje neuložené zmeny)</button>
          </div>
        )}
      </header>

      {panel === "admin" && (
        <AdminPanel isAdmin={isAdmin} onLogin={handleLogin} onLogout={handleLogout} onClose={() => setPanel(null)} lastError={loginError} />
      )}
      {panel === "crew" && canEdit && <CrewPanel crew={crew} setCrew={wrappedSetCrew} moveCrew={moveCrew} onClose={() => setPanel(null)} />}
      {panel === "log" && <LogPanel log={log} onClose={() => setPanel(null)} />}
      {panel === "hook" && canEdit && (
        <WhatsAppQueuePanel pendingHook={pendingHook} crew={crew} onResolve={resolveHook} onClose={() => setPanel(null)} />
      )}
      {panel === "import" && canEdit && (
        <ImportPanel crew={crew} setCrew={wrappedSetCrew} setCell={setCell} addLog={addLog} onClose={() => setPanel(null)} setStatus={setStatus} adminPassword={adminPassword} />
      )}

      {bulkMode && canEdit && (
        <div className="px-3 py-2 bg-orange-50 dark:bg-orange-950 border-b border-orange-200 dark:border-orange-800 text-xs text-orange-800 dark:text-orange-200 no-print">
          {selectedKeys.size === 0
            ? "Hromadný výber je zapnutý — klikaj na bunky v tabuľke, ktoré chceš označiť (označené dostanú modrý rámik a ✓)."
            : `Označených ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"} — vyber akciu dole, alebo pokračuj v označovaní ďalších.`}
        </div>
      )}

      {/* rezerva miesta dole, nech fixný panel (editor bunky / hromadný výber) neprekrýva posledné riadky tabuľky */}
      <div style={{ paddingBottom: bulkMode ? 210 : sel && canEdit ? 190 : 0 }}>
        <ScheduleTable
          days={filteredDays}
          crew={filteredCrew}
          cells={cells}
          cellOf={cellOf}
          canEdit={canEdit}
          bulkMode={bulkMode}
          selectedKeys={selectedKeys}
          onCellClick={handleCellClick}
          onMoveCrew={moveCrew}
          nad={nad}
          onDayClick={setDayDetailIso}
        />
      </div>

      {dayDetailIso && (
        <DayDetail
          iso={dayDetailIso}
          crew={crew}
          cellOf={cellOf}
          nad={nad}
          canEdit={canEdit}
          onSetNad={setNad}
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
