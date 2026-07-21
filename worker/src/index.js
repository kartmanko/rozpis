/**
 * Cloudflare Worker pre appku "rozpis štábu" (FARMA 18).
 *
 * Endpointy:
 *   GET  /data    -> { crew, cells, nad, log, pendingHook, version }   (verejné, read-only)
 *   POST /data    -> uloží nový stav, vyžaduje X-Admin-Password        (optimistic concurrency cez baseVersion)
 *   POST /parse   -> preposlá screenshot na Anthropic Vision API, vyžaduje X-Admin-Password
 *   GET  /version -> { version } — aktuálna verzia DÁT na serveri (nesúvisí s verziou frontendu;
 *                     tú appka rieši sama cez public/version.json + BUILD_ID, viď README).
 *   POST /hook    -> príjem správ z WhatsApp Business bridge (WAHA/Baileys), vyžaduje X-Hook-Secret.
 *                    Tento endpoint je IBA na čítanie správ z chatu — nikdy nič neposiela naspäť
 *                    do WhatsApp skupiny (žiadne volanie na send API bridge-u odtiaľto).
 *
 * Potrebné bindingy/secrety (pozri wrangler.toml a README.md):
 *   KV:      ROZPIS_KV
 *   secrety: ADMIN_PASSWORD, ANTHROPIC_API_KEY, HOOK_SECRET
 *   voliteľné env premenné: ALLOWED_ORIGIN, WHATSAPP_GROUP_ID, DEFAULT_HOOK_MONTH
 */

const STATE_KEY = "state_v1";

const EMPTY_STATE = { crew: [], cells: {}, nad: {}, log: [], pendingHook: [], version: 0 };

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-Hook-Secret",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

function checkAdmin(request, env) {
  const pw = request.headers.get("X-Admin-Password") || "";
  return env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD;
}

function checkHookSecret(request, env) {
  const s = request.headers.get("X-Hook-Secret") || "";
  return env.HOOK_SECRET && s === env.HOOK_SECRET;
}

async function readState(env) {
  const raw = await env.ROZPIS_KV.get(STATE_KEY);
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw);
    // doplň chýbajúce polia pre stav uložený ešte pred pridaním nad/pendingHook
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(env, state) {
  await env.ROZPIS_KV.put(STATE_KEY, JSON.stringify(state));
}

async function handleGetData(env) {
  const state = await readState(env);
  return json(state, 200, env);
}

async function handleGetVersion(env) {
  const state = await readState(env);
  return json({ version: state.version }, 200, env);
}

async function handlePostData(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "Nesprávne admin heslo." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const current = await readState(env);
  const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : -1;

  if (baseVersion !== current.version) {
    // niekto iný medzitým uložil novšiu verziu
    return json({ error: "conflict", current }, 409, env);
  }

  const next = {
    crew: Array.isArray(body.crew) ? body.crew : current.crew,
    cells: body.cells && typeof body.cells === "object" ? body.cells : current.cells,
    nad: body.nad && typeof body.nad === "object" ? body.nad : current.nad,
    log: Array.isArray(body.log) ? body.log.slice(0, 400) : current.log,
    pendingHook: Array.isArray(body.pendingHook) ? body.pendingHook.slice(0, 200) : current.pendingHook,
    version: current.version + 1,
  };

  await writeState(env, next);
  return json({ version: next.version }, 200, env);
}

const VISION_PROMPT_TEMPLATE = (monthNum, monthName) => `Čítaš screenshot zo skupinového WhatsApp chatu kameramanov. Ľudia píšu, ktoré dni NEMÔŽU pracovať, prípadne neskôr opravujú/menia dátumy, ktoré predtým nahlásili.
Vráť IBA JSON pole, bez markdownu a bez vysvetlenia:
[{"sender":"meno ako je v chate","phone":"telefón ak je vidieť, inak \\"\\"","text":"text správy","unavailable":["2026-08-15"],"correctedAvailable":["2026-08-16"],"noRestrictions":false,"isCorrection":false}]
Pravidlá:
- Rok je 2026. Ak správa neuvádza mesiac, použi mesiac ${monthNum} (${monthName}).
- Rozsahy rozbaľ na jednotlivé dni: "27-30.8." = 27.,28.,29.,30. august; "od 12 až do 21" = 12 až 21.
- Zoznam typu "6.7.8.9.11." sú jednotlivé dni.
- "unavailable" = dni, ktoré má správa nahlásiť ako NOVÉ nemôže (pridať).
- "correctedAvailable" = dni, ktoré správa spätne RUŠÍ/OPRAVUJE — teda predtým boli nahlásené ako nemôže, ale autor teraz píše, že predsa len MÔŽE / že to bol omyl / že sa mu dátum zmenil a pôvodný dátum už neplatí. Sem daj presne tie dátumy, ktoré sa majú znova sprístupniť (odznačiť "nemôže"). Ak správa iba pridáva nové "nemôže" dni bez rušenia starších, nechaj toto pole prázdne.
- Nastav isCorrection:true vždy, keď správa obsahuje slová/zmysel ako "oprava", "omyl", "zle som napísal", "predsa len môžem", "zmena", "opravujem sa", alebo keď correctedAvailable nie je prázdne.
- Ak píše, že je bez obmedzení alebo že zatiaľ môže (bez toho, že by to bola oprava predchádzajúcej správy), daj noRestrictions:true a unavailable prázdne.
- Ignoruj správy, ktoré neriešia dostupnosť (pozdravy, emoji, organizačné oznamy).
- Meno uveď presne tak, ako je v screenshote, aj keď je orezané.`;

