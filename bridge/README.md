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
| `HOOK_SECRET` | to isté tajomstvo, aké má Cloudflare Worker |
| `BRIDGE_ID` | `fly` alebo `nas` — iba na rozlíšenie v appke |
| `AUTH_DIR` | priečinok na **trvalom** disku, kde sa drží prihlásenie |

`HOOK_SECRET` sa nikdy nepíše do súborov v repozitári.

## Fly.io (hlavná čítačka)

```bash
cd bridge
fly launch --no-deploy --copy-config      # appku vytvorí podľa fly.toml
fly volumes create f18_auth --size 1 --region waw
fly secrets set HOOK_SECRET=...           # to isté ako v Cloudflare
fly deploy
fly logs                                  # tu sa objaví QR kód
```

QR kód sa vypíše priamo do logov. Naskenuj ho v telefóne: **WhatsApp → Nastavenia →
Prepojené zariadenia → Prepojiť zariadenie**. Skenuje sa **iba raz** — prihlásenie
ostane na disku aj po reštarte.

Cena: shared-cpu-1x s 256 MB a 1 GB diskom vychádza asi **2 € mesačne**.

## Naska (záloha, nepovinná)

Naska nepotrebuje verejnú IP ani presmerovanie portov — čítačka sa pripája iba von.

```bash
cd bridge
echo "HOOK_SECRET=..." > .env
docker compose up -d --build
docker compose logs -f      # tu sa objaví QR kód
```

QR sa skenuje znova (je to druhé zariadenie). Ak naska nebeží, nič sa nedeje —
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
