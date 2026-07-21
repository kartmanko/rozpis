/* ---------- komunikácia s Cloudflare Workerom ---------- */
// Worker URL nastav cez .env (VITE_API_BASE=https://rozpis-worker.tvoj-ucet.workers.dev)
// pri builde, alebo appka umožní zadať ho ručne (uloží sa do localStorage) —
// užitočné, ak zatiaľ Worker nemáš a chceš appku aspoň vyskúšať naprázdno.
const API_BASE_STORAGE_KEY = "rozpis_api_base";

export function getApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    return localStorage.getItem(API_BASE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiBase(url) {
  try {
    localStorage.setItem(API_BASE_STORAGE_KEY, url.replace(/\/$/, ""));
  } catch {
    /* ticho */
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, opts = {}) {
  const base = getApiBase();
  if (!base) throw new ApiError("Backend (Cloudflare Worker) nie je nastavený.", 0);
  const res = await fetch(base + path, opts);
  if (!res.ok) {
    let msg = `Chyba servera (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* telo nie je JSON */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

export async function fetchData() {
  // { crew, cells, log, version }
  return request("/data", { method: "GET" });
}

export async function saveData({ crew, cells, nad, log, baseVersion, password }) {
  return request("/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password || "",
    },
    body: JSON.stringify({ crew, cells, nad, log, baseVersion }),
  });
}

export async function parseScreenshot({ base64, mediaType, month, password }) {
  return request("/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password || "",
    },
    body: JSON.stringify({ image: base64, mediaType, month }),
  });
}

export { ApiError };