const TEXT_PROMPT_TEMPLATE = (monthNum, monthName) => `Dostávaš JEDNU textovú správu zo skupinového WhatsApp chatu kameramanov/štábu (nie screenshot, čistý text). Autor píše, ktoré dni NEMÔŽE pracovať, prípadne opravuje/mení dátumy, ktoré predtým nahlásil.
Vráť IBA JSON objekt, bez markdownu a bez vysvetlenia, presne v tvare:
{"unavailable":["2026-08-15"],"correctedAvailable":["2026-08-16"],"noRestrictions":false,"isCorrection":false}
Pravidlá:
- Rok je 2026. Ak správa neuvádza mesiac, použi mesiac ${monthNum} (${monthName}).
- Rozsahy rozbaľ na jednotlivé dni: "27-30.8." = 27.,28.,29.,30. august; "od 12 až do 21" = 12 až 21.
- Zoznam typu "6.7.8.9.11." sú jednotlivé dni.
- "unavailable" = dni, ktoré správa hlási ako NOVÉ nemôže (pridať).
- "correctedAvailable" = dni, ktoré správa spätne RUŠÍ/OPRAVUJE (predtým nahlásené nemôže, teraz autor píše že predsa len môže / bol to omyl / zmenil sa dátum).
- Nastav isCorrection:true, keď správa obsahuje zmysel "oprava/omyl/zle som napísal/predsa len môžem/zmena", alebo keď correctedAvailable nie je prázdne.
- Ak píše, že je bez obmedzení (bez toho, aby to bola oprava), daj noRestrictions:true a unavailable prázdne.
- Ak správa vôbec nerieši dostupnosť (pozdrav, emoji, organizačná správa), vráť všetky polia prázdne/false.
- Ak si dátumom neistý, radšej ho vynechaj, než aby si hádal.`;

const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

async function callAnthropicText(env, prompt, userText) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.MODEL_NAME || "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [
        { role: "user", content: `${prompt}\n\nSpráva:\n"""${userText}"""` },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Vision/text API zlyhalo: " + errText.slice(0, 300));
  }
  const data = await resp.json();
  const text = (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
  return text.replace(/```json|```/g, "").trim();
}

async function handlePostParse(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "Nesprávne admin heslo." }, 401, env);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Vision API kľúč nie je nastavený na serveri." }, 500, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const { image, mediaType, month } = body;
  if (!image) return json({ error: "Chýba obrázok." }, 400, env);

  const monthNum = Number(month) || 8;
  const prompt = VISION_PROMPT_TEMPLATE(monthNum, SK_MONTHS[monthNum - 1]);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Over si aktuálny názov modelu na https://docs.claude.com/en/docs/about-claude/models
      // — dá sa prepísať aj bez redeploy cez `wrangler secret put MODEL_NAME` (voliteľné).
      model: env.MODEL_NAME || "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: image } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return json({ error: "Vision API zlyhalo: " + errText.slice(0, 300) }, 502, env);
  }

  const data = await resp.json();
  const text = (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();

  let items;
  try {
    items = JSON.parse(clean);
  } catch {
    return json({ error: "Nepodarilo sa spracovať odpoveď vision modelu." }, 502, env);
  }

  return json({ items }, 200, env);
}

/* ---------- WhatsApp bridge webhook (POST /hook) ---------- */
// Tento endpoint IBA ČÍTA správy, ktoré mu pošle vlastný WAHA/Baileys bridge používateľa
// (ten beží mimo tohto Workera — eSIM číslo, prepojenie WhatsApp Business, hosting je
// zodpovednosť používateľa, viď README). Worker odtiaľto NIKDY nič neposiela naspäť do
// WhatsApp skupiny — žiadny send-message call, iba číta a zapisuje do vlastného KV stavu.

