/* Neuložené zmeny — poistka pre miesta bez signálu.

   Na farme signál nie je všade. Príde chvíľa, keď niekto klikne „v tento deň
   nemôžem“, odpoveď zo servera nepríde, on strčí telefón do vrecka a appku
   zavrie. Bez tejto poistky by tá zmena zmizla a nikto by sa o nej nedozvedel
   — ani on, ani admin.

   Preto si appka pri každom neúspešnom uložení odloží stav do prehliadača.
   Keď sa appka otvorí znova, nájde ho tam a ponúkne ho obnoviť. Schválne iba
   ponúkne: medzitým mohol rozpis meniť niekto iný a ticho prepísať cudziu
   prácu starou kópiou je presne to, čo tu nechceme.

   Ten istý človek môže mať appku otvorenú vo viacerých kartách naraz (napr.
   admin s dvomi oknami). Keby sa všetko ukladalo pod jeden spoločný kľúč,
   druhá karta by pri svojom vlastnom neúspešnom uložení ticho prepísala
   odloženú zmenu tej prvej — a keby sa prvá karta medzitým zavrela, tá zmena
   by zmizla úplne, bez akejkoľvek ponuky na obnovenie. Preto sa odkladá pod
   kľúčom vlastnej karty (sessionStorage nie je medzi kartami zdieľaný, takže
   každá karta má svoje vlastné id aj po reloade tej istej karty) a viaceré
   karty tak žijú v tom istom úložisku vedľa seba, nič si navzájom neprepíšu. */

/* v2 — pôvodné v1 bolo jeden plochý objekt (kto/ked/zaklad/stav) priamo pod
   týmto kľúčom, teraz je to mapa "id karty" → záznam (viď komentár vyššie).
   Nový kľúč, nech sa stará v1 hodnota (ak v niekoho prehliadači ešte je)
   jednoducho ignoruje namiesto toho, aby sa naparsovala ako mapa a jej polia
   (kto/ked/...) sa omylom brali za id kariet. */
const KLUC = "rozpis_neulozene_v2";
const KLUC_KARTY = "rozpis_karta_id_v1";

/* Odložené sú aj bunky aj história, čo je pri plnej sezóne rádovo stovky
   kilobajtov — localStorage má okolo 5 MB, takže je to bezpečné. Strop je tu
   len preto, aby sa appka nezasekla, keby dáta niekedy nečakane narástli. */
const MAX_ZNAKOV = 2_000_000;

function idKarty() {
  try {
    let id = sessionStorage.getItem(KLUC_KARTY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(KLUC_KARTY, id);
    }
    return id;
  } catch {
    return "bez-karty";
  }
}

function nacitajVsetky() {
  try {
    const raw = localStorage.getItem(KLUC);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function zapisVsetky(vsetky) {
  try {
    if (Object.keys(vsetky).length) localStorage.setItem(KLUC, JSON.stringify(vsetky));
    else localStorage.removeItem(KLUC);
  } catch {
    /* Plné úložisko alebo súkromné okno — poistka jednoducho nebude, appka
       kvôli tomu padnúť nesmie. */
  }
}

/** Odloží stav, ktorý sa nepodarilo uložiť na server (pod kľúčom vlastnej karty). */
export function ulozNeulozene(kto, zaklad, stav) {
  try {
    const vsetky = nacitajVsetky();
    vsetky[idKarty()] = { kto: kto || "", ked: new Date().toISOString(), zaklad, stav };
    const zapis = JSON.stringify(vsetky);
    if (zapis.length > MAX_ZNAKOV) return;
    localStorage.setItem(KLUC, zapis);
  } catch {
    /* Plné úložisko alebo súkromné okno — poistka jednoducho nebude, appka
       kvôli tomu padnúť nesmie. */
  }
}

/**
 * Vytiahne najnovší odložený stav, ak nejaký je a patrí tomuto človeku (naprieč
 * všetkými jeho otvorenými kartami).
 *
 * Cudzí sa ponúknuť nesmie — ale "cudzí" sa čistí opatrne, iba pre VLASTNÚ
 * kartu: ak práve TÁTO karta má vo svojom zázname iného človeka (typicky iné
 * prihlásenie na tom istom telefóne v tej istej karte), ten starý záznam sa
 * zahodí. Záznamy INÝCH kariet sa nedotknú — mohli by patriť inému človeku,
 * ktorý má v tej karte právoplatne otvorenú svoju appku práve teraz; to, že
 * moje prihlásenie je iné, o jeho zázname nič nehovorí.
 */
export function nacitajNeulozene(kto) {
  try {
    const vsetky = nacitajVsetky();
    const mojaKarta = idKarty();
    if (vsetky[mojaKarta] && (vsetky[mojaKarta].kto || "") !== (kto || "")) {
      delete vsetky[mojaKarta];
      zapisVsetky(vsetky);
    }
    const zaznamy = Object.values(vsetky).filter((z) => z?.stav && z?.zaklad && (z.kto || "") === (kto || ""));
    if (!zaznamy.length) return null;
    zaznamy.sort((a, b) => (b.ked || "").localeCompare(a.ked || ""));
    return zaznamy[0];
  } catch {
    return null;
  }
}

/** Zmaže odložený stav vlastnej karty (po úspešnom uložení alebo po zahodení ponuky). */
export function zahodNeulozene() {
  try {
    const vsetky = nacitajVsetky();
    delete vsetky[idKarty()];
    zapisVsetky(vsetky);
  } catch {
    /* ticho */
  }
}
