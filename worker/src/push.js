/* Upozornenia do telefónu (Fáza 6 — Web Push).

   Ako to funguje: prehliadač si u svojho výrobcu (Google, Apple, Mozilla) vypýta
   adresu schránky — "endpoint" — a k nej dva kľúče. Tie nám appka pošle a my si
   ich odložíme. Keď chceme niečo oznámiť, obsah správy zašifrujeme tými kľúčmi
   a pošleme na tú adresu. Výrobca prehliadača obsah nikdy nevidí; rozšifrovať ho
   vie iba ten konkrétny telefón.

   Prečo je to celé napísané ručne a nie knižnicou: worker beží na Cloudflare a
   knižnice na Web Push počítajú s Node.js. Všetko potrebné (ECDH, HKDF, AES-GCM,
   podpis ES256) vie prehliadačová kryptografia, ktorú Cloudflare má.

   Postupy sú z RFC 8291 (šifrovanie obsahu) a RFC 8292 (VAPID, teda "kto to
   posiela"). Testy v /tmp/t_push.mjs porovnávajú výsledok s nezávislou knižnicou.

   Kľúč servera (VAPID) nie je nikde v repozitári ani v kóde — worker si ho pri
   prvom použití sám vyrobí a odloží do KV. */

const KLUC_VAPID = "push:vapid";
const PREDPONA_ODBERU = "push:sub:";
const TEXT = new TextEncoder();

/* ---------- drobnosti okolo base64url ---------- */

