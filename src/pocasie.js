/* ---------- Fáza (sekcia 7 briefu): počasie pre Doľany ----------
   Číselné kódy počasia posiela server presne tak, ako ich vracia Open-Meteo
   (WMO weather codes) — appka ich tu iba prekladá na ikonu a slovenský text.
   Rovnaký dôvod ako pri vykazy.js: preklad na jednom mieste, nech sa netreba
   spoliehať, že si ho každá obrazovka vymyslí po svojom. */
const POPIS_KODU = {
  0: { text: "Jasno", ikona: "☀️" },
  1: { text: "Prevažne jasno", ikona: "🌤️" },
  2: { text: "Čiastočne oblačno", ikona: "⛅" },
  3: { text: "Zamračené", ikona: "☁️" },
  45: { text: "Hmla", ikona: "🌫️" },
  48: { text: "Mrznúca hmla", ikona: "🌫️" },
  51: { text: "Slabé mrholenie", ikona: "🌦️" },
  53: { text: "Mrholenie", ikona: "🌦️" },
  55: { text: "Husté mrholenie", ikona: "🌦️" },
  56: { text: "Mrznúce mrholenie", ikona: "🌧️" },
  57: { text: "Husté mrznúce mrholenie", ikona: "🌧️" },
  61: { text: "Slabý dážď", ikona: "🌧️" },
  63: { text: "Dážď", ikona: "🌧️" },
  65: { text: "Silný dážď", ikona: "🌧️" },
  66: { text: "Mrznúci dážď", ikona: "🌧️" },
  67: { text: "Silný mrznúci dážď", ikona: "🌧️" },
  71: { text: "Slabé sneženie", ikona: "🌨️" },
  73: { text: "Sneženie", ikona: "🌨️" },
  75: { text: "Silné sneženie", ikona: "🌨️" },
  77: { text: "Snehové zrnká", ikona: "🌨️" },
  80: { text: "Prehánky", ikona: "🌦️" },
  81: { text: "Prehánky", ikona: "🌦️" },
  82: { text: "Silné prehánky", ikona: "🌦️" },
  85: { text: "Snehové prehánky", ikona: "🌨️" },
  86: { text: "Silné snehové prehánky", ikona: "🌨️" },
  95: { text: "Búrka", ikona: "⛈️" },
  96: { text: "Búrka s krupobitím", ikona: "⛈️" },
  99: { text: "Silná búrka s krupobitím", ikona: "⛈️" },
};

/** Ikona + slovenský text pre WMO kód počasia. Neznámy/chýbajúci kód sa
    zobrazí neutrálne (appka sa naň nesmie zaseknúť ani vypísať "undefined"). */
export function popisPocasia(kod) {
  return POPIS_KODU[kod] || { text: "Počasie neznáme", ikona: "🌡️" };
}

/** "2026-08-17T05:52" -> "05:52". Chýbajúci/neplatný čas sa vráti ako "—". */
export function casNaHHMM(isoCas) {
  const m = String(isoCas || "").match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "—";
}

/** Krátky slovenský deň v týždni pre dátum "YYYY-MM-DD" (pre 7-dňový panel). */
export function skDenSkratka(datum) {
  const DNI = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
  const [y, m, d] = String(datum || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return DNI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
