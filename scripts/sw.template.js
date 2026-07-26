/* Service worker appky (Fáza 6 — PWA).

   POZOR: tento súbor sa neupravuje ručne na mieste, kde ho vidí prehliadač.
   Je to šablóna — scripts/gen-buildid.mjs z nej pri každom builde vyrobí
   public/sw.js a doplní doň číslo buildu. Upravuj vždy túto šablónu.

   Načo to celé je: appka je pripnutá na ploche telefónu a natáča sa aj tam,
   kde nie je signál. Service worker drží posledný stiahnutý vzhľad appky, takže
   sa otvorí aj offline. Rozpis samotný je na serveri — offline sa ukáže to, čo
   sa naposledy načítalo, a keď je príjem, appka si ho dotiahne.

   Dve veci, na ktorých to celé stojí a ktoré sa nesmú pokaziť:
   1. /version.json sa NIKDY nekešuje. Podľa neho appka pozná, že je vonku nová
      verzia, a sama sa obnoví. Keby ho service worker odložil do keše, appka by
      naveky videla starý build a nikdy by sa neaktualizovala.
   2. index.html sa ťahá vždy najprv zo siete. V ňom sú odkazy na súbory s
      hashom v názve; zo starého indexu by appka ťahala súbory, ktoré už na
      serveri nie sú. */

const BUILD = "__BUILD_ID__";
const KESA = `f18-${BUILD}`;

/* Kostra appky — to, čo musí byť v keši hneď, nech sa appka otvorí aj offline. */
const KOSTRA = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(KESA)
      .then((c) => Promise.allSettled(KOSTRA.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // starý build = stará keša, preč s ňou, nech sa v telefóne nekopia
      .then((mena) => Promise.all(mena.filter((m) => m.startsWith("f18-") && m !== KESA).map((m) => caches.delete(m))))
      .then(() => self.clients.claim()),
  );
});

/* Appka si vie vyžiadať okamžité prepnutie na novú verziu (posiela to pred obnovením stránky). */
self.addEventListener("message", (e) => {
  const typ = e.data && e.data.typ;
  if (typ === "prepni") self.skipWaiting();
  if (typ === "vycisti") {
    e.waitUntil(caches.keys().then((mena) => Promise.all(mena.filter((m) => m.startsWith("f18-")).map((m) => caches.delete(m)))));
  }
});

const jeHashovany = (p) => p.startsWith("/assets/");

async function zoSiete(request, ulozit) {
  const odpoved = await fetch(request);
  if (ulozit && odpoved && odpoved.ok && odpoved.type === "basic") {
    const kopia = odpoved.clone();
    caches.open(KESA).then((c) => c.put(request, kopia)).catch(() => {});
  }
  return odpoved;
}

self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // cudzie domény (server appky, fonty) rieši prehliadač sám
  if (url.origin !== self.location.origin) return;
  // toto je jediný zdroj pravdy o verzii — nikdy nekešovať (pozri poznámku hore)
  if (url.pathname === "/version.json") return;

  // otvorenie appky: vždy najprv sieť, offline padni na poslednú uloženú stránku
  if (request.mode === "navigate") {
    e.respondWith(
      zoSiete(request, true).catch(async () => (await caches.match("/")) || (await caches.match(request)) || Response.error()),
    );
    return;
  }

  // súbory s hashom v názve sa nikdy nemenia — keď ich raz máme, netreba sieť
  if (jeHashovany(url.pathname)) {
    e.respondWith(
      caches.match(request).then((v) => v || zoSiete(request, true)),
    );
    return;
  }

  // zvyšok (ikony, manifest): daj hneď, čo máme, a na pozadí si stiahni novšie
  e.respondWith(
    caches.match(request).then((v) => {
      const zo_siete = zoSiete(request, true).catch(() => v || Response.error());
      return v || zo_siete;
    }),
  );
});

/* ---------- upozornenia (Web Push) ---------- */

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { text: e.data ? e.data.text() : "" };
  }
  const nadpis = d.nadpis || "FARMA 18";
  const telo = d.text || "";
  e.waitUntil(
    self.registration.showNotification(nadpis, {
      body: telo,
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-64.png",
      tag: d.znacka || undefined,      // rovnaká značka = správa sa prepíše, nie nakopí
      renotify: !!d.znacka,
      data: { url: d.url || "/" },
      requireInteraction: !!d.dolezite,
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const kam = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((okna) => {
      // keď je appka už otvorená, iba ju vyneseme dopredu — netreba druhé okno
      for (const o of okna) {
        if (o.url.startsWith(self.location.origin) && "focus" in o) return o.focus();
      }
      return self.clients.openWindow(kam);
    }),
  );
});
