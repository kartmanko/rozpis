import { START, END, CYCLE_START, CYCLE_LEN, SK_DAYS } from "./constants";

/* ---------- dátumy ---------- */
export const DAY = 86400000;
export const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function buildDays() {
  const out = [];
  for (let t = toUTC(START); t <= toUTC(END); t += DAY) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    out.push({
      iso: isoOf(t),
      day: d.getUTCDate(),
      month: d.getUTCMonth(),
      dow: SK_DAYS[dow],
      weekend: dow === 0 || dow === 6,
    });
  }
  return out;
}

export function cycleInfo(iso) {
  const diff = (toUTC(iso) - toUTC(CYCLE_START)) / DAY;
  if (diff < 0) return { n: null, pos: null, fifth: false };
  return { n: Math.floor(diff / CYCLE_LEN) + 1, pos: (diff % CYCLE_LEN) + 1, fifth: diff % CYCLE_LEN === CYCLE_LEN - 1 };
}

export const skDate = (iso) => {
  const d = new Date(toUTC(iso));
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
};

// Dnešný dátum vo formáte YYYY-MM-DD (lokálny čas prehliadača, nie UTC — nech "dnes"
// sedí s tým, čo človek vidí na svojom telefóne).
export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Priezvisko (posledné slovo mena) — pre skrátené hlavičky stĺpcov v tabuľke.
// Ak je meno jednoslovné (napr. "Martin"), vráti ho celé.
export function surname(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || name || "";
}