export function b64urlNaBajty(s) {
  const cisty = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const doplnene = cisty + "=".repeat((4 - (cisty.length % 4)) % 4);
  const bin = atob(doplnene);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bajtyNaB64url(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function spoj(...casti) {
  const dlzka = casti.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(dlzka);
  let i = 0;
  for (const c of casti) { out.set(c, i); i += c.length; }
  return out;
}

/** Verejný kľúč v podobe, akú chce prehliadač: 0x04 || x || y (65 bajtov). */
function surovyZJwk(jwk) {
  return spoj(new Uint8Array([4]), b64urlNaBajty(jwk.x), b64urlNaBajty(jwk.y));
}

async function hmac(kluc, data) {
  const k = await crypto.subtle.importKey("raw", kluc, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* HKDF tak, ako ho používa Web Push: vždy jeden krok, výstup najviac 32 bajtov. */
async function hkdf(sol, ikm, info, dlzka) {
  const prk = await hmac(sol, ikm);
  const von = await hmac(prk, spoj(info, new Uint8Array([1])));
  return von.slice(0, dlzka);
}

/* ---------- kľúč servera (VAPID) ---------- */

/** Vráti kľúčový pár servera. Keď ešte nie je, vyrobí ho a odloží do KV. */
export async function vapidKluce(env) {
  const ulozene = await env.ROZPIS_KV.get(KLUC_VAPID, "json");
  if (ulozene && ulozene.privateJwk && ulozene.verejny) return ulozene;

  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  const zaznam = { privateJwk, verejny: bajtyNaB64url(surovyZJwk(publicJwk)) };
  await env.ROZPIS_KV.put(KLUC_VAPID, JSON.stringify(zaznam));
  return zaznam;
}

/** Hlavička "Authorization: vapid …" — ňou sa server predstaví výrobcovi prehliadača. */
export async function vapidHlavicka(env, endpoint, teraz = Date.now()) {
  const k = await vapidKluce(env);
  const aud = new URL(endpoint).origin;
  const sub = env.PUSH_KONTAKT || `mailto:${env.BOOTSTRAP_ADMIN_EMAIL || "admin@kartmanko.cc"}`;

  const hlava = bajtyNaB64url(TEXT.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // 12 hodín je bezpečne pod hornou hranicou 24 hodín, ktorú RFC 8292 povoľuje
  const telo = bajtyNaB64url(TEXT.encode(JSON.stringify({ aud, exp: Math.floor(teraz / 1000) + 12 * 3600, sub })));

  const kluc = await crypto.subtle.importKey(
    "jwk", { ...k.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const podpis = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kluc, TEXT.encode(`${hlava}.${telo}`)));
  return { hlavicka: `vapid t=${hlava}.${telo}.${bajtyNaB64url(podpis)}, k=${k.verejny}`, verejny: k.verejny };
}

/* ---------- šifrovanie obsahu (RFC 8291, aes128gcm) ---------- */

/**
 * Zašifruje text pre jeden konkrétny telefón.
 * "sol" a "par" sa dajú podstrčiť zvonku — kvôli testom proti vzoru z RFC.
 */
export async function zasifruj(p256dh, authSecret, text, { sol, par } = {}) {
  const uaVerejny = b64urlNaBajty(p256dh);       // 65 bajtov, kľúč telefónu
  const auth = b64urlNaBajty(authSecret);        // 16 bajtov, spoločné tajomstvo

  const parKluc = par || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asVerejny = surovyZJwk(await crypto.subtle.exportKey("jwk", parKluc.publicKey));

  const uaKluc = await crypto.subtle.importKey("raw", uaVerejny, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const spolocne = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKluc }, parKluc.privateKey, 256));

  // z ECDH tajomstva a "auth" tajomstva sa najprv urobí spoločný základ
  const info = spoj(TEXT.encode("WebPush: info"), new Uint8Array([0]), uaVerejny, asVerejny);
  const ikm = await hkdf(auth, spolocne, info, 32);

  const solt = sol || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(solt, ikm, spoj(TEXT.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(solt, ikm, spoj(TEXT.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // 0x02 na konci znamená "toto je posledný kus správy"
  const otvorene = spoj(TEXT.encode(text), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sifra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, otvorene));

  // hlavička zásielky: soľ, veľkosť záznamu, dĺžka nášho kľúča, náš kľúč
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return spoj(solt, rs, new Uint8Array([asVerejny.length]), asVerejny, sifra);
}

/* ---------- odbery (kto má na akom zariadení zapnuté upozornenia) ---------- */

async function idOdberu(endpoint) {
  const h = await crypto.subtle.digest("SHA-256", TEXT.encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ulozOdber(env, email, { endpoint, p256dh, auth, zariadenie }) {
  const id = await idOdberu(endpoint);
  const kluc = `${PREDPONA_ODBERU}${String(email || "").toLowerCase()}:${id}`;
  await env.ROZPIS_KV.put(kluc, JSON.stringify({
    endpoint, p256dh, auth, email: String(email || "").toLowerCase(), zariadenie: String(zariadenie || "").slice(0, 200), ts: Date.now(),
  }));
  return kluc;
}

export async function zmazOdber(env, email, endpoint) {
  const id = await idOdberu(endpoint);
  await env.ROZPIS_KV.delete(`${PREDPONA_ODBERU}${String(email || "").toLowerCase()}:${id}`);
}

/** Všetky odbery; keď je zadaný zoznam mailov, tak len tie. */
export async function nacitajOdbery(env, maily = null) {
  const filter = maily ? new Set(maily.map((m) => String(m).toLowerCase())) : null;
  const out = [];
  let cursor;
  do {
    const zoznam = await env.ROZPIS_KV.list({ prefix: PREDPONA_ODBERU, cursor });
    for (const k of zoznam.keys) {
      if (filter) {
        const email = k.name.slice(PREDPONA_ODBERU.length, k.name.lastIndexOf(":"));
        if (!filter.has(email)) continue;
      }
      const v = await env.ROZPIS_KV.get(k.name, "json");
      if (v && v.endpoint) out.push({ ...v, kluc: k.name });
    }
    cursor = zoznam.list_complete ? null : zoznam.cursor;
  } while (cursor);
  return out;
}

/* ---------- odoslanie ---------- */

/** Pošle jednu správu na jednu adresu. Vráti stav, nikdy nevyhodí výnimku. */
export async function posliJednemu(env, odber, sprava) {
  try {
    const telo = await zasifruj(odber.p256dh, odber.auth, JSON.stringify(sprava));
    const { hlavicka } = await vapidHlavicka(env, odber.endpoint);
    const r = await fetch(odber.endpoint, {
      method: "POST",
      headers: {
        Authorization: hlavicka,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: sprava.dolezite ? "high" : "normal",
      },
      body: telo,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, chyba: e && e.message };
  }
}

/**
 * Pošle správu všetkým (alebo vybraným mailom). Odbery, ktoré už neplatia
 * (telefón si appku odinštaloval), sa rovno zmažú — inak by sa v KV kopili.
 */
export async function posliVsetkym(env, sprava, maily = null) {
  const odbery = await nacitajOdbery(env, maily);
  let poslane = 0, zmazane = 0, zlyhalo = 0;
  for (const o of odbery) {
    const r = await posliJednemu(env, o, sprava);
    if (r.ok) poslane++;
    else if (r.status === 404 || r.status === 410) { await env.ROZPIS_KV.delete(o.kluc); zmazane++; }
    else zlyhalo++;
  }
  return { poslane, zmazane, zlyhalo, spolu: odbery.length };
}
