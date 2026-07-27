# FARMA 18 — rozpis štábu

Webová appka na plánovanie rozpisu štábu pre reláciu FARMA 18. Každý člen štábu
sa prihlási mailom (bez hesla), vidí svoj rozpis, zapisuje si nedostupnosť a
výkazy; vedúci a produkcia rozpis nastavujú a potvrdzujú zmeny.

Beží na:

- **appka** — https://farma.kartmanko.cc (statický build na GitHub Pages)
- **server** — https://api.kartmanko.cc (Cloudflare Worker `f18` + KV)

Repozitár má dve časti: `src/` je frontend (React + Vite), `worker/` je
Cloudflare Worker, ktorý drží všetky dáta v KV. Žiadne heslo ani kľúč nie je
v repozitári — všetko sú Cloudflare secrets.

---

## Základné pravidlá, podľa ktorých je to postavené

Sú dôležitejšie než ktorýkoľvek riadok kódu, tak nech sú hneď navrchu:

- Appka nikdy nebeží na NAS-e používateľa (výnimka: WhatsApp bridge, ktorý sa
  na NAS-e smie spustiť ako záložná inštancia).
- Appka nikdy nič neposiela do WhatsApp skupín — bridge iba číta.
- Zelená (smeny) sa nastavuje ručne. Z WhatsApp importu sa automaticky plní
  iba červená, teda nedostupnosť.
- Všetko, čo mení rozpis — dispozícia z mailu, návrhy z chatu — ide cez
  potvrdenie admina. Nič sa neprepisuje ticho.
- Celé UI aj komentáre v kóde sú po slovensky.

---

## Ako to funguje po fázach

**Prihlásenie a role.** Prihlasuje sa mailom: appka pošle odkaz (Resend),
kliknutím vznikne session cookie `f18_sess` na doméne `kartmanko.cc`. Rolí je
niekoľko (`admin`, `kamera_lead`, `rezia_lead`, `stab`, …) a k nim patria
oprávnenia v `src/permissions.js`. Server ich kontroluje sám: pri každom uložení
porovná starý a nový stav a zamietne zmenu, ktorú daná rola robiť nesmie
(`checkStateChange` v `worker/src/auth.js`) — appka je len pohodlie, nie ochrana.
Núdzový prístup hlavného admina je cez hlavičku `X-Admin-Password`.

**Výkazy.** Každý si vykazuje odpracované dni a nadčasy; peniaze sa počítajú
v celých centoch (`src/vykazy.js`), nadčas z toho, čo v ten deň zarobil, a
potvrdzovať ho netreba.

**WhatsApp bridge.** Samostatný proces (Baileys) číta určené skupiny a posiela
správy na `POST /hook`. Beží v dvoch inštanciách (Fly.io a NAS), duplicity sa
zahadzujú podľa `hookmsg:<id>` v KV. Z prečítaných správ appka **navrhne**
nedostupnosť, admin ju potvrdí.

**Reporty.** Denné reporty s históriou, export do CSV/XLSX a tlač do PDF.

**Import starých tabuliek (XLSX / CSV).** Menu → **Import tabuľky (XLSX)**.
Slúži na to, aby sa už rozpísaná sezóna nemusela klikať odznova. Appka si
v súbore sama nájde stĺpec s dátumami, riadok s hlavičkou aj to, či sú ľudia
v stĺpcoch alebo v riadkoch (dá sa to prepnúť ručne), mená spáruje so štábom
(`guessCrew`) a nespárované ponúkne na doplnenie. Rozpoznáva `A/B/C/R`, duel,
slová typu „nemôže“, „off“, „x“, „dovolenka“ a zvyšok textu odloží do poznámky.
Platia pri tom tie isté pravidlá ako inde v appke: **prázdna bunka v súbore
nikdy nič nezmaže**, bunka, ktorá už v appke niečo má, sa prepíše len po
zaškrtnutí a až po tom, čo je vidieť zoznam `stará → nová`, nahlásený nadčas
prežije prepis a importovať sa dá len ľuďom, ktorých rozpis smie prihlásený
meniť aj klikaním. Celý import ide ako **jedna** zmena — jeden riadok
v histórii, jeden krok späť a jeden zápis na server. Parsovanie je oddelené od
UI v `src/tabulkaImport.js`, takže sa dá testovať bez prehliadača.

