/* Appka na ploche telefónu (Fáza 6 — PWA).

   Tu je len prihlásenie service workera a pár otázok, ktoré potrebuje vedieť
   nastavenie upozornení: či appka beží pripnutá na ploche a či je to iPhone.
   Na iPhone totiž upozornenia fungujú výlučne vtedy, keď je appka pridaná na
   plochu — v Safari na normálnej stránke ich systém nedovolí. */

let registracia = null;

export function podporaSW() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Prihlási service workera. Keď sa to nepodarí, appka funguje ďalej — len bez offline. */
export async function prihlasSW() {
  if (!podporaSW()) return null;
  try {
    registracia = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registracia;
  } catch (e) {
    console.warn("service worker sa neprihlásil:", e && e.message);
    return null;
  }
}

export async function dajRegistraciu() {
  if (registracia) return registracia;
  if (!podporaSW()) return null;
  try {
    registracia = (await navigator.serviceWorker.getRegistration("/")) || null;
  } catch {
    registracia = null;
  }
  return registracia;
}

/* Volá sa tesne pred obnovením stránky na novú verziu: povie service workerovi,
   nech sa prepne na nový a zahodí starú kešu. Keby to nestihol, nič sa nedeje —
   obnovenie stránky si novú verziu vytiahne zo siete tak či tak. */
export async function pripravAktualizaciu() {
  const r = await dajRegistraciu();
  if (!r) return;
  try {
    await r.update();
  } catch {
    /* ticho */
  }
  try {
    if (r.waiting) r.waiting.postMessage({ typ: "prepni" });
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ typ: "vycisti" });
  } catch {
    /* ticho */
  }
}

/** Beží appka pripnutá na ploche (nie ako obyčajná stránka v prehliadači)? */
export function jeNaPloche() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    return !!window.navigator.standalone; // takto to hlási iOS
  } catch {
    return false;
  }
}

export function jeIOS() {
  try {
    const ua = navigator.userAgent || "";
    // iPadOS sa od istej verzie hlási ako Mac — poznáme ho podľa dotykovej obrazovky
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}
