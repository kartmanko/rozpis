/* ---------- konštanty produkcie ---------- */
export const START = "2026-07-30";
export const END = "2026-10-17";
export const CYCLE_START = "2026-08-05";
export const CYCLE_LEN = 5;
export const REHEARSALS = ["2026-07-30", "2026-07-31", "2026-08-01"];
// Bežné smeny (výber je exkluzívny — jedna z troch).
// "Duel" je samostatný nezávislý príznak na bunke (cell.duel), dá sa kombinovať
// s ktoroukoľvek smenou aj bez nej — typicky sa používa v piaty deň cyklu.
export const DAY_SHIFTS = ["A", "B", "C"];

export const DEFAULT_NAMES = [
  "Daniel Lörincz", "Denis Hazlinger", "Ondrej Zlatohlávek", "Ondrej Šedivý",
  "Martin Kavoň", "Peter Szoke", "Peter Onduš", "Vladimír Breburda",
  "Martin", "Jakub Balko", "Radoslav Hajnoš",
];

export const SK_DAYS = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
export const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

export const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minúty, viď brief
export const ADMIN_STORAGE_KEY = "rozpis_admin_pw";
