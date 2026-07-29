/* Neuložené zmeny — poistka pre miesta bez signálu.

   Na farme signál nie je všade. Príde chvíľa, keď niekto klikne „v tento deň
   nemôžem“, odpoveď zo servera nepríde, on strčí telefón do vrecka a appku
   zavrie. Bez tejto poistky by tá zmena zmizla a nikto by sa o nej nedozvedel
   — ani on, ani admin.

   Preto si appka pri každom neúspešnom uložení odloží stav do prehliadača.
   Keď sa appka otvorí znova, nájde ho tam a ponúkne ho obnoviť. Schválne iba
   ponúkne: medzitým mohol rozpis meniť niekto iný a ticho prepísať cudziu
   prácu starou kópiou je presne to, čo tu nechceme. */

const KLUC = "rozpis_neulozene_v1";

/* Odložené sú aj bunky aj história, čo je pri plnej sezóne rádovo stovky
   kilobajtov — localStorage má okolo 5 MB, takže je to bezpečné. Strop je tu
   len preto, aby sa appka nezasekla, keby dáta niekedy nečakane narástli. */
const MAX_ZNAKOV = 2_000_000;

/** Odloží stav, ktorý sa nepodarilo uložiť na server. */
export function ulozNeulozene(kto, zaklad, stav) {
  try {
    const zapis = JSON.stringify({ kto: kto || "", ked: new Date().toISOString(), zaklad, stav });
    if (zapis.length > MAX_ZNAKOV) return;
    localStorage.setItem(KLUC, zapis);
  } catch {
    /* Plné úložisko alebo súkromné okno — poistka jednoducho nebude, appka
       kvôli tomu padnúť nesmie. */
  }
}

/**
 * Vytiahne odložený stav, ak nejaký je a patrí tomuto človeku.
 * Cudzí (napr. po prihlásení iného člena štábu na tom istom telefóne) sa zahodí.
 */
export function nacitajNeulozene(kto) {
  try {
    const raw = localStorage.getItem(KLUC);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.stav || !v?.zaklad) return null;
    if ((v.kto || "") !== (kto || "")) {
      localStorage.removeItem(KLUC);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function zahodNeulozene() {
  try {
    localStorage.removeItem(KLUC);
  } catch {
    /* ticho */
  }
}
