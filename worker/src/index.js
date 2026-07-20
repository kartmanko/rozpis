/**
 * Cloudflare Worker pre appku "rozpis kameramanov".
 *
 * Endpointy:
 *   GET  /data   -> { crew, cells, log, version }               (verejné, read-only)
 *   POST /data   -> uloží nový stav, vyžaduje X-Admin-Password   (optimistic concurrency cez baseVersion)
 *   POST /parse  -> preposlá screenshot na Anthropic Vision API, vyžaduje X-Admin-Password
 *
 * Potrebné bindingy/secrety (pozri wrangler.toml a README.md):
 *   KV:      ROZPIS_KV
 *   secrety: ADMIN_PASSWORD, ANTHROPIC_API_KEY
 */

const STATE_KEY = "state_v1";

const EMPTY_STATE = { crew: [], cells: {}, log: [], version: 0 };

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
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

async function readState(env) {
  const raw = await env.ROZPIS_KV.get(STATE_KEY);
  if (!raw) return { ...EMPTY_STATE };
  try {
    return JSON.parse(raw);
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function handleGetData(env) {
  const state = await readState(env);
  return json(state, 200, env);
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
    log: Array.isArray(body.log) ? body.log.slice(0, 400) : current.log,
    version: current.version + 1,
  };

  await env.ROZPIS_KV.put(STATE_KEY, JSON.stringify(next));
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

const SK_MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];

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

    return json({ error: "Not found" }, 404, env);
  },
};