**Dispo mail.** Dispozícia príde mailom na schránku napojenú cez Cloudflare
Email Routing na Worker (handler `email()` v `worker/src/index.js`). Appka mail
prečíta, vytiahne časy a mená a **odloží to ako návrh** — v `pendingDispo`.
Admin ho v appke vidí, môže ho potvrdiť alebo zahodiť; potvrdený sa premietne
do dňa a štáb dostane upozornenie. Pražská časť dispozície (odchody) sa
zámerne ignoruje.

**Appka na ploche a upozornenia (PWA).** Appka má manifest a service worker,
takže sa dá pridať na plochu a otvorí sa aj bez signálu. Upozornenia idú cez
Web Push (VAPID). Na iPhone ich Apple dovolí až vtedy, keď je appka pridaná na
plochu cez Zdieľať → Pridať na plochu — appka to v „Môj účet“ rovno povie.
Automatická aktualizácia podľa `version.json` funguje ďalej: `version.json` sa
zámerne nikdy nekešuje a pred obnovením stránky sa zahodí stará keša.

---

## Server: premenné a tajomstvá

Konfigurácia je vo `worker/wrangler.toml`, tajomstvá nikdy nie sú v repozitári.

Tajomstvá (`wrangler secret put …`, alebo Worker `f18` → Settings → Variables
and Secrets):

| Tajomstvo | Na čo je |
| --- | --- |
| `ADMIN_PASSWORD` | núdzový prístup hlavného admina bez mailu |
| `RESEND_API_KEY` | odosielanie prihlasovacích mailov |
| `HOOK_SECRET` | overenie WhatsApp bridge pri `POST /hook` (nepovinné, pozri nižšie) |
| `ANTHROPIC_API_KEY` | rozpoznávanie WhatsApp screenshotov (nepovinné) |

Verejné premenné vo `[vars]`: `ALLOWED_ORIGIN`, `APP_URL`, `COOKIE_DOMAIN`,
`MAIL_FROM`, `BOOTSTRAP_ADMIN_EMAIL` a nepovinne `PUSH_KONTAKT` (kontakt do
VAPID podpisu, napr. `mailto:…`; keď chýba, použije sa
`BOOTSTRAP_ADMIN_EMAIL`).

Kľúč pre upozornenia (VAPID) si server vyrobí **sám** pri prvom použití a odloží
ho do KV pod `push:vapid`. Nie je ho treba nikde generovať ani nikam vkladať a
nikdy sa nedostane do repozitára.

Podobne kód pre WhatsApp čítačku: server si ho vyrobí sám a odloží do KV pod
`bridge:token`. Admin a vedúci ho vidia priamo v appke (menu → **WhatsApp
chaty** → *Kód pre čítačku*) a odtiaľ ho skopírujú čítačke do `HOOK_SECRET`.
Dá sa tam aj vymeniť za nový. Cloudflare secret `HOOK_SECRET`, ak je nastavený,
platí súčasne — čítačke stačí ktorékoľvek z tých dvoch.

### Dispo mail — nastavenie Email Routing

V Cloudflare pre doménu `kartmanko.cc`: Email → Email Routing → Routes →
Create address, cieľ **Send to a Worker → `f18`**. Adresa je
`dispo@kartmanko.cc`. Čo príde na ňu, spracuje handler `email()` a odloží ako
návrh dispozície. Handler nikdy neodpisuje a nikdy mail neodmietne — keby
spracovanie zlyhalo, doručovanie tým netrpí.

---

## Prehľad endpointov