const phoneKey = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
};

function matchCrewByPhone(crew, phone) {
  const pk = phoneKey(phone);
  if (!pk) return null;
  return crew.find((c) => (c.aliases || []).some((a) => phoneKey(a) === pk)) || null;
}

async function handlePostHook(request, env) {
  if (!checkHookSecret(request, env)) return json({ error: "Neplatný alebo chýbajúci X-Hook-Secret." }, 401, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Neplatné telo požiadavky." }, 400, env);
  }

  const { groupId, phone, sender, text } = body;

  // over, že správa ide zo správnej WhatsApp skupiny (ak je nakonfigurované) — inak ju ignoruj (nie chyba)
  if (env.WHATSAPP_GROUP_ID && groupId && groupId !== env.WHATSAPP_GROUP_ID) {
    return json({ ignored: true, reason: "iná skupina" }, 200, env);
  }
  if (!text || !String(text).trim()) {
    return json({ ignored: true, reason: "prázdny text" }, 200, env);
  }

  const defaultMonth = Number(env.DEFAULT_HOOK_MONTH) || 8;
  let parsed;
  try {
    const clean = await callAnthropicText(env, TEXT_PROMPT_TEMPLATE(defaultMonth, SK_MONTHS[defaultMonth - 1]), String(text).slice(0, 2000));
    parsed = JSON.parse(clean);
  } catch (e) {
    return json({ error: "Nepodarilo sa spracovať text správy: " + e.message }, 502, env);
  }

  const unavailable = Array.isArray(parsed.unavailable) ? parsed.unavailable : [];
  const correctedAvailable = Array.isArray(parsed.correctedAvailable) ? parsed.correctedAvailable : [];
  const noRestrictions = Boolean(parsed.noRestrictions);
  const isCorrection = Boolean(parsed.isCorrection);

  if (!unavailable.length && !correctedAvailable.length && !noRestrictions) {
    return json({ ignored: true, reason: "správa nerieši dostupnosť" }, 200, env);
  }

  const state = await readState(env);
  const match = matchCrewByPhone(state.crew, phone);

  if (match) {
    // telefón poznáme -> rovno zapíš (nikdy nezapisuj pri neznámom telefóne)
    const cells = { ...state.cells };
    unavailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      const cur = cells[k] || { off: false, shift: null, duel: false, note: "" };
      cells[k] = { ...cur, off: true };
    });
    correctedAvailable.forEach((iso) => {
      const k = `${iso}|${match.id}`;
      const cur = cells[k] || { off: false, shift: null, duel: false, note: "" };
      const next = { ...cur, off: false };
      const empty = !next.off && !next.shift && !next.duel && !next.note;
      if (empty) delete cells[k]; else cells[k] = next;
    });
    const bits = [];
    if (noRestrictions) bits.push("bez obmedzení");
    if (unavailable.length) bits.push(`${unavailable.length} dní nemôže`);
    if (correctedAvailable.length) bits.push(`${correctedAvailable.length} dní opravených (znova môže)`);
    const log = [{ t: new Date().toISOString(), text: `WhatsApp bridge: ${match.name} — ${bits.join(", ") || "žiadna zmena"}` }, ...state.log].slice(0, 400);
    const next = { ...state, cells, log, version: state.version + 1 };
    await writeState(env, next);
    return json({ matched: true, crewId: match.id, version: next.version }, 200, env);
  }

  // neznámy telefón -> NIKDY nezapisuj priamo, iba zaraď do fronty na potvrdenie adminom
  const entry = {
    id: "hook_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    ts: new Date().toISOString(),
    phone: phone || "",
    sender: sender || "",
    text: String(text).slice(0, 500),
    unavailable,
    correctedAvailable,
    noRestrictions,
    isCorrection,
  };
  const pendingHook = [entry, ...(state.pendingHook || [])].slice(0, 200);
  const next = { ...state, pendingHook, version: state.version + 1 };
  await writeState(env, next);
  return json({ queued: true, id: entry.id, version: next.version }, 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === "/data" && request.method === "GET") {
      return handleGetData(env);
    }
    if (url.pathname === "/data" && request.method === "POST") {
      return handlePostData(request, env);
    }
    if (url.pathname === "/parse" && request.method === "POST") {
      return handlePostParse(request, env);
    }
    if (url.pathname === "/version" && request.method === "GET") {
      return handleGetVersion(env);
    }
    if (url.pathname === "/hook" && request.method === "POST") {
      return handlePostHook(request, env);
    }

    return json({ error: "Not found" }, 404, env);
  },
};
