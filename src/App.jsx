import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { buildDays, cycleInfo, skDate, todayIso } from "./dateUtils";
import { DEFAULT_NAMES, REFRESH_INTERVAL_MS, REFRESH_PO_NAVRATE_MS, THEME_STORAGE_KEY, ROLES, SK_MONTHS } from "./constants";
import { fetchData, saveData, ApiError, getApiBase, authMe, authVerify, authLogout, pushOznam } from "./api";
import { capsOf, sectionsOf, cellAccess, DEMO_USER } from "./permissions";
import { exportCSV, exportXLSX, printSchedule } from "./export";
import { BUILD_ID } from "./buildId.generated";
import { pripravAktualizaciu } from "./pwa";
import { DEMO_DATA } from "./demoData";

import Legend from "./components/Legend";
import CellEditor from "./components/CellEditor";
import CrewPanel from "./components/CrewPanel";
import LogPanel from "./components/LogPanel";
import ImportPanel from "./components/ImportPanel";
import TabulkaPanel from "./components/TabulkaPanel";
import AdminPanel from "./components/AdminPanel";
import ScheduleTable from "./components/ScheduleTable";
import BulkActionBar from "./components/BulkActionBar";
import DayDetail from "./components/DayDetail";
import NadPanel from "./components/NadPanel";
import WhatsAppQueuePanel from "./components/WhatsAppQueuePanel";
import ThemeToggle from "./components/ThemeToggle";
import LoginScreen from "./components/LoginScreen";
import UsersPanel from "./components/UsersPanel";
import SadzbyPanel from "./components/SadzbyPanel";
import VykazyPanel from "./components/VykazyPanel";
import ChatyPanel from "./components/ChatyPanel";
import ReportyPanel from "./components/ReportyPanel";
import DispoPanel from "./components/DispoPanel";
import { sadzbaProfesie, DEFAULT_SADZBY, hodinyNadcasu, hod } from "./vykazy";
import { pouziNavrh } from "./tabulkaImport";
import { skusZlucit, zmeneneKluce } from "./zlucenie";
import { ulozNeulozene, nacitajNeulozene, zahodNeulozene } from "./neulozene";

const defaultCrew = () => DEFAULT_NAMES.map((n, i) => ({ id: "c" + i, name: n, aliases: [], role: "kamera" }));
// "nadcas" = nahlásené hodiny nadčasu k tomuto dňu (Fáza 2).
const emptyCell = { off: false, shift: null, duel: false, note: "", nadcas: 0 };

