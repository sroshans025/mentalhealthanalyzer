import { h, icon, iconEl, toast, clear, errorState, dropdown } from "./ui.js";
import { session, theme, returnTo } from "./session.js";
import { onUnauthorized, tokenStore } from "./api.js";
import * as dashboard from "./views/dashboard.js";
import * as checkin from "./views/checkin.js";
import * as journal from "./views/journal.js";
import * as insights from "./views/insights.js";
import * as settings from "./views/settings.js";
import * as auth from "./views/auth.js";
import { confirmAndSignOut } from "./views/account.js";

const ROUTES = [
  { path: "dashboard", label: "Dashboard", short: "Home", icon: "home", view: dashboard, title: "Dashboard" },
  { path: "check-in", label: "Check-in", short: "Check-in", icon: "pen", view: checkin, title: "New check-in" },
  { path: "journal", label: "Journal", short: "Journal", icon: "book", view: journal, title: "Journal" },
  { path: "insights", label: "Insights", short: "Insights", icon: "spark", view: insights, title: "Insights" },
  { path: "settings", label: "Settings", short: "Settings", icon: "settings", view: settings, title: "Settings" },
];

const viewEl = document.getElementById("view");
let cleanup = null;
let renderId = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  return { path: path || "dashboard", params: new URLSearchParams(qs || "") };
}

/** Navigate to a full hash such as "#/journal?open=3". */
export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

export function navigate(path, params) {
  const qs = params ? new URLSearchParams(params).toString() : "";
  const target = `#/${path}${qs ? `?${qs}` : ""}`;
  if (location.hash === target) render();
  else location.hash = target;
}

function buildNav() {
  const desktop = document.querySelector("[data-nav]");
  const mobile = document.querySelector("[data-nav-mobile]");
  for (const r of ROUTES) {
    desktop.append(h("a", { class: "nav-link", href: `#/${r.path}`, dataset: { route: r.path }, html: `${icon(r.icon)}<span>${r.label}</span>` }));
    mobile.append(h("a", { href: `#/${r.path}`, dataset: { route: r.path }, html: `${icon(r.icon)}<span>${r.short}</span>` }));
  }
  document.querySelectorAll("[data-icon-before]").forEach((el) => {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.iconBefore));
  });
}

function highlight(path) {
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === path) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

const AUTH_ROUTE = { path: "sign-in", view: auth, title: "Sign in" };

async function render() {
  const { path, params } = parseHash();
  const route = path === AUTH_ROUTE.path ? AUTH_ROUTE : ROUTES.find((r) => r.path === path);
  if (!route) { location.replace("#/dashboard"); return; }

  const id = ++renderId;
  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;

  let profile;
  try {
    [profile] = await Promise.all([session.ensure(), session.loadStorageMode()]);
  } catch (err) {
    if (id !== renderId) return;
    document.body.classList.remove("auth-mode");
    clear(viewEl).append(errorState(err.message, () => render()));
    return;
  }
  if (id !== renderId) return;

  // Nobody signed in: everything except the sign-in page redirects there.
  if (!profile && route !== AUTH_ROUTE) {
    if (path !== "dashboard") returnTo.set(location.hash);
    location.replace("#/sign-in");
    return;
  }
  // Accounts never need the sign-in page; guests may visit it to upgrade.
  if (profile && route === AUTH_ROUTE && !session.isGuest) { location.replace("#/dashboard"); return; }

  document.body.classList.toggle("auth-mode", route === AUTH_ROUTE);
  highlight(route.path);
  document.title = `${route.title} · Mental Health Predictor`;
  clear(viewEl);
  viewEl.classList.remove("view-enter");
  void viewEl.offsetWidth; // restart the entrance animation
  viewEl.classList.add("view-enter");
  window.scrollTo({ top: 0 });

  const result = route.view.render(viewEl, { params, navigate, go, isCurrent: () => id === renderId });
  cleanup = result instanceof Promise ? null : result;
  if (result instanceof Promise) result.then((fn) => { if (id === renderId) cleanup = fn; else if (typeof fn === "function") fn(); });

  // Move focus for keyboard and screen-reader users after navigation.
  if (document.activeElement && document.activeElement.closest(".nav, .bottom-nav")) viewEl.focus({ preventScroll: true });
}