Prihlásenie: `POST /auth/request`, `POST /auth/verify`, `GET /auth/me`,
`POST /auth/logout`, `GET|POST /auth/users`.

Dáta: `GET /data`, `POST /data` (celý stav naraz, s `baseVersion` proti
prepísaniu cudzích zmien — pri konflikte 409), `GET /version`.

WhatsApp: `POST /hook` (bridge), `POST /bridge/ping`, `GET /bridge/status`,
`GET|POST /bridge/token` (kód pre čítačku — pozrieť a vymeniť; smie len rola,
ktorá potvrdzuje zmeny), `POST /parse` (screenshoty).

Dispo: `POST /dispo/mail` (to isté, čo robí mailový handler — na skúšanie).

Upozornenia: `GET /push/key` (verejný kľúč servera), `POST /push/subscribe`,
`POST /push/unsubscribe`, `POST /push/test` (pošle len sebe),
`POST /push/oznam` (rozposlanie štábu — smie len rola, ktorá potvrdzuje zmeny).
Odbery sú v KV pod `push:sub:<mail>:<odtlačok endpointu>`; keď schránka telefónu
odpovie 404/410, odber sa sám zmaže. Núdzový admin nemá mail, takže sa na
upozornenia prihlásiť nemôže.

---

## Ukladanie

Appka ukladá automaticky — žiadne tlačidlo Uložiť. Zmena sa po ~0,6 s pošle ako
`POST /data` s celým stavom a s číslom verzie, ktorú mala appka stiahnutú. Ak
medzitým uložil niekto iný, server vráti 409 a appka ponúkne načítať znova,
namiesto tichého prepísania.

Keď pribudne nové pole do bunky alebo nová časť stavu, treba ho doplniť na
**troch** miestach naraz, inak sa ticho stratí:

1. `normCell` vo `worker/src/auth.js`,
2. `saveData` v `src/api.js`, `handlePostData` a `EMPTY_STATE` vo
   `worker/src/index.js`,
3. `prazdnaBunka` v `src/App.jsx` a kontrola prázdnej bunky v `/hook`.

---

## Lokálne spustenie a testy

```
npm install
npm run dev
```

Build (vyrobí `buildId`, `version.json` a `sw.js`, potom Vite build):

```
npm run build
npm run preview
```

Lokálny server na skúšanie:

```
npx wrangler dev worker/src/index.js --config worker/wrangler.toml \
  --port 8799 --local --var ALLOWED_ORIGIN:http://localhost:5199 \
  --var APP_URL:http://localhost:5199 --var COOKIE_DOMAIN:localhost
```

Tajomstvá pre lokálny beh patria do `worker/.dev.vars` (je v `.gitignore`).

Testy bez siete a bez prehliadača:

```
node test-tabulka-import.mjs
node worker/test-kv-setrenie.mjs
```

---

## Nasadzovanie

Push do `main` spustí dva workflowy: `.github/workflows/deploy.yml` postaví a
nasadí appku na GitHub Pages, `.github/workflows/deploy-worker.yml` nasadí
Worker. Trvá to zhruba minútu až dve. Adresa servera je pre build v premennej
`VITE_API_BASE` (Settings → Secrets and variables → Actions → Variables).

Po nasadení sa už otvorené appky aktualizujú samy: pýtajú si `/version.json`, a
keď sa `BUILD_ID` zmení, zahodia starú kešu a obnovia sa.

---

## Čo ešte treba dokončiť

- Overiť doménu `kartmanko.cc` v Resende (tlačidlo „Auto configure“) a vrátiť
  `MAIL_FROM` na `FARMA rozpis <farma@kartmanko.cc>` — dovtedy chodia
  prihlasovacie maily len majiteľovi Resend účtu.
- Nasadiť WhatsApp bridge na Fly.io a raz ho prepojiť s eSIM — párovacím kódom,
  netreba nič skenovať (`PAIR_NUMBER`, pozri `bridge/README.md`).
- Doladiť UI na mobile.
