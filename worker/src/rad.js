/* Zdieľaný rad na sériové vykonanie "prečítaj, over, zapíš" úsekov nad
   zdieľaným KV stavom.

   Cloudflare KV nemá compare-and-swap. Bez poistky by dva zápisy spracované
   TÝM ISTÝM izolátorom (bežné pri tomto rozsahu premávky — Cloudflare
   izolátor typicky ostáva "teplý" a strieda viacero požiadaviek za sebou)
   mohli obe prečítať tú istú hodnotu, obe ňou prejsť, a druhý zápis by ticho
   prepísal prvý — presne to "server to ticho prepísal", čomu sa má
   baseVersion/409 vyhýbať.

   Dôležité: tento rad musí byť SPOLOČNÝ pre všetky miesta, ktoré do toho
   istého KV kľúča zapisujú, nielen pre jeden endpoint. Napríklad users_v1
   zapisuje POST /data (keď sa zmenia kontakty — viď synchronizujPouzivatelovZ­
   Kontaktov v auth.js) AJ POST /auth/users (správa používateľov) — keby mal
   každý z nich VLASTNÝ, oddelený rad, navzájom by sa nechránili a mohli by sa
   ticho prepísať presne tak, ako keby žiadny rad nebol. Preto je `zaradDoRadu`
   tu, v spoločnom module, a index.js aj auth.js si ho oba importujú odtiaľto.

   Naprieč RÔZNYMI izolátormi (napr. dve rôzne edge lokality naraz) to garanciu
   nedáva — to by vyžadovalo Durable Object, čo je zmena mimo rozsahu tejto
   opravy; toto zachytí prevažnú väčšinu prípadov pri očakávanej premávke tejto
   appky (rádovo desiatky ľudí). */
let stavRad = Promise.resolve();

export function zaradDoRadu(uloha) {
  const tento = stavRad.then(uloha, uloha);
  stavRad = tento.then(
    () => {},
    () => {} // chyba jednej úlohy nesmie zablokovať rad pre ďalšie čakajúce
  );
  return tento;
}
