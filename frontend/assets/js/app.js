import { h, icon, toast, clear, errorState } from "./ui.js";
import { session, theme } from "./session.js";
import { onUnauthorized } from "./api.js";
import * as dashboard from "./views/dashboard.js";
import * as checkin from "./views/checkin.js";
import * as journal from "./views/journal.js";
import * as insights from "./views/insights.js";
import * as settings from "./views/settings.js";

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

async function render() {
  const { path, params } = parseHash();
  const route = ROUTES.find((r) => r.path === path);
  if (!route) { location.replace("#/dashboard"); return; }

  const id = ++renderId;
  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  highlight(route.path);
  document.title = `${route.title} · Mental Health Predictor`;
  clear(viewEl);
  viewEl.classList.remove("view-enter");
  void viewEl.offsetWidth; // restart the entrance animation
  viewEl.classList.add("view-enter");
  window.scrollTo({ top: 0 });

  try {
    await Promise.all([session.ensure(), session.loadStorageMode()]);
  } catch (err) {
    if (id !== renderId) return;
    viewEl.append(errorState(err.message, () => render()));
    return;
  }
  if (id !== renderId) return;
  const result = route.view.render(viewEl, { params, navigate, isCurrent: () => id === renderId });
  cleanup = result instanceof Promise ? null : result;
  if (result instanceof Promise) result.then((fn) => { if (id === renderId) cleanup = fn; else if (typeof fn === "function") fn(); });

  // Move focus for keyboard and screen-reader users after navigation.
  if (document.activeElement && document.activeElement.closest(".nav, .bottom-nav")) viewEl.focus({ preventScroll: true });
}

let recovering = false;
let lastRecovery = 0;
onUnauthorized(async () => {
  // Recover at most once a minute so a misbehaving server can't cause a loop.
  if (recovering || Date.now() - lastRecovery < 60_000) return;
  recovering = true;
  lastRecovery = Date.now();
  try {
    await session.recover();
    toast("Started a fresh private profile", {
      type: "warn",
      message: session.storage === "ephemeral"
        ? "This server doesn't keep data permanently and was restarted, so earlier entries are no longer available."
        : "Your previous profile key is no longer recognised by the server.",
      timeout: 8000,
    });
    render();
  } finally {
    recovering = false;
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
