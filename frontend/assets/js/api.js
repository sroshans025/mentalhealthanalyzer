// API client. Attaches the private profile key and normalises errors.

const TOKEN_KEY = "mhp.token";
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Falls back to memory when the browser blocks storage (strict privacy
// settings, some private modes), so the app still works for that visit.
let memoryToken = null;
export const tokenStore = {
  get() {
    try { return localStorage.getItem(TOKEN_KEY) ?? memoryToken; } catch { return memoryToken; }
  },
  set(token) {
    memoryToken = token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage disabled: memory only */ }
  },
  clear() {
    memoryToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage disabled */ }
  },
  get persisted() {
    try { return localStorage.getItem(TOKEN_KEY) !== null; } catch { return false; }
  },
  key: TOKEN_KEY,
};

/** Called when the server rejects the stored key (e.g. profile deleted). */
export function onUnauthorized(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const tzOffset = () => -new Date().getTimezoneOffset();

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function request(path, { method = "GET", body, query, auth = true, raw = false, timeout = 20000, token } = {}) {
  const headers = { Accept: "application/json" };
  const key = token || tokenStore.get();
  if (auth && key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(`/api${path}${buildQuery(query)}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
  } catch (err) {
    throw new ApiError(0, err.name === "AbortError"
      ? "The request took too long. Please try again."
      : "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && auth && !token && key) listeners.forEach((fn) => fn(key));
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let details;
    try {
      const data = await res.json();
      message = data?.error?.message || message;
      details = data?.error?.details;
    } catch { /* non-JSON error body */ }
    if (res.status === 429) message = "You're going a little fast. Please wait a moment and try again.";
    throw new ApiError(res.status, message, details);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => request("/health", { auth: false }),
  createProfile: () => request("/profiles", { method: "POST", auth: false }),
  register: (body) => request("/auth/register", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body, auth: false }),
  logout: () => request("/auth/logout", { method: "POST" }),
  profile: (token) => request("/profile", { token }),
  updateProfile: (changes) => request("/profile", { method: "PATCH", body: changes }),
  deleteProfile: () => request("/profile", { method: "DELETE" }),
  analyze: (journal) => request("/analyze", { method: "POST", body: { journal } }),
  createEntry: (payload) => request("/entries", { method: "POST", body: payload }),
  entries: (params) => request("/entries", { query: { ...params, tz: tzOffset() } }),
  entry: (id) => request(`/entries/${encodeURIComponent(id)}`),
  deleteEntry: (id) => request(`/entries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tags: () => request("/tags"),
  stats: (days) => request("/stats", { query: { days, tz: tzOffset() } }),
  insights: () => request("/insights", { query: { tz: tzOffset() } }),
  export: (format) => request("/export", { query: { format }, raw: true }),
};
