# FARMA 18 — rozpis kameramanov

Webová appka na plánovanie rozpisu kameramanov. Viewer si otvorí link a vidí
tabuľku (read-only, auto-refresh každé 2 min). Admin sa prihlási heslom a
edituje — zmeny sa ukladajú na server (Cloudflare Worker + KV), takže ich
vidia všetci.

Tento repozitár má dve časti:

- `src/` — frontend (React + Vite), nasadzuje sa staticky na GitHub Pages.
- `worker/` — Cloudflare Worker, ktorý drží dáta v KV a preposiela
  screenshoty na vision API (API kľúč nikdy nie je vo frontende).

Ak zatiaľ nemáš GitHub repo ani Cloudflare účet, nič sa nedeje — appka sa dá
spustiť aj lokálne (`npm run dev`) a vyskúšať naprázdno; backend jej len
chýba, kým nasledujúce kroky nedokončíš.

---

## 1. Cloudflare Worker (backend)

1. Vytvor si účet na [cloudflare.com](https://cloudflare.com) (free tier stačí).
2. Nainštaluj Wrangler (CLI pre Workers):
   ```
   npm install -g wrangler
   wrangler login
   ```
3. V priečinku `worker/` vytvor KV namespace:
   ```
   cd worker
   wrangler kv namespace create ROZPIS_KV
   ```
   Príkaz vypíše niečo ako `id = "abcd1234..."` — skopíruj toto `id` do
   `worker/wrangler.toml`, do riadku `id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"`.
4. Nastav tajomstvá (nikdy ich nedávaj do repozitára):
   ```
   wrangler secret put ADMIN_PASSWORD
   wrangler secret put ANTHROPIC_API_KEY
   ```
   - `ADMIN_PASSWORD` — heslo, ktorým sa budeš prihlasovať ako admin v appke.
   - `ANTHROPIC_API_KEY` — kľúč pre Claude API (vision), potrebný len pre
     import screenshotov z WhatsAppu. Získaš ho na
     [console.anthropic.com](https://console.anthropic.com). Ak import
     zatiaľ nepotrebuješ, môžeš tento krok preskočiť — appka bude fungovať,
     len tlačidlo "Import z chatu" vypíše chybu, kým kľúč nepridáš.
5. Nasaď Worker:
   ```
   wrangler deploy
   ```
   Na konci dostaneš URL v tvare `https://rozpis-worker.<tvoj-ucet>.workers.dev`
   — tú budeš potrebovať v kroku 2 nižšie.

Over si aktuálny názov vision modelu na
[docs.claude.com/en/docs/about-claude/models](https://docs.claude.com/en/docs/about-claude/models)
— `worker/src/index.js` má predvolenú hodnotu, ktorá sa časom mení; dá sa
prepísať aj bez redeploy cez `wrangler secret put MODEL_NAME`.

---

## 2. Frontend (GitHub Pages)

1. Vytvor si na [github.com](https://github.com) nový **verejný** repozitár
   `rozpis` (alebo iný názov — ak iný, uprav `base` v `vite.config.js`).
2. Nahraj obsah tohto priečinka do repozitára:
   ```
   git init
   git add .
   git commit -m "Prvotné nasadenie rozpisu kameramanov"
   git branch -M main
   git remote add origin https://github.com/<tvoj-ucet>/rozpis.git
   git push -u origin main
   ```
3. V repozitári choď do **Settings → Pages** a nastav Source na
   **GitHub Actions** (workflow `.github/workflows/deploy.yml` je už pripravený).
4. V **Settings → Secrets and variables → Actions → Variables** pridaj
   premennú `VITE_API_BASE` s hodnotou URL Workera z kroku 1.5 (napr.
   `https://rozpis-worker.tvoj-ucet.workers.dev`, bez lomítka na konci).
5. Push na `main` spustí build a appka bude o pár minút dostupná na
   `https://<tvoj-ucet>.github.io/rozpis/`.

Ak `VITE_API_BASE` nenastavíš vopred, appka sa aj tak nasadí — pri prvom
otvorení ťa upozorní, že backend chýba, a v paneli "Admin" môžeš adresu
Workera zadať ručne (uloží sa do localStorage v prehliadači, funguje to
rovnako dobre, len si to treba zadať v každom prehliadači/zariadení zvlášť).

---

## 3. Lokálne vyskúšanie

```
npm install
cp .env.example .env   # uprav VITE_API_BASE, alebo nechaj prázdne a zadaj v appke
npm run dev
```

Build pre nasadenie:
```
npm run build      # výstup do dist/
npm run preview    # lokálne vyskúšanie buildu
```

---

## Ako appka funguje

- **Viewer** (predvolené): tabuľka read-only, tlačidlo "Obnoviť" + auto-refresh
  každé 2 minúty.
- **Admin**: klikni "Prihlásenie", zadaj heslo (`ADMIN_PASSWORD` z Workera) —
  odomkne sa editácia buniek, poradie kameramanov, výmena smien, import z
  WhatsAppu. Zmeny sa ukladajú automaticky (debounce ~0.6 s) cez `POST /data`.
- **Konflikt**: appka drží `version` posledného stiahnutého stavu. Ak medzitým
  niekto iný uložil novšiu verziu, uloženie zlyhá a appka ponúkne "Načítať
  znova" namiesto tichého prepísania cudzích zmien.
- **Import z WhatsAppu**: admin nahrá screenshoty, appka pošle obrázok na
  `POST /parse` (Worker to prepošle na Anthropic vision API s API kľúčom
  uloženým len na serveri), vráti sa zoznam správ s odhadom, kto je kto —
  admin doplní nejasné prípady a potvrdí zápis. Priradenie sa uloží ako alias,
  nabudúce sa appka pri rovnakom čísle/mene už nepýta.
- **Export**: CSV a XLSX (bodkočiarka, UTF-8 BOM kvôli Excelu) a tlač/PDF
  cez tlačidlo "Tlač / PDF" (použi "Uložiť ako PDF" v dialógu tlače prehliadača).

## Známe obmedzenia / na zváženie neskôr

- Ukladanie prepisuje celý stav naraz (jednoduchý model, vhodný pre malý tím
  do cca desiatok kameramanov a jedného produkčného obdobia). Pri väčšom
  tíme by stálo za úvahu ukladať zmeny po bunkách.
- `ALLOWED_ORIGIN` vo `wrangler.toml` je predvolene `"*"` (kohokoľvek môže
  Worker volať z prehliadača) — keď appku nasadíš na finálnu doménu, zváž
  obmedziť ho na presnú adresu GitHub Pages.
- Heslo admina sa posiela pri každej požiadavke v hlavičke — appka beží cez
  HTTPS (GitHub Pages aj Workers to vynucujú), takže prenos je šifrovaný, ale
  ide o jednoduchú autentizáciu bez expirácie session; pre interný produkčný
  nástroj s jedným zdieľaným heslom je to primeraná úroveň.
