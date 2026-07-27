# Poznámky k prostrediu — čítaj PRV, než sa na čokoľvek spýtaš

Tento súbor je tu preto, aby sa používateľ nemusel opakovať. Keď sa chystáš
opýtať na hardvér, adresy, účty alebo na to, čo už kde beží — najprv sem pozri.
Keď ti povie niečo nové z tejto kategórie, **hneď to sem dopíš**.

## Naska

- **UGREEN NAS DXP4800 Plus**, systém **UGOS Pro**.
- Nie je to Synology ani QNAP. Balík sa nevolá Container Manager ani
  Container Station — v UGOS Pro je to appka **Docker**.
- Bežia na nej ďalšie appky, ktoré vznikli v iných sessionoch. Tento
  repozitár o nich nič nevie.

## Čo kde beží pre tento projekt

- **appka** — https://farma.kartmanko.cc (GitHub Pages, repo `kartmanko/rozpis`)
- **server** — https://api.kartmanko.cc (Cloudflare Worker `f18` + KV)
- **čítačka WhatsAppu** — má bežať dvakrát: hlavná na Fly.io, záloha na naske.

## Číslo, ktorým je čítačka prihlásená — DÔLEŽITÉ

Čítačka smie byť prihlásená **výhradne cez eSIM číslo `+421902512111`**
(`421902512111`), nikdy cez jeho osobné primárne číslo.

Dôvod: Baileys je neoficiálny klient a WhatsApp zaň dáva bany. Tá eSIM
existuje presne preto, aby prípadný ban zožralo obetované číslo a nie jeho
osobný účet. **Nikdy neodobri prihlásenie iným číslom, ani keď „to funguje".**
Keď sa v appke pri čítačke objaví iné číslo, je to chyba a treba to prehodiť
naspäť na eSIM.

Ako sa čítačka preloží na iné číslo: v telefóne odhlásiť zariadenie **Ubuntu**
(Prepojené zariadenia) a na naske zmeniť `AUTH_DIR` na nový priečinok
(napr. `/data/auth-esim`) → Stop → Start → naskenovať nové QR z appky.
Zväzok `f18-auth` sa mazať nemusí.

### Baileys: `creds.registered` klame pri QR

Baileys nastaví `creds.registered = true` iba pri párovaní **párovacím kódom**.
Pri **QR** ho nenastaví nikdy — po úspešnom prepojení tam ostane `false`. QR
zapisuje `creds.me.id`. Nikdy nepoužívaj `registered` ako dôkaz prihlásenia;
v `bridge/index.js` je na to `dokoncenePrihlasenie()` a test
`bridge/test-auth-stav.mjs`.

Keď v appke odídu **obe** čítačky naraz, nie je to WhatsApp — obe reštartuje
ten istý strážca, takže spoločná príčina býva v našom kóde. Najprv over, či sú
v telefóne (Prepojené zariadenia) ešte tie zariadenia „Ubuntu": keď tam sú,
WhatsApp nič nezrušil a chyba je naša.

## Ako sa s ním pracuje

- Odpovede krátke a vecné. Žiadne ospravedlňovanie.
- Nikdy ho neposielaj klikať do cudzích dashboardov, keď sa tomu dá vyhnúť.
- Cenu a závislosť na ďalšej platforme povedz **skôr**, než niečo navrhneš.
- Predtým, než mu niečo prikážeš spraviť, over si, či to už nespravil.
- Keď sa spýta „nevadí, že...?", **nepovedz „nevadí" skôr, než si prejdeš,
  prečo to tak pôvodne bolo**. Väčšinou sa pýta na vec, ktorú sme spolu
  zámerne navrhli tak, ako je — a on si na dôvod pamätá lepšie než ty.
- Celé UI aj komentáre v kóde po slovensky.

## Čo na naske nefunguje

- Docker v UGOS Pro **nespustí projekt s `build:`** — projekt sa vytvorí
  ("successfull deploy project"), ale hneď nato príde "Project launch failed".
  Preto `bridge/nas-compose.yml` používa hotový obraz `node:20-alpine` a
  zdrojáky si sťahuje pri štarte z GitHubu.