// The server rejected the stored key mid-session: send the user to sign in.
let handlingUnauthorized = false;
onUnauthorized((key) => {
  if (handlingUnauthorized || !session.signedIn) return;
  handlingUnauthorized = true;
  const wasAccount = key.startsWith("mhs_");
  session.forget();
  toast(wasAccount ? "Please sign in again" : "Your guest journal is no longer available", {
    type: "warn",
    message: wasAccount
      ? "Your session has ended."
      : session.storage === "ephemeral"
        ? "This server doesn't keep data permanently and was restarted."
        : "Start a new journal or sign in to an account.",
    timeout: 8000,
  });
  navigate("sign-in");
  setTimeout(() => { handlingUnauthorized = false; }, 1000);
});

// ------------------------------------------------------------- user menu

const signOut = () => confirmAndSignOut(navigate);

function initials(p) {
  const source = (p.display_name || p.email || "G").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "G") + (p.display_name && parts[1] ? parts[1][0] : "")).toUpperCase();
}

function renderUserUi(p) {
  const chipHost = document.querySelector("[data-user-chip]");
  const topHost = document.querySelector("[data-user-menu]");
  clear(chipHost); clear(topHost);
  if (!p) return;
  const guest = !p.has_account;
  const name = p.display_name || (guest ? "Guest" : p.email.split("@")[0]);
  const sub = guest ? "Guest journal" : p.email;

  const items = [
    ...(guest ? [{ label: "Create an account", icon: "cloud", onSelect: () => navigate("sign-in", { mode: "register" }) }] : []),
    { label: "Settings", icon: "settings", onSelect: () => navigate("settings") },
    { label: guest ? "Leave guest journal" : "Sign out", icon: "logOut", onSelect: signOut },
  ];

  const chipBtn = h("button", { type: "button", class: "btn btn-ghost icon-btn", "aria-label": "Account menu", html: icon("chevronDown") });
  const menu = dropdown(chipBtn, items);
  chipHost.append(h("div", { class: "user-chip" },
    h("span", { class: "avatar", "aria-hidden": "true" }, initials(p)),
    h("div", { class: "who" }, h("strong", {}, name), h("span", {}, sub)),
    menu));
  // Open the sidebar menu upwards, since the chip sits at the bottom of the screen.
  chipBtn.addEventListener("click", () => requestAnimationFrame(() => {
    const m = chipHost.querySelector(".menu");
    if (m) { m.style.top = "auto"; m.style.bottom = "calc(100% + 6px)"; }
  }));
  if (guest) {
    chipHost.prepend(h("a", { class: "btn btn-sm btn-block", href: "#/sign-in?mode=register", style: { marginBottom: "8px" } },
      iconEl("cloud"), h("span", {}, "Save with an account")));
  }

  const avatarBtn = h("button", { type: "button", class: "avatar-btn", "aria-label": `Account menu for ${name}` },
    h("span", { class: "avatar" }, initials(p)));
  topHost.append(dropdown(avatarBtn, items));
}

session.subscribe(renderUserUi);

// Another tab signed in, signed out or switched journals: follow it.
window.addEventListener("storage", (e) => {
  if (e.key !== tokenStore.key && e.key !== null) return;
  if (e.newValue === e.oldValue) return;
  session.resync();
  if (!e.newValue) {
    toast("Signed out in another tab", { type: "info" });
    render();
  } else if (parseHash().path === AUTH_ROUTE.path) {
    navigate("dashboard"); // signed in elsewhere: leave the sign-in page
  } else {
    render();
  }
});

document.addEventListener("themechange", () => {
  const { path } = parseHash();
  if (path === "dashboard" || path === "insights") render();
});

buildNav();
theme.apply(false);
window.addEventListener("hashchange", render);
render();
