# Čítačka WhatsAppu (bridge) — FARMA 18

Malá služba, ktorá je prihlásená do WhatsAppu tým istým číslom ako eSIM v telefóne
a **iba číta**. Nikdy nič do WhatsAppu nepošle a nikdy nič sama nezapíše do rozpisu —
z prečítanej správy iba vytiahne dni, keď niekto nemôže, a pošle to serveru ako
**návrh na potvrdenie**. Zelenú a smeny appka z WhatsAppu nedopĺňa nikdy.

## Prečo môžu bežať dve naraz

WhatsApp dovolí k jednému číslu až štyri prepojené zariadenia. Preto sa dá tá istá
eSIM prihlásiť dvakrát: raz na Fly.io (hlavná) a raz na naske (záloha). Obe čítajú
súčasne a obe posielajú serveru to isté. Server si pamätá ID každej správy, takže ju
spracuje len raz. Keď jedna čítačka vypadne, druhá beží ďalej a nič sa nestratí.

Nerobíme to tak, že by jedna čakala a druhá bežala — WhatsApp si pri každom pripojení
mení prihlasovacie kľúče, takže zdieľať jedno prihlásenie medzi dvoma službami by
obidve odhlásilo a musel by si znova skenovať QR.

## Čo treba nastaviť

| Premenná | Načo je |
|---|---|
| `API_BASE` | `https://api.kartmanko.cc` |
| `HOOK_SECRET` | kód, ktorým sa čítačka preukazuje serveru — pozri nižšie |
| `BRIDGE_ID` | `fly` alebo `nas` — iba na rozlíšenie v appke |
| `AUTH_DIR` | priečinok na **trvalom** disku, kde sa drží prihlásenie |
| `PAIR_NUMBER` | nepovinné: číslo eSIM, napr. `421901234567` — pozri nižšie |

`HOOK_SECRET` sa nikdy nepíše do súborov v repozitári.

## Odkiaľ vziať `HOOK_SECRET`

Z appky. Menu → **WhatsApp chaty** → *Kód pre čítačku* → **Ukázať kód** →
**Skopírovať**. Vidí ho iba hlavný admin a vedúci. Ten istý kód sa dá vpísať
obom čítačkám. Keby sa niekam zatúlal, tlačidlom **Vymeniť za nový** sa vyrobí
iný — starý tým hneď prestane platiť a čítačkám treba vpísať nový.

## Ako sa čítačka prihlási do WhatsAppu

Sú dve cesty a stačí jedna:

- **Párovacím kódom** (jednoduchšie, keď je eSIM v telefóne, ktorý máš v ruke).
  Nastav `PAIR_NUMBER` na číslo eSIM bez plusu a bez medzier. Čítačka vypíše do
  logov osemznakový kód a ten v telefóne iba prepíšeš: *WhatsApp → Nastavenia →
  Prepojené zariadenia → Prepojiť zariadenie → **Prepojiť pomocou telefónneho
  čísla***. Netreba druhú obrazovku ani nič skenovať.
- **QR kódom** — keď `PAIR_NUMBER` nenastavíš, čítačka nakreslí do logov QR a ten
  naskenuješ telefónom. Potrebuješ na to druhú obrazovku.

Prihlásenie sa ukladá na trvalý disk (`AUTH_DIR`), takže sa robí **iba raz** —
reštart ani nová verzia ho nezhodí.

## Fly.io (hlavná čítačka)

```bash
cd bridge
fly launch --no-deploy --copy-config      # appku vytvorí podľa fly.toml
fly volumes create f18_auth --size 1 --region waw
fly secrets set HOOK_SECRET=... PAIR_NUMBER=421901234567
fly deploy
fly logs                                  # tu sa objaví párovací kód
```

Cena: shared-cpu-1x s 256 MB a 1 GB diskom vychádza asi **2 € mesačne**.

## Naska (záloha, nepovinná)

Naska nepotrebuje verejnú IP ani presmerovanie portov — čítačka sa pripája iba von.

**Bez terminálu, cez Docker UI na naske** (na UGREEN/UGOS Pro appka *Docker* →
Project): vytvor nový projekt a vlož doň obsah súboru `nas-compose.yml`. Ten si
zdrojáky stiahne z GitHubu sám pri štarte, takže sa nič nemusí kopírovať na disk.
Pred spustením vymeň v ňom dve hodnoty — `HOOK_SECRET` (kód z appky) a
`PAIR_NUMBER` (číslo eSIM). Párovací kód sa potom objaví v logoch kontajnera.

Pozor: `nas-compose.yml` zámerne nič nezostavuje (`build:`). Docker v UGOS Pro
taký projekt síce vytvorí, ale spustiť ho nedokáže a v logoch to skončí ako
*Project launch failed*. Preto sa berie hotový `node:20-alpine`.

**Z terminálu**, keď máš repozitár stiahnutý:

```bash
cd bridge
printf 'HOOK_SECRET=...\nPAIR_NUMBER=421901234567\n' > .env
docker compose up -d --build
docker compose logs -f      # tu sa objaví párovací kód
```

Prepája sa znova (je to druhé zariadenie). Ak naska nebeží, nič sa nedeje —
appka funguje aj s jednou čítačkou, iba v paneli *WhatsApp chaty* svieti,
že beží len jedna.

## Ktoré skupiny sa čítajú

Žiadne, kým ich niekto nezapne. Čítačka sa každú minútu ohlási serveru a pošle
zoznam skupín, ktoré vidí. Tie sa v appke objavia v paneli **WhatsApp chaty**
ako vypnuté. Až keď ich tam vedúci alebo hlavný admin zapne, začnú sa čítať —
text z nezapnutej skupiny neopustí ani stroj, na ktorom čítačka beží.

## Ako spoznáš, že to beží

V appke, menu → **WhatsApp chaty**. Hore je zoznam čítačiek so zelenou alebo
červenou bodkou. Čítačka, ktorá sa neozvala päť minút, je červená.
