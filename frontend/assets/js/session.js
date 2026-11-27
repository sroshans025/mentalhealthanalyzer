// Private profile session + preferences.
import { api, tokenStore, ApiError } from "./api.js";

const THEME_KEY = "mhp.theme";
const state = { profile: null, ready: null, storage: null };
const subscribers = new Set();

export const session = {
  get profile() { return state.profile; },
  get token() { return tokenStore.get(); },
  /** "persistent" or "ephemeral" (hosted without a database). */
  get storage() { return state.storage; },

  async loadStorageMode() {
    if (state.storage) return state.storage;
    try { state.storage = (await api.health()).storage; } catch { state.storage = "unknown"; }
    return state.storage;
  },

  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },

  setProfile(profile) {
    state.profile = profile;
    subscribers.forEach((fn) => fn(profile));
  },

  get isGuest() { return !!state.profile && !state.profile.has_account; },
  get signedIn() { return !!state.profile; },

  /** Load the stored profile. Resolves to null when nobody is signed in. */
  async ensure() {
    if (state.profile) return state.profile;
    if (state.ready) return state.ready;
    state.ready = (async () => {
      const token = tokenStore.get();
      if (!token) return null;
      try {
        const profile = await api.profile(token);
        this.setProfile(profile);
        return profile;
      } catch (err) {
        // Only forget the key if the server says it is no longer valid.
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        tokenStore.clear();
        return null;
      }
    })();
    try {
      return await state.ready;
    } finally {
      state.ready = null;
    }
  },

  /** Switch to a profile using a recovery key. Throws if the key is invalid. */
  async restore(token) {
    const profile = await api.profile(token.trim());
    tokenStore.set(token.trim());
    this.setProfile(profile);
    return profile;
  },

  /** Start a private guest journal (no email needed). */
  async startGuest() {
    const { profile, token } = await api.createProfile();
    tokenStore.set(token);
    this.setProfile(profile);
    return profile;
  },

  async signIn(email, password) {
    const { profile, token } = await api.login({ email, password });
    tokenStore.set(token);
    this.setProfile(profile);
    return profile;
  },

  /** Create an account. A signed-in guest keeps their journal. */
  async register(email, password, displayName) {
    const body = { email, password };
    if (displayName) body.display_name = displayName;
    const result = await api.register(body);
    tokenStore.set(result.token);
    this.setProfile(result.profile);
    return result;
  },

  /** Sign out of this device. */
  async signOut() {
    if (state.profile?.has_account) {
      try { await api.logout(); } catch { /* the local sign-out still happens */ }
    }
    this.forget({ clearDraft: true });
  },

  /** Another tab changed the stored key: forget only our in-memory copy
   *  (never touch shared storage, or tabs would undo each other). */
  resync() {
    state.profile = null;
    state.ready = null;
    subscribers.forEach((fn) => fn(null));
  },

  /** Drop the local session without contacting the server. Drafts survive
   *  an expired session so nothing half-written is lost. */
  forget({ clearDraft = false } = {}) {
    tokenStore.clear();
    if (clearDraft) { try { localStorage.removeItem("mhp.draft"); } catch { /* ignore */ } }
    this.setProfile(null);
  },
};

// Where to go after signing in (set when a signed-out visitor opens a page).
const RETURN_KEY = "mhp.returnTo";
export const returnTo = {
  set(hash) { try { sessionStorage.setItem(RETURN_KEY, hash); } catch { /* ignore */ } },
  /** Read and clear the saved destination; `fallback` when none. */
  take(fallback) {
    let value = null;
    try { value = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
    return value && /^#\/[a-z-]+/.test(value) && !value.startsWith("#/sign-in") ? value : fallback;
  },
};

export const theme = {
  get() { try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; } },
  set(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
    this.apply();
  },
  isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; },
  apply(notify = true) {
    const pref = this.get();
    const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (notify) document.dispatchEvent(new CustomEvent("themechange"));
  },
};

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (theme.get() === "system") theme.apply();
});
