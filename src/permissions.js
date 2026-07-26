/* ---------- role a práva (Fáza 1) ----------
   Toto je zrkadlo tabuľky práv zo servera (worker/src/auth.js). Tu slúži iba na to,
   aby appka skryla, čo človek nesmie robiť. Skutočnú kontrolu robí vždy server —
   klientovi sa nedá veriť. */

export const USER_ROLES = [
  { key: "admin", label: "Hlavný admin", hint: "Všetko — rozpis, štáb, NAD časy, používatelia." },
  { key: "kamera_lead", label: "Vedúci kamery", hint: "Upravuje celý stĺpec kamier." },
  { key: "rezia_lead", label: "Vedúci réžie a loggerov", hint: "Upravuje réžiu a loggerov." },
  { key: "produkcny", label: "Hlavný produkčný", hint: "Vidí celý rozpis, upravuje NAD časy." },
  { key: "stab", label: "Štáb", hint: "Vo vlastnom stĺpci si označuje dni, keď nemôže." },
  { key: "viewer", label: "Viewer", hint: "Iba prezeranie, nič neupravuje." },
];

export const USER_ROLE_LABELS = Object.fromEntries(USER_ROLES.map((r) => [r.key, r.label]));

// Ktoré profesie smie rola prepisovať celé.
const SECTIONS = {
  admin: ["kamera", "rezia", "logger"],
  kamera_lead: ["kamera"],
  rezia_lead: ["rezia", "logger"],
  produkcny: [],
  stab: [],
  viewer: [],
};

// "sadzby" = meniť denné sadzby profesií (Fáza 2) — iba admin a hlavný produkčný.
// "vykazVsetkych" = vidieť výkazy celého štábu, nielen svoj vlastný.
const CAPS = {
  admin: { crew: true, nad: true, pending: true, ownOff: true, users: true, sadzby: true, vykazVsetkych: true },
  kamera_lead: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true },
  rezia_lead: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true },
  produkcny: { crew: false, nad: true, pending: false, ownOff: true, users: false, sadzby: true, vykazVsetkych: true },
  stab: { crew: false, nad: false, pending: false, ownOff: true, users: false, sadzby: false, vykazVsetkych: false },
  viewer: { crew: false, nad: false, pending: false, ownOff: false, users: false, sadzby: false, vykazVsetkych: false },
};

export const capsOf = (role) => CAPS[role] || CAPS.viewer;
export const sectionsOf = (role) => SECTIONS[role] || [];

/**
 * Čo smie prihlásený človek robiť s bunkou daného člena štábu:
 *   "full" = celá bunka (smeny, duel, poznámka, nedostupnosť)
 *   "off"  = iba prepínač "nemôžem"
 *   "none" = nič
 */
export function cellAccess(me, person) {
  if (!me || !person) return "none";
  if (me.role === "admin") return "full";
  if (sectionsOf(me.role).includes(person.role || "kamera")) return "full";
  if (capsOf(me.role).ownOff && me.crewId && String(person.id) === String(me.crewId)) return "off";
  return "none";
}

// Používateľ v demo režime (bez nastaveného servera) — appka sa dá vyskúšať naprázdno.
export const DEMO_USER = { id: "demo", email: "", name: "Demo", role: "admin", crewId: null, active: true, demo: true };
