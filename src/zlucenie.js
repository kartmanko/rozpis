/* Zlúčenie po strete verzií.

   Server drží jedno spoločné číslo verzie pre celý rozpis. Keď dvaja ukladajú
   naraz, ten druhý dostane 409 — aj vtedy, keď každý klikol na úplne inú bunku.
   V produkcii je to bežná situácia: admin prideľuje smeny pri počítači a
   jedenásť ľudí má appku otvorenú na telefóne.

   Preto sa appka pri strete najprv pokúsi zmeny poskladať: vezme aktuálny stav
   zo servera a dopíše doň to, čo medzitým naklikal tento človek. Pravidlo je
   prísne — zlučuje sa iba vtedy, keď sa tí dvaja nedotkli tej istej bunky.
   Len čo sa prekrývajú, zlučovať sa neskúša a rozhodne človek; nič cudzie sa
   nikdy neprepíše potichu. */

const rovnake = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Kľúče buniek, ktoré sa medzi dvoma stavmi líšia (vrátane vymazaných). */
export function zmeneneKluce(zaklad = {}, novy = {}) {
  const kluce = new Set([...Object.keys(zaklad), ...Object.keys(novy)]);
  return [...kluce].filter((k) => !rovnake(zaklad[k], novy[k]));
}

/* Časti stavu, ktoré sa zlučovať neskúšajú. Sú to zoznamy a nastavenia, kde by
   „poskladanie“ znamenalo hádať, čo mal človek na mysli — pri nich radšej nech
   sa appka spýta. */
const NEZLUCUJE_SA = ["crew", "nad", "sadzby", "chaty", "reporty", "dispo", "pendingDispo", "kontakty", "uzavierky", "pendingHook", "denneRoly"];

/**
 * Skúsi poskladať môj stav a stav zo servera dokopy.
 *
 * @param zaklad Stav, z ktorého som vychádzal (posledné načítanie alebo uloženie).
 * @param moje   Stav, ktorý mám teraz v prehliadači.
 * @param server Aktuálny stav zo servera (prišiel v odpovedi 409).
 * @returns { cells, log } keď sa to dá poskladať, inak null (nech rozhodne človek).
 */
export function skusZlucit(zaklad, moje, server, logMax = 400) {
  if (!zaklad || !moje || !server) return null;

  // mimo buniek a histórie sa nič zlučovať nepokúšame
  for (const cast of NEZLUCUJE_SA) {
    if (!rovnake(moje[cast], zaklad[cast])) return null;
  }

  const mojeZmeny = zmeneneKluce(zaklad.cells, moje.cells);
  if (!mojeZmeny.length) return null; // nemám čo pridať — nech sa to jednoducho načíta znova

  const cudzieZmeny = new Set(zmeneneKluce(zaklad.cells, server.cells));
  if (mojeZmeny.some((k) => cudzieZmeny.has(k))) return null; // ozajstný stret o tú istú bunku

  const cells = { ...(server.cells || {}) };
  for (const k of mojeZmeny) {
    if (moje.cells[k] === undefined) delete cells[k];
    else cells[k] = moje.cells[k];
  }

  /* História rastie odpredu, takže moje nové riadky sú tie, čo pribudli navrch
     základu. Poskladaná história = moje nové riadky a za nimi celá serverová —
     server totiž povolí iba dopĺňanie, nič iné by neprešlo. */
  const zakladLog = zaklad.log || [];
  const mojLog = moje.log || [];
  const serverLog = server.log || [];
  const mojeNove = mojLog.length > zakladLog.length ? mojLog.slice(0, mojLog.length - zakladLog.length) : [];
  const log = [...mojeNove, ...serverLog].slice(0, logMax);

  return { cells, log };
}
