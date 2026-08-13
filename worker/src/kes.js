/* Krátkodobá pamäť na jednu jedinú požiadavku.

   Prečo to existuje: Cloudflare KV má denný strop na počet čítaní a appka ho
   míňala aj na to isté dvakrát v tom istom volaní. Napríklad `/bridge/ping`
   načítal celý rozpis dvakrát za sebou a zoznam ľudí (`users_v1`) sa čítal pri
   overení prihlásenia a hneď potom znova.

   Naprieč požiadavkami sa nekešuje NIČ. Každé nové volanie dostane prázdnu
   pamäť, takže sa nikomu nemôže ukázať zastaraný rozpis — to by bola presne tá
   „appka to prepísala ticho" chyba, ktorej sa v tomto projekte vyhýbame.

   Kešujeme zámerne surový text z KV, nie rozparsovaný objekt: keby dvaja
   volajúci dostali ten istý objekt a jeden ho zmenil, zmena by prebublala aj
   tomu druhému. Takto si každý parsuje svoje. */

/** Obalí `env` tak, aby mal vlastnú pamäť. Väzby (KV, tajomstvá) ostávajú. */
export function sKesou(env) {
  const obal = Object.create(env);
  obal.__kes = new Map();
  return obal;
}

/** Načíta kľúč najviac raz za požiadavku. `nacitaj` sa zavolá len prvýkrát. */
export function kesovane(env, kluc, nacitaj) {
  const kes = env && env.__kes;
  if (!kes) return nacitaj();
  if (!kes.has(kluc)) kes.set(kluc, nacitaj());
  return kes.get(kluc);
}

/** Po zápise do KV rovno prepíš aj pamäť, nech čítanie nižšie vidí novú hodnotu. */
export function prepisKes(env, kluc, hodnota) {
  const kes = env && env.__kes;
  if (kes) kes.set(kluc, Promise.resolve(hodnota));
}

/** Zabudni kľúč z pamäte tejto požiadavky, aby ďalšie `kesovane()` volanie
    naň išlo naozaj znova do KV — nie do vlastnej medzipamäte tejto istej
    požiadavky. Bez tohto by "čítanie tesne pred zápisom" (napr. v
    spracujDispoMail alebo handlePostHook, po dlhšom LLM volaní) v skutočnosti
    vrátilo ten istý (možno už zastaraný) stav ako úplne prvé čítanie na
    začiatku tej istej požiadavky — súbežný zápis niekoho iného z appky medzi
    tým by sa tak stále dal ticho prepísať, presne tomu sa mala táto poistka
    vyhnúť. */
export function zabudniKes(env, kluc) {
  const kes = env && env.__kes;
  if (kes) kes.delete(kluc);
}
