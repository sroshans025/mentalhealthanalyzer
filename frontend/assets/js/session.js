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

  /** Load the stored profile or create a new private one. */
  async ensure() {
    if (state.profile) return state.profile;
    if (state.ready) return state.ready;
    state.ready = (async () => {
      const token = tokenStore.get();
      if (token) {
        try {
          const profile = await api.profile(token);
          this.setProfile(profile);
          return profile;
        } catch (err) {
          // Only discard the key if the server says it is unknown.
          if (!(err instanceof ApiError) || err.status !== 401) throw err;
        }
      }
      const { profile, token: fresh } = await api.createProfile();
      tokenStore.set(fresh);
      this.setProfile(profile);
      return profile;
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

  async reset() {
    tokenStore.clear();
    state.profile = null;
    return this.ensure();
  },

  /** The stored key was rejected mid-session; start a fresh profile. */
  async recover() {
    tokenStore.clear();
    state.profile = null;
    return this.ensure();
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
