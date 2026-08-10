/* ---------- konštanty produkcie ---------- */
export const START = "2026-07-30";
export const END = "2026-10-17";
export const CYCLE_START = "2026-08-05";
export const CYCLE_LEN = 5;
export const REHEARSALS = ["2026-07-30", "2026-07-31", "2026-08-01"];
// Bežné smeny (výber je exkluzívny — jedna zo štyroch).
// "Duel" je samostatný nezávislý príznak na bunke (cell.duel), dá sa kombinovať
// s ktoroukoľvek smenou aj bez nej — typicky sa používa v piaty deň cyklu.
// Duel je obmedzený iba na rolu "kamera" (viď CellEditor/BulkActionBar).
export const DAY_SHIFTS = ["A", "B", "C", "R"];

export const DEFAULT_NAMES = [
  "Daniel Lörincz", "Denis Hazlinger", "Ondrej Zlatohlávek", "Ondrej Šedivý",
  "Martin Kavoň", "Peter Szoke", "Peter Onduš", "Vladimír Breburda",
  "Martin", "Jakub Balko", "Radoslav Hajnoš",
];

// Sekcie štábu (sekcia 2 briefu) — päť sekcií, každá so svojimi ľuďmi a smenami,
// tabuľka sa iba filtruje podľa aktívnej záložky. "story" (Story produceri) je
// vlastná sekcia s vlastnými ľuďmi — nie to isté ako denná rola "Story producer
// dňa" (tá je v denneRoly, viď worker/src/index.js a DenneRolyPanel.jsx). Admin
// réžie spravuje réžiu, Story aj loggerov naraz (viď ROLE_SECTIONS v auth.js).
export const ROLES = [
  { key: "kamera", label: "Kamery" },
  { key: "rezia", label: "Réžia" },
  { key: "story", label: "Story produceri" },
  { key: "logger", label: "Loggeri" },
  { key: "produkcia", label: "Produkcia" },
];
export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export const SK_DAYS = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
export const SK_DAYS_FULL = ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"];
export const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

/* Ako často si appka sama vypýta zo servera čerstvý rozpis.

   Boli to 2 minúty, čo pri každom otvorenom klientovi znamenalo ~2160 čítaní
   z Cloudflare KV denne — a KV má denný strop 100 000 čítaní pre celú appku.
   Pätnásť minút je pre rozpis, ktorý sa mení párkrát za deň, dosť; kto chce
   vidieť zmenu hneď, klikne na "Obnoviť". Navyše sa neobnovuje vôbec, kým je
   karta v pozadí (viď App.jsx) — obnoví sa hneď po návrate k nej. */
export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/* Po návrate ku karte sa obnovuje len vtedy, keď sa dlhšie neobnovovalo —
   nech preklikávanie medzi kartami nerobí zo servera bubon. */
export const REFRESH_PO_NAVRATE_MS = 60 * 1000;

export const ADMIN_STORAGE_KEY = "rozpis_admin_pw";

// Téma appky: "light" | "dark" | "system" (predvolené). Ukladá sa lokálne v prehliadači.
export const THEME_STORAGE_KEY = "rozpis_theme";

// Časy NAD (ateliéry, odkiaľ vozia štáb na plac) sú univerzálne pre celú produkciu —
// viažu sa na smenu, nie na konkrétny dátum. Admin ich vyplní raz, mení len výnimočne.
export const NAD_SHIFTS = [
  { key: "A", label: "A" },
  { key: "B", label: "B" },
  { key: "C", label: "C" },
  { key: "R", label: "R" },
  { key: "duel", label: "Duel" },
];
