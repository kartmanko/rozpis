/* Pomocné funkcie nad databázou kontaktov (sekcia 1 briefu).
   Používa ich KontaktyPanel priamo a neskôr ich prevezme aj builder dispozícií
   (napovedanie mien pri skladaní skupín, sekcia 2) a klik-na-zavolanie/mail
   v detaile dňa (sekcia 5) — preto sú tu ako samostatný modul, nie zašité v paneli. */

const DIAKRITIKA_RE = new RegExp("[̀-ͯ]", "g");

const bezDiakritiky = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(DIAKRITIKA_RE, "")
    .toLowerCase();

/**
 * Napovedanie pri písaní mena — hľadá v mene aj funkcii, iba medzi aktívnymi
 * kontaktmi. Bez opýtania sa vráti prázdne pole (nemá zmysel ponúkať 200 mien
 * naraz), preto treba aspoň jeden znak.
 */
export function hladajKontakty(kontakty, otazka, limit = 8) {
  const q = bezDiakritiky(otazka).trim();
  if (!q) return [];
  return (kontakty || [])
    .filter((k) => k.aktivny !== false)
    .filter((k) => bezDiakritiky(k.meno).includes(q) || bezDiakritiky(k.funkcia).includes(q))
    .slice(0, limit);
}

/** Kontakt patriaci k danému človeku zo štábu (podľa crewId), ak taký existuje. */
export function kontaktPreCrew(kontakty, crewId) {
  if (!crewId) return null;
  return (
    (kontakty || []).find(
      (k) => k.interny && String(k.crewId) === String(crewId) && k.aktivny !== false
    ) || null
  );
}

/** tel: odkaz — prázdny reťazec, keď telefón nie je vyplnený (aby sa dalo <a href> podmienene skryť). */
export function telOdkaz(telefon) {
  const cislo = String(telefon || "").replace(/[^\d+]/g, "");
  return cislo ? `tel:${cislo}` : "";
}

/** mailto: odkaz — rovnaká logika ako telOdkaz. */
export function mailOdkaz(mail) {
  const m = String(mail || "").trim();
  return m ? `mailto:${m}` : "";
}
