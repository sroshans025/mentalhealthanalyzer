// Shared UI primitives. User-provided text is always inserted with textContent.

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M8 7h8"/><path d="M8 11h6"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  bed: '<path d="M2 20V8M2 16h20M22 20v-8a3 3 0 0 0-3-3h-8v7"/><circle cx="6.5" cy="11.5" r="2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 3M10 8l-1 5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.7 1.3 2.8 2.5 2.8Z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a10 10 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7" cy="7" r="1.5"/>',
  lightbulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/>',
  sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>',
};

export function icon(name, cls = "") {
  const body = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function iconEl(name, cls = "") {
  const tpl = document.createElement("template");
  tpl.innerHTML = icon(name, cls);
  return tpl.content.firstElementChild;
}

/**
 * Tiny element builder. Strings become text nodes (never parsed as HTML).
 * Use `{ html: ... }` only for trusted, static markup such as icons.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value;
    else if (key === "text") el.textContent = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function button(label, { variant = "", icon: ic, size = "", type = "button", ...rest } = {}) {
  const cls = ["btn", variant && `btn-${variant}`, size && `btn-${size}`, rest.class].filter(Boolean).join(" ");
  delete rest.class;
  return h("button", { type, class: cls, ...rest }, ic ? iconEl(ic) : null, label ? h("span", {}, label) : null);
}

export function setBusy(btn, busy, busyLabel = "Working…") {
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${busyLabel}</span>`;
  } else {
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

/** Image with lazy loading and a graceful fallback if it fails to load. */
export function illustration(name, alt, cls = "", { eager = false, width = 240, height = 180 } = {}) {
  const img = h("img", {
    src: `/static/assets/img/${name}.svg`, alt, class: cls, width, height,
    loading: eager ? "eager" : "lazy", decoding: "async",
  });
  img.addEventListener("error", () => {
    const fb = h("div", { class: `img-fallback ${cls}`, role: "img", "aria-label": alt, html: icon("heart") });
    fb.style.width = `${width}px`; fb.style.maxWidth = "100%"; fb.style.aspectRatio = `${width} / ${height}`;
    img.replaceWith(fb);
  }, { once: true });
  return img;
}

// ------------------------------------------------------------------ toasts

const TOAST_ICONS = { success: "checkCircle", error: "alert", warn: "alert", info: "info" };

export function toast(title, { type = "info", message = "", timeout = 4500 } = {}) {
  const host = document.querySelector(".toasts");
  const close = h("button", { class: "close", "aria-label": "Dismiss notification", html: icon("x") });
  const el = h("div", { class: `toast ${type}`, role: type === "error" ? "alert" : "status" },
    iconEl(TOAST_ICONS[type] || "info"),
    h("div", {}, h("strong", {}, title), message ? h("p", {}, message) : null),
    close);
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  close.addEventListener("click", dismiss);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

// ------------------------------------------------------------------ modals

let openModals = 0;

export function modal({ title, body, footer, size = "", label } = {}) {
  const host = document.getElementById("modal-host");
  const previouslyFocused = document.activeElement;
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  const closeBtn = h("button", { class: "btn btn-ghost icon-btn", "aria-label": "Close dialog", html: icon("x") });
  const dialog = h("div", { class: `modal ${size}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-label": label },
    h("div", { class: "modal-head" }, h("h2", { id: titleId }, title), closeBtn),
    h("div", { class: "modal-body" }, body),
    footer ? h("div", { class: "modal-foot" }, footer) : null);
  const backdrop = h("div", { class: "modal-backdrop" });
  const root = h("div", { class: "modal-root" }, backdrop, dialog);

  let closed = false;
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") trapFocus(e, dialog);
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    root.remove();
    openModals = Math.max(0, openModals - 1);
    if (!openModals) document.body.style.overflow = "";
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  host.append(root);
  openModals += 1;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    const target = dialog.querySelector("[autofocus]") || dialog.querySelector(".modal-body button, .modal-body input, .modal-foot .btn-primary, .modal-foot .btn-danger") || closeBtn;
    target.focus();
  });
  return { close, element: dialog };
}

function trapFocus(e, container) {
  const focusables = [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, requireText = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const input = requireText ? h("input", { class: "input mt-12", autocomplete: "off", "aria-label": `Type ${requireText} to confirm`, placeholder: requireText }) : null;
    const ok = button(confirmLabel, { variant: danger ? "danger" : "primary" });
    const cancel = button("Cancel", { variant: "" });
    if (input) {
      ok.disabled = true;
      input.addEventListener("input", () => { ok.disabled = input.value.trim() !== requireText; });
    }
    const m = modal({
      title, size: "sm",
      body: h("div", {}, h("p", { class: "muted" }, message),
        requireText ? h("p", { class: "small mt-12" }, "Type ", h("strong", {}, requireText), " to confirm.") : null, input),
      footer: [cancel, ok],
    });
    const observer = new MutationObserver(() => { if (!m.element.isConnected) { observer.disconnect(); finish(false); } });
    observer.observe(document.getElementById("modal-host"), { childList: true });
    cancel.addEventListener("click", () => { finish(false); m.close(); });
    ok.addEventListener("click", () => { finish(true); m.close(); });
    if (input) requestAnimationFrame(() => input.focus());
  });
}

// --------------------------------------------------------------- dropdowns

export function dropdown(trigger, items) {
  const wrap = h("div", { class: "dropdown" }, trigger);
  let menu = null;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  const close = () => {
    if (!menu) return;
    menu.remove(); menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", onKey);
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => {
    if (!menu) return;
    const btns = [...menu.querySelectorAll("button")];
    const i = btns.indexOf(document.activeElement);
    if (e.key === "Escape") { close(); trigger.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  };
  trigger.addEventListener("click", () => {
    if (menu) return close();
    menu = h("div", { class: "menu", role: "menu" },
      items.map((it) => h("button", { role: "menuitem", type: "button", onclick: () => { close(); it.onSelect(); } },
        it.icon ? iconEl(it.icon) : null, it.label)));
    wrap.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", onKey);
    menu.querySelector("button")?.focus();
  });
  return wrap;
}

// -------------------------------------------------------------- formatting

export const fmt = {
  date(iso, opts = { month: "short", day: "numeric", year: "numeric" }) {
    return new Date(iso).toLocaleDateString(undefined, opts);
  },
  time(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  },
  dateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  },
  relative(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
    return fmt.date(iso);
  },
  num(n, digits = 0) {
    if (n === null || n === undefined) return "–";
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  dayLabel(isoDate) {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  },
  localDate(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};

export const EMOTION_META = {
  joy: { label: "Joy", icon: "smile" },
  neutral: { label: "Neutral", icon: "activity" },
  sadness: { label: "Sadness", icon: "heart" },
  fear: { label: "Anxiety", icon: "alert" },
  anger: { label: "Frustration", icon: "flame" },
};

export const RISK_META = {
  Low: { icon: "checkCircle", label: "Low", cls: "low" },
  Medium: { icon: "info", label: "Medium", cls: "medium" },
  High: { icon: "alert", label: "High", cls: "high" },
};

export function riskBadge(level) {
  const meta = RISK_META[level] || RISK_META.Low;
  return h("span", { class: `badge risk-${level}` }, iconEl(meta.icon), `${meta.label} risk`);
}

export function emotionBadge(emotion) {
  const meta = EMOTION_META[emotion] || { label: emotion, icon: "activity" };
  return h("span", { class: "badge emo" }, iconEl(meta.icon), meta.label);
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export function skeleton(cls) {
  return h("div", { class: `skeleton ${cls}`, "aria-hidden": "true" });
}

export function emptyState({ image, title, text, action, compact = false }) {
  return h("div", { class: `empty ${compact ? "compact" : ""}` },
    image ? illustration(image, "") : null,
    h("h3", {}, title),
    text ? h("p", {}, text) : null,
    action || null);
}

export function errorState(message, onRetry) {
  return emptyState({
    image: "error",
    title: "We couldn't load this",
    text: message || "Please check your connection and try again.",
    action: onRetry ? button("Try again", { variant: "primary", icon: "refresh", onclick: onRetry }) : null,
  });
}
