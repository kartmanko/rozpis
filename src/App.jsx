import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate, todayIso } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, ADMIN_STORAGE_KEY, THEME_STORAGE_KEY, ROLES, SK_MONTHS } from "./constants";
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
import ThemeToggle from "./components/ThemeToggle";

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
  const canEdit = isAdmin; // deklarované skoro, nech ho môžu použiť efekty definované nižšie (klávesové skratky a pod.)

  /* --- téma appky: svetlý / tmavý / auto (podľa systému) --- */
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_STORAGE_KEY) || "dark"; } catch { return "dark"; }
  });
  const setTheme = (t) => {
    try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch { /* ticho */ }
    setThemeState(t);
  };
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    const apply = () => {
      const light = theme === "light" || (theme === "system" && mq?.matches);
      document.documentElement.classList.toggle("light", light);
      document.documentElement.style.colorScheme = light ? "light" : "dark";
      const meta = document.getElementById("theme-color-meta");
      if (meta) meta.setAttribute("content", light ? "#f7f7f5" : "#101010");
    };
    apply();
    if (theme === "system" && mq) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  const [panel, setPanel] = useState(null); // "crew" | "import" | "log" | "admin" | "hook" | "nad"
  const [menu, setMenu] = useState(null); // "export" | "more" | null
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState("");
  const [dayDetailIso, setDayDetailIso] = useState(null);

  /* --- zatvorenie rozbaľovacieho menu (export / "⋯") kliknutím kamkoľvek mimo neho —
     bez toho ostávalo menu "zaseknuté" otvorené, keď niekto klikol inde na stránke,
     čo vyzeralo ako grafická chyba (menu prekrývalo obsah pod sebou). --- */
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  /* --- role štábu (kamera / réžia / logger) — jeden dátový model, tabuľka sa iba filtruje --- */
  const [activeRole, setActiveRole] = useState("kamera");
  const filteredCrew = useMemo(() => crew.filter((c) => (c.role || "kamera") === activeRole), [crew, activeRole]);

  /* --- výber mesiaca — filtruje zobrazené dni v tabuľke, nie exporty (tie idú vždy za celú sezónu) --- */
  const [activeMonth, setActiveMonth] = useState(null); // null = všetky mesiace
  const monthsInRange = useMemo(() => {
    const seen = [];
    for (const d of days) if (!seen.includes(d.month)) seen.push(d.month);
    return seen;
  }, [days]);
  const filteredDays = useMemo(
    () => (activeMonth === null ? days : days.filter((d) => d.month === activeMonth)),
    [days, activeMonth]
  );

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
  const anchorRef = useRef(null); // pevný roh rozsahu (pre Shift+klik / Shift+šípka)
  const cursorRef = useRef(null); // aktuálna/posledná pozícia (pohyblivý roh pri Shift, aj bod pre šípky)

  const key = (iso, cid) => iso + "|" + cid;
  const cellOf = (iso, cid) => cells[key(iso, cid)] || emptyCell;

  /* --- späť/znova (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z alebo Ctrl+Y) — zásobník stavov "cells",
     funguje pri akejkoľvek úprave (jedna bunka aj hromadná), nielen v režime výberu --- */
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  /* --- načítanie zo servera (Krok 1: bez nastaveného Workera appka beží čisto na lokálnych ukážkových dátach) --- */
  const load = useCallback(async () => {
    // nová sada dát zo servera/dema nie je "úprava" — zásobník späť/znova sa začína odznova
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
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
    // ak je aktívny filter na iný mesiac, najprv ho zrušíme, nech je dnešný deň vôbec v DOM
    setActiveMonth(null);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-iso="${todayIso()}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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

  /* --- jediné miesto, cez ktoré sa upravuje "cells", nech sa každá zmena dá vrátiť späť (Ctrl/Cmd+Z) --- */
  const commitCells = useCallback(
    (updater, logMsg) => {
      setCells((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next !== prev) {
          undoStackRef.current = [...undoStackRef.current, prev].slice(-60);
          redoStackRef.current = [];
        }
        return next;
      });
      setDirty(true);
      if (logMsg) addLog(logMsg);
      setHistoryVersion((v) => v + 1);
    },
    [addLog]
  );

  const undoCells = useCallback(() => {
    if (!undoStackRef.current.length) return;
    setCells((prev) => {
      const stack = undoStackRef.current;
      const target = stack[stack.length - 1];
      undoStackRef.current = stack.slice(0, -1);
      redoStackRef.current = [...redoStackRef.current, prev].slice(-60);
      return target;
    });
    setDirty(true);
    setStatus("Vrátené späť.");
    setHistoryVersion((v) => v + 1);
  }, []);

  const redoCells = useCallback(() => {
    if (!redoStackRef.current.length) return;
    setCells((prev) => {
      const stack = redoStackRef.current;
      const target = stack[stack.length - 1];
      redoStackRef.current = stack.slice(0, -1);
      undoStackRef.current = [...undoStackRef.current, prev].slice(-60);
      return target;
    });
    setDirty(true);
    setStatus("Zopakované.");
    setHistoryVersion((v) => v + 1);
  }, []);

  const setCell = useCallback(
    (iso, cid, patch) => {
      commitCells((prev) => {
        const k = iso + "|" + cid;
        const cur = prev[k] || emptyCell;
        const next = { ...cur, ...patch };
        const empty = !next.off && !next.shift && !next.duel && !next.note;
        const out = { ...prev };
        if (empty) delete out[k]; else out[k] = next;
        return out;
      });
    },
    [commitCells]
  );

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
        commitCells((prev) => {
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
    [crew, addLog, commitCells]
  );

  /* --- hromadná úprava vybraných buniek --- */
  const applyBulk = useCallback(
    (patch) => {
      if (!selectedKeys.size) return;
      commitCells((prev) => {
        const out = { ...prev };
        selectedKeys.forEach((k) => {
          const cur = out[k] || emptyCell;
          const next = { ...cur, ...patch };
          const empty = !next.off && !next.shift && !next.duel && !next.note;
          if (empty) delete out[k]; else out[k] = next;
        });
        return out;
      }, `Hromadná úprava — ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"}`);
    },
    [selectedKeys, commitCells]
  );

  const wrappedSetCrew = useCallback((updater) => { setCrew(updater); setDirty(true); }, []);

  /* --- výmena smeny (jeden krok späť/znova pre celú výmenu naraz) --- */
  const swap = (iso, aId, bId) => {
    const nameOf = (id) => crew.find((c) => c.id === id)?.name || "?";
    commitCells((prev) => {
      const a = prev[iso + "|" + aId] || emptyCell;
      const b = prev[iso + "|" + bId] || emptyCell;
      const out = { ...prev };
      out[iso + "|" + aId] = { ...b };
      out[iso + "|" + bId] = { ...a };
      [aId, bId].forEach((cid) => {
        const k = iso + "|" + cid;
        const v = out[k];
        if (v && !v.off && !v.shift && !v.duel && !v.note) delete out[k];
      });
      return out;
    }, `Výmena ${skDate(iso)}: ${nameOf(aId)} ↔ ${nameOf(bId)}`);
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

  /* --- klik na bunku: buď hromadný výber, alebo editor jednej bunky ---
     computeRangeKeys počíta CELÝ obdĺžnik medzi dvomi bunkami (nielen rovnaký stĺpec/riadok
     ako predtým) — funguje pre Shift+klik, Shift+šípku aj ťahanie myšou/prstom.
     Počíta sa vždy nad AKTUÁLNE ZOBRAZENÝMI dňami/štábom (filteredDays/filteredCrew), nech
     rozsah nezasahuje do skrytých mesiacov/rolí, keď je aktívny filter. */
  const computeRangeKeys = (a, b) => {
    const rowA = filteredDays.findIndex((d) => d.iso === a.iso);
    const rowB = filteredDays.findIndex((d) => d.iso === b.iso);
    const colA = filteredCrew.findIndex((c) => c.id === a.crewId);
    const colB = filteredCrew.findIndex((c) => c.id === b.crewId);
    if (rowA === -1 || rowB === -1 || colA === -1 || colB === -1) return [key(b.iso, b.crewId)];
    const [rowLo, rowHi] = rowA < rowB ? [rowA, rowB] : [rowB, rowA];
    const [colLo, colHi] = colA < colB ? [colA, colB] : [colB, colA];
    const out = [];
    for (let r = rowLo; r <= rowHi; r++) {
      for (let c = colLo; c <= colHi; c++) out.push(key(filteredDays[r].iso, filteredCrew[c].id));
    }
    return out;
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
    cursorRef.current = pos;
  };

  // ťahanie myšou/prstom (podržaním na mobile) — vždy nahradí výber čerstvým obdĺžnikom,
  // presne ako v Exceli; jednotlivé "poklepania" (handleCellClick vyššie) ostávajú prídavné.
  const onDragSelect = (startPos, currentPos) => {
    setSelectedKeys(new Set(computeRangeKeys(startPos, currentPos)));
    anchorRef.current = startPos;
    cursorRef.current = currentPos;
  };

  // klik na hlavičku stĺpca (meno) v režime výberu -> označí celý stĺpec (Shift/Ctrl/Cmd = pridá k výberu)
  const onSelectColumn = (crewId, event) => {
    const additive = Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    const colKeys = filteredDays.map((d) => key(d.iso, crewId));
    setSelectedKeys((prev) => {
      if (!additive) return new Set(colKeys);
      const allSelected = colKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      colKeys.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
    anchorRef.current = { iso: filteredDays[0]?.iso, crewId };
    cursorRef.current = { iso: filteredDays[filteredDays.length - 1]?.iso, crewId };
  };

  // klik na dátumovú bunku v režime výberu -> označí celý riadok (deň)
  const onSelectRow = (iso, event) => {
    const additive = Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    const rowKeys = filteredCrew.map((c) => key(iso, c.id));
    setSelectedKeys((prev) => {
      if (!additive) return new Set(rowKeys);
      const allSelected = rowKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      rowKeys.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
    anchorRef.current = { iso, crewId: filteredCrew[0]?.id };
    cursorRef.current = { iso, crewId: filteredCrew[filteredCrew.length - 1]?.id };
  };

  const toggleBulkMode = () => {
    setBulkMode((v) => !v);
    setSelectedKeys(new Set());
    anchorRef.current = null;
    cursorRef.current = null;
    setSel(null);
  };

  /* --- klávesové skratky pre hromadný výber a späť/znova ---
     Späť/znova (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) fungujú kedykoľvek, keď je admin
     prihlásený. Šípky/Delete/písmená A-B-C-R/Esc fungujú iba v zapnutom hromadnom výbere.
     Nič z toho nezasahuje, keď má fokus textové pole (input/textarea/select). */
  useEffect(() => {
    const isTypingTarget = (el) =>
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

    const onKeyDown = (e) => {
      if (isTypingTarget(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (canEdit && mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redoCells(); else undoCells();
        return;
      }
      if (canEdit && mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redoCells();
        return;
      }

      if (!bulkMode || !canEdit) return;

      if (e.key === "Escape") {
        if (selectedKeys.size) { setSelectedKeys(new Set()); anchorRef.current = null; cursorRef.current = null; }
        else toggleBulkMode();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedKeys.size) {
        e.preventDefault();
        applyBulk({ off: false, shift: null, duel: false });
        return;
      }

      if (selectedKeys.size && /^[abcr]$/i.test(e.key)) {
        e.preventDefault();
        applyBulk({ shift: e.key.toUpperCase() });
        return;
      }

      const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (dirs[e.key] && filteredDays.length && filteredCrew.length) {
        e.preventDefault();
        const base = cursorRef.current || anchorRef.current || { iso: filteredDays[0].iso, crewId: filteredCrew[0].id };
        const rowIdx = filteredDays.findIndex((d) => d.iso === base.iso);
        const colIdx = filteredCrew.findIndex((c) => c.id === base.crewId);
        if (rowIdx === -1 || colIdx === -1) return;
        const [dr, dc] = dirs[e.key];
        const nr = Math.min(Math.max(rowIdx + dr, 0), filteredDays.length - 1);
        const nc = Math.min(Math.max(colIdx + dc, 0), filteredCrew.length - 1);
        const nextPos = { iso: filteredDays[nr].iso, crewId: filteredCrew[nc].id };
        cursorRef.current = nextPos;
        if (e.shiftKey) {
          if (!anchorRef.current) anchorRef.current = base;
          setSelectedKeys(new Set(computeRangeKeys(anchorRef.current, nextPos)));
        } else {
          anchorRef.current = nextPos;
          setSelectedKeys(new Set([key(nextPos.iso, nextPos.crewId)]));
        }
        requestAnimationFrame(() => {
          document.querySelector(`[data-cell-key="${nextPos.iso}|${nextPos.crewId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkMode, canEdit, selectedKeys, filteredDays, filteredCrew, applyBulk, undoCells, redoCells]);

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

          <div ref={menuRef} className="flex items-center gap-1 relative">
            <button title="Obnoviť" onClick={load} className="w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">⟳</button>

            <button title="Export" onClick={() => setMenu(menu === "export" ? null : "export")} className="w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">↓</button>
            {menu === "export" && (
              <div className="absolute top-10 right-20 z-50 bg-f-panel3 border border-f-border rounded-lg shadow-xl p-1.5 w-36 flex flex-col gap-0.5">
                <button onClick={() => { exportCSV(days, crew, cellOf); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">CSV</button>
                <button onClick={() => { exportXLSX(days, crew, cellOf); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">XLSX</button>
                <button onClick={() => { printSchedule(); setMenu(null); }} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Tlač / PDF</button>
              </div>
            )}

            <button title="NAD časy" onClick={() => togglePanel("nad")} className={`w-8 h-8 rounded-md border flex items-center justify-center ${panel === "nad" ? "border-f-accent bg-f-accent text-f-ink" : "border-f-border bg-f-panel text-f-muted hover:text-f-text"}`}>⏱</button>

            {/* Hromadný výber — iba pre admina, preto samostatná ikonka len keď je canEdit */}
            {canEdit && (
              <button
                title="Hromadný výber"
                onClick={toggleBulkMode}
                className={`w-8 h-8 rounded-md border flex items-center justify-center ${bulkMode ? "border-f-accent bg-f-accent text-f-ink" : "border-f-border bg-f-panel text-f-muted hover:text-f-text"}`}
              >
                ☑
              </button>
            )}

            <button title="Viac" onClick={() => setMenu(menu === "more" ? null : "more")} className="relative w-8 h-8 rounded-md border border-f-border bg-f-panel text-f-muted hover:text-f-text flex items-center justify-center">
              ⋯
              {pendingHook.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-ink text-[9px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
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
                <div className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="text-sm text-f-text">Motív</span>
                  <ThemeToggle theme={theme} onChange={setTheme} />
                </div>
                <button onClick={() => togglePanel("log")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">História</button>
                <button onClick={() => togglePanel("admin")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">{isAdmin ? "Admin" : "Prihlásenie"}</button>
                {canEdit && (
                  <>
                    <div className="border-t border-f-hair my-1" />
                    <div className="flex gap-1 px-2.5 py-1">
                      <button onClick={() => { undoCells(); setMenu(null); }} disabled={!canUndo} title="Späť (Ctrl/Cmd+Z)" className="flex-1 px-2 py-1 rounded-md text-sm bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30">↶ Späť</button>
                      <button onClick={() => { redoCells(); setMenu(null); }} disabled={!canRedo} title="Znova (Ctrl/Cmd+Shift+Z)" className="flex-1 px-2 py-1 rounded-md text-sm bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30">↷ Znova</button>
                    </div>
                    <div className="border-t border-f-hair my-1" />
                    <button onClick={() => togglePanel("import")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Import z chatu</button>
                    <button onClick={() => togglePanel("crew")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Štáb</button>
                    <button onClick={() => togglePanel("hook")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                      WhatsApp fronta
                      {pendingHook.length > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-ink text-[9px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
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

        {/* výber mesiaca — filtruje zobrazené dni v tabuľke (exporty idú vždy za celú sezónu) */}
        <div className="flex gap-1.5 mt-2 overflow-x-auto">
          <button
            onClick={() => setActiveMonth(null)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${activeMonth === null ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:text-f-text"}`}
          >
            Všetky
          </button>
          {monthsInRange.map((m) => (
            <button
              key={m}
              onClick={() => setActiveMonth(m)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${activeMonth === m ? "bg-f-accent text-f-ink" : "bg-f-panel2 text-f-muted hover:text-f-text"}`}
            >
              {SK_MONTHS[m]}
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
          // Text a tlačidlo sú zámerne v dvoch samostatných blokoch pod sebou (nie v jednom
          // flex riadku vedľa seba) — mix "holého" textu a tlačidla v jednom flex-wrap riadku
          // sa v niektorých prehliadačoch (najmä mobilný Safari) vie zle prelomiť a tlačidlo
          // sa prekryje s textom namiesto toho, aby spadlo na vlastný riadok.
          <div className="mt-2 p-2 rounded-lg bg-f-accent/10 border border-f-accent/50 text-xs text-f-text">
            <div>Niekto iný medzitým zmenil dáta na serveri — tvoje posledné zmeny sa neuložili.</div>
            <button onClick={resolveConflict} className="mt-1.5 px-2 py-0.5 rounded-lg bg-f-accent text-f-ink font-bold">
              Načítať znova (zahodí moje neuložené zmeny)
            </button>
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
        // min-h nech je pevná — text sa mení podľa počtu vybraných buniek a bez pevnej výšky by
        // sa pri prvom výbere (0 -> 1 bunka) tabuľka pod tým o pár pixelov posunula (iný počet
        // riadkov textu), čo je pri práve prebiehajúcom ťahaní/označovaní rušivé.
        <div className="px-3.5 py-2 min-h-[2.75rem] flex items-center bg-f-accent/10 border-b border-f-accent/40 text-xs text-f-text no-print">
          {selectedKeys.size === 0
            ? "Hromadný výber je zapnutý — klikaj, ťahaj, alebo klikni na meno/dátum pre celý stĺpec/riadok."
            : `Označených ${selectedKeys.size} ${selectedKeys.size === 1 ? "bunka" : "buniek"} — vyber akciu dole, alebo pokračuj v označovaní ďalších.`}
        </div>
      )}

      {/* rezerva miesta dole, nech fixný panel (editor bunky / hromadný výber) neprekrýva posledné riadky tabuľky */}
      <div style={{ paddingBottom: bulkMode ? 250 : sel && canEdit ? 190 : 0 }}>
        <ScheduleTable
          days={filteredDays}
          crew={filteredCrew}
          cells={cells}
          cellOf={cellOf}
          canEdit={canEdit}
          bulkMode={bulkMode}
          selectedKeys={selectedKeys}
          onCellClick={handleCellClick}
          onDragSelect={onDragSelect}
          onSelectColumn={onSelectColumn}
          onSelectRow={onSelectRow}
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
          onClearSelection={() => { setSelectedKeys(new Set()); anchorRef.current = null; cursorRef.current = null; }}
          onExit={toggleBulkMode}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undoCells}
          onRedo={redoCells}
        />
      )}
    </div>
  );
}
