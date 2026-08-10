/* Kontrola prístupov — čo je v zozname ľudí zle nastavené.

   Prístupy sa vypĺňajú ručne a jedna preklepnutá bunka sa nedá spoznať, kým
   sa človek neprihlási a nezistí, že si nemá čo kliknúť — alebo, horšie, že
   klikaním prepisuje kolegu. Preto sa zoznam prekontroluje a admin vidí
   zoznam problémov ešte predtým, než sa niekto začne prihlasovať.

   Nič sa tu neopravuje samo. Iba sa povie, čo nesedí. */

import { capsOf } from "./permissions";

/**
 * Prejde zoznam prístupov oproti štábu v rozpise.
 * @returns pole { druh: "chyba" | "pozor", text }
 */
export function kontrolaPristupov(users = [], crew = []) {
  const problemy = [];
  const aktivni = users.filter((u) => u.active !== false);
  const menoCloveka = (id) => crew.find((c) => String(c.id) === String(id))?.name || null;
  const popis = (u) => u.name || u.email || "bez mena";

  /* Bez admina by nemal kto potvrdzovať zmeny ani pridávať ďalších ľudí —
     a keďže prístupy mení iba admin, nedalo by sa to už ani napraviť. */
  if (!aktivni.some((u) => u.role === "admin")) {
    problemy.push({ druh: "chyba", text: "V zozname nie je ani jeden zapnutý hlavný admin — nemal by kto potvrdzovať zmeny." });
  }

  const podlaMailu = new Map();
  for (const u of users) {
    const mail = String(u.email || "").trim().toLowerCase();
    if (!mail) {
      problemy.push({ druh: "chyba", text: `${popis(u)} nemá e-mail — nemá sa mu kam poslať prihlasovací odkaz.` });
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      problemy.push({ druh: "chyba", text: `„${mail}“ nevyzerá ako e-mailová adresa — odkaz nedorazí.` });
    }
    podlaMailu.set(mail, (podlaMailu.get(mail) || 0) + 1);
  }
  for (const [mail, kolko] of podlaMailu) {
    if (kolko > 1) problemy.push({ druh: "chyba", text: `Adresa ${mail} je v zozname ${kolko}× — platiť bude len jeden z tých riadkov.` });
  }

  /* Kto si smie označovať vlastnú nedostupnosť, ale nie je priradený k nikomu
     v rozpise, sa síce prihlási, ale nebude si vedieť kliknúť vôbec nič. */
  const obsadene = new Map();
  for (const u of aktivni) {
    const smieVlastne = capsOf(u.role).ownOff;
    /* Vedúci ani produkčný nemusia byť v rozpise — majú čo robiť aj bez
       vlastného stĺpca. Chýbajúce priradenie im teda nevadí. */
    const vediePole = u.role === "admin" || u.role === "kamera_admin" || u.role === "rezia_admin" || u.role === "produkcia_admin";
    if (!u.crewId) {
      if (smieVlastne && !vediePole) {
        problemy.push({ druh: "chyba", text: `${popis(u)} nie je priradený k nikomu v rozpise — po prihlásení si nebude vedieť označiť nič.` });
      }
      continue;
    }
    const meno = menoCloveka(u.crewId);
    if (!meno) {
      problemy.push({ druh: "chyba", text: `${popis(u)} je priradený k človeku, ktorý už v rozpise nie je.` });
      continue;
    }
    obsadene.set(String(u.crewId), [...(obsadene.get(String(u.crewId)) || []), popis(u)]);
  }
  for (const [cid, kto] of obsadene) {
    if (kto.length > 1) {
      problemy.push({ druh: "chyba", text: `${menoCloveka(cid)} má priradené dva prístupy (${kto.join(", ")}) — prepisovali by si navzájom vlastnú nedostupnosť.` });
    }
  }

  /* Toto ešte nie je chyba — vedúci ani produkčný nemusia byť v rozpise —
     ale pred prvým dňom je dobré vidieť, kto sa ešte nemá ako prihlásiť. */
  const bezPristupu = crew.filter((c) => !aktivni.some((u) => String(u.crewId) === String(c.id)));
  if (bezPristupu.length) {
    problemy.push({
      druh: "pozor",
      text: `Bez vlastného prístupu: ${bezPristupu.map((c) => c.name).join(", ")} — nedostanú sa do appky a nenahlásia si, kedy nemôžu.`,
    });
  }

  return problemy;
}