// Bunka, v ktorej nie je vôbec nič, sa zo stavu maže — nech databáza nerastie prázdnymi
// bunkami. Pozor: každé pole, ktoré bunka drží, musí byť aj tu (aj nadčas), inak by sa
// bunka s nahláseným nadčasom ticho zmazala.
const prazdnaBunka = (c) => !c.off && !c.shift && !c.duel && !c.note && !Number(c.nadcas);

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
  const [sadzby, setSadzbyState] = useState({}); // profesia -> { den, duel, denDuel, nadcasPct } (Fáza 2)
  const [nad, setNadState] = useState({}); // "A"|"B"|"C"|"R"|"duel" -> { depart, return } — univerzálne, neviaže sa na dátum
  const [chaty, setChatyState] = useState({}); // sledované WhatsApp skupiny (Fáza 3)
  const [reporty, setReportyState] = useState({}); // denné reporty réžie (Fáza 4)
  const [dispo, setDispoState] = useState({}); // POTVRDENÉ dispozície, kľúč = deň (Fáza 5)
  const [pendingDispo, setPendingDispoState] = useState([]); // návrhy z dispo mailov, čakajú na potvrdenie
  const [pendingHook, setPendingHookState] = useState([]); // nepriradené správy z WhatsApp bridge
  const [log, setLog] = useState([]);
  const [version, setVersion] = useState(0);

  const [loaded, setLoaded] = useState(false);
  const [connError, setConnError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  /* --- prihlásený človek a jeho práva (Fáza 1) ---
     me === undefined = ešte overujeme, null = neprihlásený, objekt = prihlásený.
     Bez nastaveného servera beží appka v demo režime s plnými právami, nech sa dá
     vyskúšať naprázdno (a nech fungujú automatické testy). */
  const demoMode = !getApiBase();
  const [me, setMe] = useState(undefined);
  const [authError, setAuthError] = useState("");

  const caps = useMemo(() => capsOf(me?.role), [me]);
  const mySections = useMemo(() => sectionsOf(me?.role), [me]);
  const canEditCells = Boolean(me) && (mySections.length > 0 || (caps.ownOff && me.crewId));
  const canEditAll = Boolean(me) && mySections.length > 0; // vedúci a admin — hromadné úpravy, výmeny
  const canEdit = canEditAll; // deklarované skoro, nech ho môžu použiť efekty nižšie (skratky a pod.)

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

  const [panel, setPanel] = useState(null); // "crew" | "import" | "tabulka" | "log" | "admin" | "hook" | "nad" | "vykazy" | "sadzby" | "chaty" | "reporty" | "dispo"
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

  /* --- výkazy (Fáza 2) — majú vlastný výber mesiaca, nezávislý od tabuľky --- */
  const [vykazMesiac, setVykazMesiac] = useState(null); // null = celá produkcia
  const vykazDni = useMemo(
    () => (vykazMesiac === null ? days : days.filter((d) => d.month === vykazMesiac)),
    [days, vykazMesiac]
  );

  /* --- automatická kontrola novej verzie appky (na otvorenie, návrat do popredia, aj periodicky) --- */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const latest = await fetchLatestBuildId();
      if (!cancelled && latest && latest !== BUILD_ID) {
        // service workerovi ešte povieme, nech zahodí starú kešu a prepne sa na
        // nový build — inak by po obnovení mohol podstrčiť starú stránku
        await pripravAktualizaciu();
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

  /* --- overenie prihlásenia pri štarte ---
     Ak appku otvoril prihlasovací odkaz z mailu (…/?login=TOKEN), token sa hneď
     vymení za session cookie a z adresy sa odstráni, nech sa nedá omylom preposlať. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (demoMode) {
        if (!cancelled) setMe(DEMO_USER);
        return;
      }
      const url = new URL(window.location.href);
      const token = url.searchParams.get("login");
      if (token) {
        try {
          await authVerify(token);
        } catch (e) {
          if (!cancelled) setAuthError(e.message || "Prihlásenie zlyhalo.");
        }
        url.searchParams.delete("login");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
      try {
        const d = await authMe();
        if (!cancelled) setMe(d.user || null);
      } catch (e) {
        if (!cancelled) {
          setMe(null);
          setAuthError(e.message || "Server neodpovedá.");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try { await authLogout(); } catch { /* ticho */ }
    window.location.reload();
  };

  /* --- načítanie zo servera (Krok 1: bez nastaveného Workera appka beží čisto na lokálnych ukážkových dátach) --- */
  /* Stav, z ktorého vychádzame — posledné načítanie alebo posledné úspešné
     uloženie. Podľa neho sa pri strete verzií pozná, ktoré bunky menil tento
     človek a ktoré niekto iný. */
  const zakladRef = useRef(null);
  // poistka proti donekonečna sa opakujúcemu skladaniu, keď je server pod náporom
  const pokusyOZlucenie = useRef(0);

  /* Opakovanie zápisu, keď vypadne signál. Ukladanie sa spúšťa zmenou stavu,
     takže keď zlyhá a človek už nič neklikne, samo od seba by sa to nikdy
     neskúsilo — appka by sa len tvárila, že to skúsi. Preto si tu držíme
     počítadlo, ktorého zvýšenie ukladanie znova naštartuje. */
  const [zapisPokus, setZapisPokus] = useState(0);
  const opakovanieTimer = useRef(null);
  const pokusyOZapis = useRef(0);
  // odložený stav z minula, ktorý sa ponúka obnoviť (appka navrhne, človek potvrdí)
  const [odlozene, setOdlozene] = useState(null);

  const load = useCallback(async () => {
    // nová sada dát zo servera/dema nie je "úprava" — zásobník späť/znova sa začína odznova
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    if (!getApiBase()) {
      setCrew(DEMO_DATA.crew);
      setCells(DEMO_DATA.cells);
      setNadState(DEMO_DATA.nad);
      setSadzbyState({});
      setChatyState({});
      setReportyState({});
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
      setSadzbyState(d.sadzby || {});
      setChatyState(d.chaty || {});
      setReportyState(d.reporty || {});
      setDispoState(d.dispo || {});
      setPendingDispoState(d.pendingDispo || []);
      setPendingHookState(d.pendingHook || []);
      setLog(d.log || []);
      setVersion(d.version || 0);
      zakladRef.current = {
        crew: d.crew || [], cells: d.cells || {}, nad: d.nad || {}, sadzby: d.sadzby || {},
        chaty: d.chaty || {}, reporty: d.reporty || {}, dispo: d.dispo || {},
        pendingDispo: d.pendingDispo || [], pendingHook: d.pendingHook || [], log: d.log || [],
      };
      pokusyOZlucenie.current = 0;
      setConnError("");
      setConflict(false);
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        /* Session vypršala. Ukladanie na to reaguje rovnako — inak by tu človek
           ostal sedieť nad starými dátami a klikal do rozpisu, ktorý sa už
           nemá kam uložiť. */
        setMe(null);
        setAuthError("Prihlásenie vypršalo, prihlás sa znova.");
        setConnError("");
      } else if (e instanceof ApiError && e.status === 0 && !e.siet) {
        setConnError("Backend nie je nastavený — otvor Admin (cez ⋯) a zadaj adresu Cloudflare Workera.");
      } else {
        setConnError("Nepodarilo sa načítať dáta zo servera: " + e.message);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  // rozpis načítavame až keď vieme, kto je prihlásený (server ho inak nevydá)
  useEffect(() => { if (me) load(); }, [load, me]);

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

  /* --- auto-refresh (kto needituje, alebo nemá rozpracované zmeny) ---

     Šetríme čítania z Cloudflare KV, ktoré má denný strop pre celú appku:
     - obnovuje sa raz za REFRESH_INTERVAL_MS (15 min), nie každé 2 minúty,
     - kým je karta v pozadí, neobnovuje sa vôbec (telefón v zadnom vrecku
       nepotrebuje čerstvý rozpis),
     - po návrate ku karte sa obnoví hneď, ak sú dáta staršie než minúta —
       takže človek vidí aktuálny stav v okamihu, keď sa naň pozrie.
     Kto chce dáta okamžite, má v hlavičke "Obnoviť". */
  const poslednyRefresh = useRef(Date.now());
  useEffect(() => {
    const mozeme = () => getApiBase() && me && (!canEditCells || !dirty);
    const obnov = () => {
      if (!mozeme()) return;
      poslednyRefresh.current = Date.now();
      load();
    };

    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      obnov();
    }, REFRESH_INTERVAL_MS);

    const priNavrate = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - poslednyRefresh.current < REFRESH_PO_NAVRATE_MS) return;
      obnov();
    };
    document.addEventListener("visibilitychange", priNavrate);

    return () => { clearInterval(t); document.removeEventListener("visibilitychange", priNavrate); };
  }, [canEditCells, dirty, load, me]);

  /* --- debounované ukladanie — v demo režime (bez Workera) sa iba nastaví "uložené" lokálne --- */
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded || !canEditCells || conflict) return;
    /* Ukladáme iba vtedy, keď človek naozaj niečo zmenil. Bez tejto podmienky sa
       zapisovalo aj po obyčajnom načítaní appky — a keďže server drží jedno
       spoločné číslo verzie, každý, kto ráno otvoril appku, posunul verziu a
       ostatným vyskočila hláška o strete, hoci sa nikto ničoho nedotkol. */
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!getApiBase()) {
        setDirty(false);
        setStatus("Demo režim — zmeny sú len lokálne v tomto prehliadači (Krok 1).");
        return;
      }
      setSaving(true);
      const odoslane = { crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log };
      try {
        const res = await saveData({ ...odoslane, baseVersion: version });
        setVersion(res.version);
        zakladRef.current = odoslane;
        pokusyOZlucenie.current = 0;
        pokusyOZapis.current = 0;
        zahodNeulozene();
        setDirty(false);
        setStatus("Uložené na server.");
      } catch (e) {
        /* Čokoľvek, čo sa nepodarilo uložiť, si odložíme do prehliadača. Keby
           človek appku zavrel, po otvorení sa mu to ponúkne obnoviť. */
        ulozNeulozene(me?.email, zakladRef.current, odoslane);
        if (e instanceof ApiError && e.status === 409) {
          /* Niekto uložil skôr. Kým sme sa nedotkli tej istej bunky, nie je to
             ozajstný spor — appka vezme jeho stav a dopíše doň ten svoj. Ak sa
             prekrývame, zlúčenie sa nepokúsi a rozhodne človek. */
          const zlucene = pokusyOZlucenie.current < 5
            ? skusZlucit(zakladRef.current, odoslane, e.telo?.current)
            : null;
          if (zlucene) {
            pokusyOZlucenie.current += 1;
            const s = e.telo.current;
            /* Všetko okrem buniek preberáme rovno zo servera — zlúčiť sa smelo
               iba preto, že sme sa toho ani nedotkli, takže jeho verzia je tá
               správna. Bez toho by sme mu vzápätí prepísali napr. zmenu v štábe
               našou starou kópiou. */
            if (s.crew?.length) setCrew(s.crew);
            setNadState(s.nad || {});
            setSadzbyState(s.sadzby || {});
            setChatyState(s.chaty || {});
            setReportyState(s.reporty || {});
            setDispoState(s.dispo || {});
            setPendingDispoState(s.pendingDispo || []);
            setPendingHookState(s.pendingHook || []);
            setCells(zlucene.cells);
            setLog(zlucene.log);
            setVersion(s.version);
            zakladRef.current = {
              crew: s.crew || [], cells: s.cells || {}, nad: s.nad || {}, sadzby: s.sadzby || {},
              chaty: s.chaty || {}, reporty: s.reporty || {}, dispo: s.dispo || {},
              pendingDispo: s.pendingDispo || [], pendingHook: s.pendingHook || [], log: s.log || [],
            };
            setDirty(true);
            setStatus("Medzitým ukladal niekto iný — zmeny som poskladal dokopy.");
          } else {
            setConflict(true);
            setStatus("");
          }
        } else if (e instanceof ApiError && e.status === 401) {
          setMe(null);
          setAuthError("Prihlásenie vypršalo, prihlás sa znova.");
          setStatus("");
        } else if ((e instanceof ApiError && e.siet) || e.status >= 500) {
          /* Signál vypadol alebo je server chvíľu mimo. Nie je to chyba človeka
             ani appky — stačí to o chvíľu skúsiť znova. Odstupy sa predlžujú,
             nech sa server pri výpadku nezasype opakovanými pokusmi. */
          pokusyOZapis.current += 1;
          const odstup = Math.min(30000, 3000 * 2 ** (pokusyOZapis.current - 1));
          setStatus(`Bez spojenia — neuložené. Skúsim znova o ${Math.round(odstup / 1000)} s.`);
          clearTimeout(opakovanieTimer.current);
          opakovanieTimer.current = setTimeout(() => setZapisPokus((v) => v + 1), odstup);
        } else {
          setStatus("Uloženie zlyhalo: " + e.message);
        }
      }
      setSaving(false);
    }, 600);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log, zapisPokus]);

  /* Keď telefónu nabehne signál, nečaká sa na ďalší odstup — skúsi sa hneď.
     Toto je ten bežný prípad: človek vyjde spoza stodoly a zmena má odletieť. */
  useEffect(() => {
    const nasignal = () => {
      clearTimeout(opakovanieTimer.current);
      pokusyOZapis.current = 0;
      setZapisPokus((v) => v + 1);
    };
    window.addEventListener("online", nasignal);
    return () => {
      window.removeEventListener("online", nasignal);
      clearTimeout(opakovanieTimer.current);
    };
  }, []);

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
    (iso, cid, patch, logMsg) => {
      commitCells((prev) => {
        const k = iso + "|" + cid;
        const cur = prev[k] || emptyCell;
        const next = { ...cur, ...patch };
        const empty = prazdnaBunka(next);
        const out = { ...prev };
        if (empty) delete out[k]; else out[k] = next;
        return out;
      }, logMsg);
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

  // Sadzby profesií (Fáza 2). Ukladá sa iba to, čo sa naozaj líši od predvoleného,
  // nech v databáze nezostávajú zbytočné kópie predvolených čísel.
  const setSadzba = useCallback((profesia, patch) => {
    setSadzbyState((prev) => {
      const zaklad = DEFAULT_SADZBY[profesia] || DEFAULT_SADZBY.kamera;
      const spojene = { ...zaklad, ...(prev[profesia] || {}) };
      for (const [k, v] of Object.entries(patch)) {
        const cislo = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
        spojene[k] = Number.isFinite(cislo) && cislo >= 0 ? cislo : 0;
      }
      const rozdiel = {};
      for (const [k, v] of Object.entries(spojene)) if (Number(v) !== Number(zaklad[k])) rozdiel[k] = v;
      const out = { ...prev };
      if (Object.keys(rozdiel).length) out[profesia] = rozdiel; else delete out[profesia];
      return out;
    });
    setDirty(true);
  }, []);

  /* Zapnutie/vypnutie sledovaného WhatsApp chatu (Fáza 3).
     Nový chat sa na serveri vždy založí ako vypnutý — tu sa iba prepína. */
  const setChat = useCallback((chatId, patch) => {
    setChatyState((prev) => {
      const cur = prev[chatId];
      if (!cur) return prev;
      return { ...prev, [chatId]: { ...cur, ...patch } };
    });
    setDirty(true);
  }, []);

  /* Denné reporty (Fáza 4). Appka ich nevytvára — chodia z WhatsAppu cez server.
     Cez appku sa dá reportu iba prehodiť deň (keď ho server odhadol podľa dňa
     doručenia) alebo ho zmazať. Text sa nikdy nemení. */
  const setReportDatum = useCallback((id, datum) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum || ""))) return;
    setReportyState((prev) => {
      const cur = prev[id];
      if (!cur || cur.datum === datum) return prev;
      // "rucne" = deň potvrdil človek, takže report už nesvieti ako nedoriešený
      return { ...prev, [id]: { ...cur, datum, zdrojDatumu: "rucne" } };
    });
    addLog(`Report prehodený na ${datum}`);
    setDirty(true);
  }, [addLog]);

  // "deň sedí" — potvrdenie odhadnutého dňa bez toho, aby sa dátum menil
  const potvrdReportDen = useCallback((id) => {
    setReportyState((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, zdrojDatumu: "rucne" } };
    });
    setDirty(true);
  }, []);

  const zmazReport = useCallback((id) => {
    setReportyState((prev) => {
      if (!prev[id]) return prev;
      const out = { ...prev };
      delete out[id];
      return out;
    });
    addLog("Report zmazaný");
    setDirty(true);
  }, [addLog]);

  // reporty, ktorým server iba odhadol deň podľa dňa doručenia — čakajú na potvrdenie
  const reportovNaPotvrdenie = useMemo(
    () => Object.values(reporty || {}).filter((r) => r.zdrojDatumu === "sprava").length,
    [reporty],
  );

  /* Dispozície (Fáza 5). Mail s dispozíciou prečíta server, ale nič ním neprepíše —
     odloží ho do "pendingDispo" ako návrh. Tu sa návrh potvrdí a AŽ VTEDY sa
     harmonogram zapíše ku dňu a zaškrtnuté zmeny do rozpisu. Nič sa nikdy nezapíše
     samo: to je celý zmysel Fázy 5. */
  const potvrdDispo = useCallback((navrh, volba) => {
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(volba?.datum || "")) ? volba.datum : navrh.datum;

    // 1. harmonogram dňa — ukáže sa v detaile dňa
    if (volba?.harmonogram && (navrh.harmonogram || []).length) {
      setDispoState((prev) => ({
        ...prev,
        [datum]: {
          datum,
          harmonogram: navrh.harmonogram,
          poznamky: navrh.poznamky || "",
          predmet: navrh.predmet || "",
          potvrdene: new Date().toISOString(),
        },
      }));
    }

    // 2. zmeny v obsadení — iba tie zaškrtnuté a iba tie, pri ktorých vieme, o koho ide
    const vybrane = Object.entries(volba?.zmeny || {})
      .filter(([, z]) => z?.vybrane && z?.crewId)
      .map(([i, z]) => ({ ...(navrh.zmeny || [])[Number(i)], crewId: z.crewId }))
      .filter((z) => z && (z.smena || z.nemoze));

    if (vybrane.length) {
      commitCells((prev) => {
        const out = { ...prev };
        vybrane.forEach((z) => {
          const k = datum + "|" + z.crewId;
          const cur = out[k] || emptyCell;
          // "nemôže" má prednosť — keď človek v ten deň nie je, smena nedáva zmysel
          const next = z.nemoze ? { ...cur, off: true, shift: null } : { ...cur, off: false, shift: z.smena };
          const empty = prazdnaBunka(next);
          if (empty) delete out[k]; else out[k] = next;
        });
        return out;
      }, `Dispo potvrdené na ${datum} — ${vybrane.length} zmien v obsadení`);
    }

    setPendingDispoState((prev) => prev.filter((x) => x.id !== navrh.id));
    const kusky = [];
    if (volba?.harmonogram && (navrh.harmonogram || []).length) kusky.push(`harmonogram (${navrh.harmonogram.length} položiek)`);
    if (vybrane.length) kusky.push(`${vybrane.length} zmien v obsadení`);
    addLog(`Dispo na ${datum} potvrdené: ${kusky.length ? kusky.join(", ") : "nič sa neprebralo"}`);
    setDirty(true);

    /* Až teraz — po potvrdení človekom — sa o dispozícii dozvie štáb (Fáza 6).
       Kým to admin nepotvrdí, nikomu nič nezapípa. Keď upozornenie neprejde
       (server nedostupný, nikto nemá zapnuté), potvrdenie tým netrpí. */
    if (kusky.length) {
      pushOznam({
        nadpis: "Dispozícia na " + datum,
        text: "Rozpis na " + datum + " je aktualizovaný: " + kusky.join(", ") + ".",
        url: "/",
        znacka: "dispo-" + datum,
      }).catch(() => { /* ticho — upozornenie je bonus, nie podmienka */ });
    }
  }, [addLog, commitCells]);

  const zahodDispo = useCallback((id) => {
    setPendingDispoState((prev) => prev.filter((x) => x.id !== id));
    addLog("Dispo mail zahodený");
    setDirty(true);
  }, [addLog]);

  // zmazanie už potvrdenej dispozície — rozpis to nechá tak, zmizne len harmonogram dňa
  const zrusPotvrdeneDispo = useCallback((datum) => {
    setDispoState((prev) => {
      if (!prev[datum]) return prev;
      const out = { ...prev };
      delete out[datum];
      return out;
    });
    addLog(`Potvrdená dispozícia na ${datum} zmazaná`);
    setDirty(true);
  }, [addLog]);

  // koľko dispo mailov čaká na potvrdenie
  const dispoNaPotvrdenie = (pendingDispo || []).length;

  // koľko skupín čaká na rozhodnutie (ani zapnuté, ani vedome vypnuté)
  const novychChatov = useMemo(
    () => Object.values(chaty || {}).filter((c) => !c.povoleny && !c.rozhodnute).length,
    [chaty],
  );

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
            const empty = prazdnaBunka(next);
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
          const empty = prazdnaBunka(next);
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

  // čo smie prihlásený človek robiť s bunkou danej osoby: "full" | "off" | "none"
  const accessFor = useCallback(
    (crewId) => cellAccess(me, crew.find((c) => c.id === crewId)),
    [me, crew]
  );

  /* Keď si člen štábu sám preklikne vlastnú bunku, musí to byť vidieť v Histórii.
     Admin sa o tom inak dozvie iba tak, že si náhodou všimne inú farbu — a to je
     presne tá „ticho prepísaná“ zmena, ktorú tu nechceme. Zmeny, ktoré robí
     vedúci alebo admin, sa nelogujú: robí ich ten istý človek, čo Históriu číta,
     a má na ne krok späť. */
  const popisVlastnejZmeny = useCallback(
    (iso, cid, patch) => {
      if (accessFor(cid) !== "off") return null;
      if (!("off" in patch)) return null;
      const meno = crew.find((c) => c.id === cid)?.name || "Štáb";
      return `${meno} sám: ${skDate(iso)} — ${patch.off ? "nemôže" : "zrušil „nemôžem“"}`;
    },
    [accessFor, crew]
  );

  /* Nadčas sa v editore prepína po pol hodine, takže by pri každom kliknutí
     pribudol jeden riadok Histórie. Preto si pri otvorení vlastnej bunky
     zapamätáme, koľko tam nadčasu bolo, a zapíšeme až výsledok — vtedy, keď
     človek editor zavrie. */
  const nadcasPriOtvoreniRef = useRef(null);
  useEffect(() => {
    const predch = nadcasPriOtvoreniRef.current;
    if (predch && (!sel || sel.iso !== predch.iso || sel.crewId !== predch.crewId)) {
      const teraz = hodinyNadcasu(cellOf(predch.iso, predch.crewId));
      if (teraz !== predch.hodiny) {
        addLog(`${predch.meno} sám: ${skDate(predch.iso)} — ${teraz ? `nahlásený nadčas ${hod(teraz)}` : "nadčas zrušený"}`);
      }
      nadcasPriOtvoreniRef.current = null;
    }
    if (sel && !nadcasPriOtvoreniRef.current && accessFor(sel.crewId) === "off") {
      nadcasPriOtvoreniRef.current = {
        iso: sel.iso,
        crewId: sel.crewId,
        meno: crew.find((c) => c.id === sel.crewId)?.name || "Štáb",
        hodiny: hodinyNadcasu(cellOf(sel.iso, sel.crewId)),
      };
    }
    // schválne iba [sel] — efekt nás zaujíma pri otvorení a zatvorení editora,
    // nie pri každom preklikaní hodín vnútri neho
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  /* Ľudia, ktorých rozpis smie prihlásený meniť celý — import tabuľky sa drží
     v týchto medziach rovnako ako klikanie do tabuľky. */
  const plnyPristupIds = useMemo(
    () => crew.filter((c) => cellAccess(me, c) === "full").map((c) => c.id),
    [me, crew]
  );

  /* Zápis celej importovanej tabuľky naraz: jedna zmena v histórii, jeden krok
     späť a jeden zápis na server — nie stovky malých. */
  const zapisTabulku = useCallback(
    (zmeny, info) => {
      if (!zmeny.length) return;
      const kde = [info?.subor, info?.harok].filter(Boolean).join(" / ");
      const detail = [
        `${info?.nove || 0} vyplnených`,
        info?.prepisane ? `${info.prepisane} prepísaných` : null,
      ].filter(Boolean).join(", ");
      commitCells(
        (prev) => pouziNavrh(prev, zmeny),
        `Import tabuľky${kde ? ` (${kde})` : ""}: ${zmeny.length} buniek — ${detail}`
      );
    },
    [commitCells]
  );

  const handleCellClick = (pos, event) => {
    if (!bulkMode) {
      if (accessFor(pos.crewId) === "none") {
        setStatus("Túto časť rozpisu upravuje niekto iný — ty ju vidíš len na čítanie.");
        return;
      }
      setSel(pos);
      return;
    }
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

      /* Escape zatvára to, čo je práve navrchu — najprv editor bunky, potom detail
         dňa, potom rozbalené menu a nakoniec otvorený panel. Bez toho sa dalo
         zavrieť iba myšou (klik do tmavého okolia alebo na „Zavrieť“), čo je na
         počítači zbytočné otravné. Kým človek píše do políčka, Escape sa sem
         nedostane (viď isTypingTarget vyššie) — nech sa nestratí rozpísaná
         poznámka. */
      if (e.key === "Escape") {
        if (sel) { setSel(null); return; }
        if (dayDetailIso) { setDayDetailIso(null); return; }
        if (menu) { setMenu(null); return; }
        if (panel) { setPanel(null); return; }
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
  }, [bulkMode, canEdit, selectedKeys, filteredDays, filteredCrew, applyBulk, undoCells, redoCells, sel, dayDetailIso, menu, panel]);

  const resolveConflict = async () => {
    await load();
  };

  /* --- zmeny, ktoré sa minule nepodarilo uložiť (slabý signál) --- */

  /* Ponúknu sa až po načítaní zo servera — až vtedy je s čím ich porovnať.
     Neobnovujú sa samy: rozpis medzitým mohol meniť niekto iný a ticho ho
     prepísať starou kópiou z vrecka je presne to, čo tu nesmie nastať. */
  useEffect(() => {
    if (!loaded || !me || dirty) return;
    const v = nacitajNeulozene(me.email);
    if (v) setOdlozene(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, me]);

  const odlozenychZmien = useMemo(
    () => (odlozene ? zmeneneKluce(odlozene.zaklad?.cells, odlozene.stav?.cells).length : 0),
    [odlozene]
  );

  const obnovOdlozene = useCallback(() => {
    if (!odlozene) return;
    const teraz = { crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log };
    /* Skladá sa tým istým pravidlom ako pri strete dvoch ľudí naraz: dopíšu sa
       iba moje bunky, cudzie ostanú tak, ako sú. Ak sa to prekrýva, radšej nič. */
    const zlucene = skusZlucit(odlozene.zaklad, odlozene.stav, teraz);
    if (!zlucene) {
      setStatus("Odložené zmeny sa už vrátiť nedajú — rozpis sa medzitým zmenil. Nastav ich, prosím, znova.");
      return;
    }
    setCells(zlucene.cells);
    setLog(zlucene.log);
    setDirty(true);
    setOdlozene(null);
    setStatus("Odložené zmeny vrátené — ukladám.");
  }, [odlozene, crew, cells, nad, sadzby, chaty, reporty, dispo, pendingDispo, pendingHook, log]);

  const zahodOdlozene = useCallback(() => {
    zahodNeulozene();
    setOdlozene(null);
    setStatus("Odložené zmeny zahodené.");
  }, []);

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

  /* --- kým nevieme, kto je prihlásený, appku nezobrazujeme (rozpis nemá vidieť nikto cudzí) --- */
  if (me === undefined) {
    return (
      <div className="min-h-screen bg-f-bg text-f-faint font-sans flex items-center justify-center text-sm">
        Overujem prihlásenie…
      </div>
    );
  }
  if (me === null) return <LoginScreen initialError={authError} />;

  return (
    <div className="min-h-screen bg-f-bg text-f-text font-sans">
      {/* Hlavička musí byť nad prilepenou hlavičkou tabuľky (tá má z-40), inak
          tabuľka prekryje rozbalené menu — najmä prvé položky. */}
      <header className="sticky top-0 z-50 bg-f-bg border-b-[3px] border-f-accent px-3.5 py-2.5 no-print">
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

            {/* Hromadný výber — iba pre vedúcich a admina (kto smie prepisovať celé stĺpce) */}
            {canEditAll && (
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
                <button onClick={() => togglePanel("vykazy")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Výkazy</button>
                <button onClick={() => togglePanel("sadzby")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Sadzby</button>
                <button onClick={() => togglePanel("reporty")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                  Denné reporty
                  {caps.pending && reportovNaPotvrdenie > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-accent text-f-ink text-[9px] font-bold flex items-center justify-center">{reportovNaPotvrdenie}</span>}
                </button>
                <button onClick={() => togglePanel("dispo")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                  Dispo
                  {caps.pending && dispoNaPotvrdenie > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-accent text-f-ink text-[9px] font-bold flex items-center justify-center">{dispoNaPotvrdenie}</span>}
                </button>
                <button onClick={() => togglePanel("log")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">História</button>
                <button onClick={() => togglePanel("admin")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Môj účet</button>
                {caps.users && (
                  <button onClick={() => togglePanel("users")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Prístupy</button>
                )}
                {canEditAll && (
                  <>
                    <div className="border-t border-f-hair my-1" />
                    <div className="flex gap-1 px-2.5 py-1">
                      <button onClick={() => { undoCells(); setMenu(null); }} disabled={!canUndo} title="Späť (Ctrl/Cmd+Z)" className="flex-1 px-2 py-1 rounded-md text-sm bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30">↶ Späť</button>
                      <button onClick={() => { redoCells(); setMenu(null); }} disabled={!canRedo} title="Znova (Ctrl/Cmd+Shift+Z)" className="flex-1 px-2 py-1 rounded-md text-sm bg-f-panel2 text-f-text hover:bg-f-border disabled:opacity-30">↷ Znova</button>
                    </div>
                    <div className="border-t border-f-hair my-1" />
                    {caps.pending && <button onClick={() => togglePanel("import")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Import z chatu</button>}
                    {caps.pending && <button onClick={() => togglePanel("tabulka")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Import tabuľky (XLSX)</button>}
                    {caps.crew && <button onClick={() => togglePanel("crew")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2">Štáb</button>}
                    {caps.pending && (
                      <button onClick={() => togglePanel("hook")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                        WhatsApp fronta
                        {pendingHook.length > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-ink text-[9px] font-bold flex items-center justify-center">{pendingHook.length}</span>}
                      </button>
                    )}
                    {caps.pending && (
                      <button onClick={() => togglePanel("chaty")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-f-text hover:bg-f-panel2 flex items-center gap-1.5">
                        WhatsApp chaty
                        {novychChatov > 0 && <span className="ml-auto min-w-[16px] h-[16px] px-1 rounded-full bg-f-r text-f-ink text-[9px] font-bold flex items-center justify-center">{novychChatov}</span>}
                      </button>
                    )}
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
        {odlozene && odlozenychZmien > 0 && (
          /* Rovnaké rozloženie ako pri strete verzií — text zvlášť, tlačidlá zvlášť,
             nech sa to na mobilnom Safari neprelomí cez seba. */
          <div className="mt-2 p-2 rounded-lg bg-f-accent/10 border border-f-accent/50 text-xs text-f-text">
            <div>
              Máš {odlozenychZmien}× neuloženú zmenu z{" "}
              {new Date(odlozene.ked).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" "}— vtedy nebol signál.
            </div>
            <div className="mt-1.5 flex gap-2">
              <button onClick={obnovOdlozene} className="px-2 py-0.5 rounded-lg bg-f-accent text-f-ink font-bold">
                Obnoviť zmeny
              </button>
              <button onClick={zahodOdlozene} className="px-2 py-0.5 rounded-lg bg-f-panel3 text-f-muted">
                Zahodiť
              </button>
            </div>
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

      {panel === "admin" && <AdminPanel me={me} onLogout={handleLogout} onClose={() => setPanel(null)} />}
      {panel === "users" && caps.users && <UsersPanel crew={crew} onClose={() => setPanel(null)} />}
      {panel === "crew" && caps.crew && <CrewPanel crew={crew} setCrew={wrappedSetCrew} moveCrew={moveCrew} onClose={() => setPanel(null)} />}
      {panel === "vykazy" && (
        <VykazyPanel
          crew={crew}
          dni={vykazDni}
          cellOf={cellOf}
          sadzby={sadzby}
          me={me}
          canSeeAll={!!caps.vykazVsetkych}
          mesiacIdx={vykazMesiac}
          mesiace={monthsInRange}
          onSetMesiac={setVykazMesiac}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "sadzby" && (
        <SadzbyPanel sadzby={sadzby} canEdit={!!caps.sadzby} onSetSadzba={setSadzba} onClose={() => setPanel(null)} />
      )}
      {panel === "log" && <LogPanel log={log} onClose={() => setPanel(null)} />}
      {panel === "nad" && <NadPanel nad={nad} canEdit={caps.nad} onSetNad={setNad} onClose={() => setPanel(null)} />}
      {panel === "reporty" && (
        <ReportyPanel
          reporty={reporty}
          canEdit={!!caps.pending}
          onSetDatum={setReportDatum}
          onPotvrdDen={potvrdReportDen}
          onZmazat={zmazReport}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "dispo" && (
        <DispoPanel
          pendingDispo={pendingDispo}
          dispo={dispo}
          crew={crew}
          canEdit={!!caps.pending}
          onPotvrd={potvrdDispo}
          onZahod={zahodDispo}
          onZrusPotvrdene={zrusPotvrdeneDispo}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "chaty" && caps.pending && (
        <ChatyPanel chaty={chaty} canEdit={!!caps.pending} onSetChat={setChat} onReload={load} onClose={() => setPanel(null)} />
      )}
      {panel === "hook" && caps.pending && (
        <WhatsAppQueuePanel pendingHook={pendingHook} crew={crew} onResolve={resolveHook} onClose={() => setPanel(null)} />
      )}
      {panel === "import" && caps.pending && (
        <ImportPanel crew={crew} setCrew={wrappedSetCrew} setCell={setCell} addLog={addLog} onClose={() => setPanel(null)} setStatus={setStatus} />
      )}
      {panel === "tabulka" && caps.pending && (
        <TabulkaPanel crew={crew} cells={cells} dovolene={plnyPristupIds} onZapis={zapisTabulku} onClose={() => setPanel(null)} setStatus={setStatus} />
      )}

      {bulkMode && canEditAll && (
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
      <div style={{ paddingBottom: bulkMode ? 250 : sel && canEditCells ? 190 : 0 }}>
        <ScheduleTable
          days={filteredDays}
          crew={filteredCrew}
          cells={cells}
          cellOf={cellOf}
          canEdit={canEditCells}
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
          reporty={reporty}
          dispo={dispo}
          onClose={() => setDayDetailIso(null)}
        />
      )}

      {sel && canEditCells && !bulkMode && accessFor(sel.crewId) !== "none" && (
        <CellEditor
          sel={sel}
          crew={crew}
          cell={cellOf(sel.iso, sel.crewId)}
          skDate={skDate}
          access={accessFor(sel.crewId)}
          sadzba={sadzbaProfesie(sadzby, crew.find((c) => c.id === sel.crewId)?.role || "kamera")}
          onSet={(patch) => setCell(sel.iso, sel.crewId, patch, popisVlastnejZmeny(sel.iso, sel.crewId, patch))}
          onSwap={(otherId) => { swap(sel.iso, sel.crewId, otherId); setSel(null); }}
          onClose={() => setSel(null)}
        />
      )}

      {bulkMode && canEditAll && (
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
