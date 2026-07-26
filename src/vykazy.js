/* ---------- Fáza 2: sadzby a výpočet odmien ----------
   Celý výpočet peňazí je na jednom mieste, aby sa dal otestovať a aby sa nikde
   inde v appke nepočítalo "od oka". Ráta sa v centoch (celé čísla), nie v
   eurách s desatinnou čiarkou — inak by sa pri sčítaní stovák dní nazbierala
   chyba a výkaz by nesedel o pár centov.                                     */

/** Predvolené denné sadzby v eurách. Admin a hlavný produkčný ich vedia zmeniť v appke. */
export const DEFAULT_SADZBY = {
  // Kamera: smena A/B/C/R = 200 €, samotný Duel = 200 €, smena aj Duel v ten istý deň = 230 €.
  kamera: { den: 200, duel: 200, denDuel: 230, nadcasPct: 10 },
  // Réžia a loggeri Duel nerobia — ich denná sadzba je jedno číslo.
  // Čísla sú len východiskové, treba ich v appke prepísať na skutočné.
  rezia: { den: 200, duel: 200, denDuel: 200, nadcasPct: 10 },
  logger: { den: 200, duel: 200, denDuel: 200, nadcasPct: 10 },
};

/** Najviac hodín nadčasu, ktoré má zmysel k jednému dňu nahlásiť. */
export const MAX_NADCAS_HODIN = 16;

/** Eurá -> centy. Znesie aj text z inputu vrátane desatinnej čiarky. */
export function naCenty(eur) {
  const n = typeof eur === "string" ? Number(eur.replace(",", ".").replace(/\s/g, "")) : Number(eur);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Sadzby pre danú profesiu — nastavené v appke, doplnené o predvolené hodnoty. */
export function sadzbaProfesie(sadzby, profesia) {
  const zaklad = DEFAULT_SADZBY[profesia] || DEFAULT_SADZBY.kamera;
  return { ...zaklad, ...((sadzby || {})[profesia] || {}) };
}

/** Koľko hodín nadčasu si človek k dňu nahlásil (0, ak nič alebo nezmysel). */
export function hodinyNadcasu(cell) {
  const h = typeof cell?.nadcas === "string" ? Number(cell.nadcas.replace(",", ".")) : Number(cell?.nadcas);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(h, MAX_NADCAS_HODIN);
}

/**
 * Základná odmena za jeden deň, v centoch.
 * Deň označený "nemôžem" je vždy 0, aj keby v ňom omylom zostala smena.
 */
export function zakladDnaC(cell, s) {
  if (!cell || cell.off) return 0;
  const smena = !!cell.shift;
  const duel = !!cell.duel;
  if (smena && duel) return naCenty(s.denDuel);
  if (duel) return naCenty(s.duel);
  if (smena) return naCenty(s.den);
  return 0;
}

/**
 * Nadčas za jeden deň, v centoch.
 * Hodina nadčasu = nadcasPct % z toho, čo si v ten deň zarobil.
 * Bežný deň 200 € -> 20 €/h, deň so smenou aj Duelom 230 € -> 23 €/h.
 * V deň bez odpracovanej smeny sa nadčas neráta — nie je z čoho.
 */
export function nadcasDnaC(cell, s) {
  const zaklad = zakladDnaC(cell, s);
  const hodiny = hodinyNadcasu(cell);
  if (!zaklad || !hodiny) return 0;
  const pct = Number(s.nadcasPct);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round((zaklad * pct * hodiny) / 100);
}

/** Hodinová sadzba nadčasu pre daný deň, v centoch (len na zobrazenie). */
export function hodinovkaDnaC(cell, s) {
  const zaklad = zakladDnaC(cell, s);
  const pct = Number(s.nadcasPct);
  if (!zaklad || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round((zaklad * pct) / 100);
}

/** Slovný popis toho, za čo v ten deň peniaze sú. */
export function popisDna(cell) {
  if (!cell || cell.off) return "nemôže";
  const smena = !!cell.shift;
  const duel = !!cell.duel;
  if (smena && duel) return `smena ${cell.shift} + Duel`;
  if (duel) return "Duel";
  if (smena) return `smena ${cell.shift}`;
  return "";
}

/**
 * Výkaz jedného človeka za zadané dni.
 * dni = pole { iso, ... }, cellOf(iso, crewId) vracia bunku rozpisu.
 */
export function vykazOsoby({ osoba, dni, cellOf, sadzby }) {
  const s = sadzbaProfesie(sadzby, osoba.role || "kamera");
  const riadky = [];
  let zakladC = 0;
  let nadcasC = 0;
  let hodiny = 0;
  let pocetSmien = 0;
  let pocetDuelov = 0;
  let pocetKombi = 0;
  let pocetOff = 0;

  for (const d of dni) {
    const cell = cellOf(d.iso, osoba.id) || {};
    const zC = zakladDnaC(cell, s);
    const nC = nadcasDnaC(cell, s);
    const h = hodinyNadcasu(cell);

    if (cell.off) pocetOff += 1;
    else if (cell.shift && cell.duel) pocetKombi += 1;
    else if (cell.duel) pocetDuelov += 1;
    else if (cell.shift) pocetSmien += 1;

    zakladC += zC;
    nadcasC += nC;
    if (zC) hodiny += h;

    if (zC || nC || cell.off || h) {
      riadky.push({
        iso: d.iso,
        popis: popisDna(cell),
        hodiny: zC ? h : 0,
        // hodiny nahlásené v deň bez smeny — nezapočítajú sa, ale nech to človek vidí
        hodinyBezSmeny: zC ? 0 : h,
        zakladC: zC,
        nadcasC: nC,
        spoluC: zC + nC,
      });
    }
  }

  return {
    osoba,
    sadzba: s,
    riadky,
    pocetSmien,
    pocetDuelov,
    pocetKombi,
    pocetOff,
    pocetPlatenychDni: pocetSmien + pocetDuelov + pocetKombi,
    hodiny,
    zakladC,
    nadcasC,
    spoluC: zakladC + nadcasC,
  };
}

/** Výkazy za celý štáb (alebo jeho časť) + súčet. */
export function vykazStabu({ crew, dni, cellOf, sadzby }) {
  const polozky = crew.map((osoba) => vykazOsoby({ osoba, dni, cellOf, sadzby }));
  const spolu = polozky.reduce(
    (a, v) => ({
      zakladC: a.zakladC + v.zakladC,
      nadcasC: a.nadcasC + v.nadcasC,
      spoluC: a.spoluC + v.spoluC,
      hodiny: a.hodiny + v.hodiny,
      pocetPlatenychDni: a.pocetPlatenychDni + v.pocetPlatenychDni,
    }),
    { zakladC: 0, nadcasC: 0, spoluC: 0, hodiny: 0, pocetPlatenychDni: 0 },
  );
  return { polozky, spolu };
}

/** Centy -> "1 230,00 €" po slovensky. */
export function eur(centy) {
  const n = (Number(centy) || 0) / 100;
  return n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Centy -> "1230.00" (do tabuliek, kde má byť číslo a nie text). */
export function eurCislo(centy) {
  return Math.round(Number(centy) || 0) / 100;
}

/** Hodiny -> "6,5 h" (alebo prázdno pri nule). */
export function hod(h) {
  const n = Number(h) || 0;
  if (!n) return "";
  return n.toLocaleString("sk-SK", { maximumFractionDigits: 2 }) + " h";
}
