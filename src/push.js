/* Upozornenia do telefónu — strana appky (Fáza 6).

   Ako to prebieha: appka si od servera vypýta jeho verejný kľúč, s ním požiada
   prehliadač o "schránku" na upozornenia (endpoint + dva kľúče) a tú schránku
   pošle serveru. Server potom vie na ten konkrétny telefón poslať správu.

   Dôležité pre iPhone: Apple dovolí upozornenia LEN vtedy, keď je appka pridaná
   na plochu cez Zdieľať → Pridať na plochu. V Safari na normálnej stránke sa
   ani nedá vypýtať povolenie — preto to appka rovno povie, namiesto tichého
   zlyhania. */

import { fetchPushKey, pushSubscribe, pushUnsubscribe } from "./api";
import { dajRegistraciu, jeIOS, jeNaPloche, podporaSW } from "./pwa";

/** Kľúč zo servera je text (base64url), prehliadač chce bajty. */
function naBajty(b64url) {
  const cisty = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const doplnene = cisty + "=".repeat((4 - (cisty.length % 4)) % 4);
  const bin = atob(doplnene);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function naB64url(buffer) {
  const u8 = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function podporaUpozorneni() {
  return podporaSW() && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
}

/**
 * V akom stave sú upozornenia na tomto zariadení. Vracia:
 *   stav: "nejde" | "treba-plochu" | "vypnute" | "zakazane" | "zapnute"
 * a k tomu krátke vysvetlenie po slovensky.
 */
export async function stavUpozorneni() {
  if (!podporaUpozorneni()) {
    if (jeIOS() && !jeNaPloche()) {
      return { stav: "treba-plochu", text: "Na iPhone treba appku najprv pridať na plochu: Zdieľať → Pridať na plochu. Potom sa upozornenia dajú zapnúť." };
    }
    return { stav: "nejde", text: "Tento prehliadač upozornenia nevie." };
  }
  if (jeIOS() && !jeNaPloche()) {
    return { stav: "treba-plochu", text: "Na iPhone treba appku najprv pridať na plochu: Zdieľať → Pridať na plochu. Potom sa upozornenia dajú zapnúť." };
  }
  if (Notification.permission === "denied") {
    return { stav: "zakazane", text: "Upozornenia si v nastaveniach zakázal. Povoliť sa dajú už len tam, v nastaveniach prehliadača." };
  }
  const r = await dajRegistraciu();
  const odber = r ? await r.pushManager.getSubscription() : null;
  if (odber) return { stav: "zapnute", text: "Upozornenia na tomto zariadení sú zapnuté.", endpoint: odber.endpoint };
  return { stav: "vypnute", text: "Upozornenia na tomto zariadení sú vypnuté." };
}

/** Krátky popis zariadenia, nech admin v zozname odberov vidí, čo je čo. */
function popisZariadenia() {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows";
    return ua.slice(0, 60);
  } catch {
    return "";
  }
}

/**
 * Zapne upozornenia na tomto zariadení. Vráti { ok, chyba }.
 * Nič nevyhadzuje — appka má fungovať ďalej aj keď to používateľ odmietne.
 */
export async function zapniUpozornenia() {
  const s = await stavUpozorneni();
  if (s.stav === "treba-plochu" || s.stav === "nejde") return { ok: false, chyba: s.text };

  let povolenie = Notification.permission;
  if (povolenie === "default") {
    try {
      povolenie = await Notification.requestPermission();
    } catch (e) {
      return { ok: false, chyba: "Povolenie sa nepodarilo vypýtať: " + (e && e.message) };
    }
  }
  if (povolenie !== "granted") return { ok: false, chyba: "Bez povolenia to nejde — upozornenia si odmietol." };

  const r = await dajRegistraciu();
  if (!r) return { ok: false, chyba: "Appka ešte nie je pripravená, skús o chvíľu." };

  try {
    const { kluc } = await fetchPushKey();
    if (!kluc) return { ok: false, chyba: "Server nevrátil kľúč pre upozornenia." };

    // Keby na tomto zariadení visel starý odber s iným kľúčom, prehliadač by
    // odmietol vytvoriť nový — tak ten starý najprv zrušíme.
    const stary = await r.pushManager.getSubscription();
    if (stary) {
      const staryKluc = stary.options && stary.options.applicationServerKey;
      const sedi = staryKluc && naB64url(staryKluc) === kluc;
      if (!sedi) await stary.unsubscribe();
    }

    const odber = await r.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: naBajty(kluc),
    });
    const json = odber.toJSON();
    await pushSubscribe({
      endpoint: odber.endpoint,
      p256dh: json.keys && json.keys.p256dh,
      auth: json.keys && json.keys.auth,
      zariadenie: popisZariadenia(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, chyba: "Zapnutie zlyhalo: " + (e && e.message) };
  }
}

/** Vypne upozornenia na tomto zariadení (na ostatných bežia ďalej). */
export async function vypniUpozornenia() {
  const r = await dajRegistraciu();
  if (!r) return { ok: true };
  try {
    const odber = await r.pushManager.getSubscription();
    if (!odber) return { ok: true };
    const endpoint = odber.endpoint;
    await odber.unsubscribe();
    try {
      await pushUnsubscribe(endpoint);
    } catch {
      /* keď server nedosiahneme, odber si sám zmaže, keď naň prestane chodiť */
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, chyba: "Vypnutie zlyhalo: " + (e && e.message) };
  }
}
