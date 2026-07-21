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

// Role štábu — jeden zdieľaný dátový model, tabuľka sa iba filtruje podľa aktívnej role.
export const ROLES = [
  { key: "kamera", label: "Kamery" },
  { key: "rezia", label: "Réžia" },
  { key: "logger", label: "Loggeri" },
];
export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export const SK_DAYS = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
export const SK_DAYS_FULL = ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"];
export const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

export const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minúty, viď brief
export const ADMIN_STORAGE_KEY = "rozpis_admin_pw";

// Časy NAD (ateliéry, odkiaľ vozia štáb na plac) sú univerzálne pre celú produkciu —
// viažu sa na smenu, nie na konkrétny dátum. Admin ich vyplní raz, mení len výnimočne.
export const NAD_SHIFTS = [
  { key: "A", label: "A" },
  { key: "B", label: "B" },
  { key: "C", label: "C" },
  { key: "R", label: "R" },
  { key: "duel", label: "Duel" },
];
