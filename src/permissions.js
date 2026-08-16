/* ---------- role a práva (Fáza 1) ----------
   Toto je zrkadlo tabuľky práv zo servera (worker/src/auth.js). Tu slúži iba na to,
   aby appka skryla, čo človek nesmie robiť. Skutočnú kontrolu robí vždy server —
   klientovi sa nedá veriť. */

// Finálna mapa rolí (sekcia 4 briefu): hlavný admin + traja "menší admini" podľa
// sekcie (kamera / produkcia / réžia+Story+loggeri) + štáb + viewer. Predtým sa
// volali kamera_lead/rezia_lead/produkcny — premenované, práva ostávajú rovnaké.
export const USER_ROLES = [
  { key: "admin", label: "Hlavný admin", hint: "Všetko — rozpis, štáb, NAD časy, používatelia." },
  { key: "kamera_admin", label: "Admin kamery", hint: "Upravuje celý stĺpec kamier." },
  { key: "rezia_admin", label: "Admin réžie, Story a loggerov", hint: "Upravuje réžiu, loggerov, prideľuje denné role." },
  { key: "produkcia_admin", label: "Admin produkcie", hint: "Vidí celý rozpis, upravuje NAD časy, prideľuje denné role." },
  { key: "stab", label: "Štáb", hint: "Vo vlastnom stĺpci si označuje dni, keď nemôže." },
  { key: "viewer", label: "Viewer", hint: "Iba prezeranie, nič neupravuje." },
];

export const USER_ROLE_LABELS = Object.fromEntries(USER_ROLES.map((r) => [r.key, r.label]));

// Ktoré profesie smie rola prepisovať celé — päť sekcií štábu (sekcia 2 briefu),
// zrkadlí worker/src/auth.js.
const SECTIONS = {
  admin: ["kamera", "rezia", "story", "logger", "produkcia"],
  kamera_admin: ["kamera"],
  rezia_admin: ["rezia", "story", "logger"],
  produkcia_admin: ["produkcia"],
  stab: [],
  viewer: [],
};

// "sadzby" = meniť denné sadzby profesií (Fáza 2) — iba admin a admin produkcie.
// "vykazVsetkych" = vidieť výkazy celého štábu, nielen svoj vlastný.
// "reporty" = vidieť a spracovať denné reporty (sekcia 3 finálneho briefu) — iba
//             réžia/loggeri/Story (rezia_admin), nie kamera. "produkcia_admin" má
//             reporty ponechané z čias, keď zastupoval ešte neexistujúcu rolu
//             Story producer.
// "denneRoly" = prideľovať pre konkrétny deň hlavného režiséra a Story producerov
//               (nová "denná" rola, sekcia 4 briefu — priradenie na jeden deň,
//               nie trvalá rola v USER_ROLES).
// "hlasky" = písať hlášky z natáčania (sekcia 8 briefu) — zatiaľ iba admin, viď
//            rovnaký komentár pri ROLE_CAPS vo worker/src/auth.js.
const CAPS = {
  admin: { crew: true, nad: true, pending: true, ownOff: true, users: true, sadzby: true, vykazVsetkych: true, reporty: true, denneRoly: true, hlasky: true },
  kamera_admin: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true, reporty: false, denneRoly: false, hlasky: false },
  rezia_admin: { crew: false, nad: false, pending: true, ownOff: true, users: false, sadzby: false, vykazVsetkych: true, reporty: true, denneRoly: true, hlasky: false },
  produkcia_admin: { crew: false, nad: true, pending: false, ownOff: true, users: false, sadzby: true, vykazVsetkych: true, reporty: true, denneRoly: true, hlasky: false },
  stab: { crew: false, nad: false, pending: false, ownOff: true, users: false, sadzby: false, vykazVsetkych: false, reporty: false, denneRoly: false, hlasky: false },
  viewer: { crew: false, nad: false, pending: false, ownOff: false, users: false, sadzby: false, vykazVsetkych: false, reporty: false, denneRoly: false, hlasky: false },
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
