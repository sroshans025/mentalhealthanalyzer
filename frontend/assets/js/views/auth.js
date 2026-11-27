import { ApiError } from "../api.js";
import { session, theme } from "../session.js";
import { h, icon, iconEl, button, setBusy, toast, modal, illustration } from "../ui.js";

const POINTS = [
  { icon: "shield", title: "Private by default", text: "Your journal is tied to your account only. Nobody else can read it." },
  { icon: "trendUp", title: "See your patterns", text: "Mood, sleep, screen time and movement, side by side over time." },
  { icon: "heart", title: "Two minutes a day", text: "A short reflection is enough to start noticing what helps." },
];

/**
 * Sign in / create account / continue as guest.
 * `?mode=register` opens the create-account tab; a signed-in guest who lands
 * here is upgrading and keeps their journal.
 */
export function render(root, { params, navigate }) {
  const upgrading = session.isGuest;
  let mode = params.get("mode") === "register" || upgrading ? "register" : "signin";

  // ----------------------------------------------------------- brand panel
  const art = h("section", { class: "auth-art", "aria-label": "About Mental Health Predictor" },
    h("a", { class: "brand", href: "#/sign-in", "aria-label": "Mental Health Predictor" },
      h("img", { class: "brand-mark", src: "/static/assets/img/favicon.svg", alt: "", width: 36, height: 36 }),
      h("span", { class: "brand-name" }, "Mental Health", h("span", {}, "Predictor"))),
    h("div", { class: "auth-copy" },
      h("p", { class: "eyebrow" }, "Daily wellbeing check-ins"),
      h("h1", { html: "Understand your days,<br><em>one reflection</em> at a time." }),
      h("p", {}, "Write a few lines, log your sleep, screen time and steps, and watch how your wellbeing trends over time."),
      h("ul", { class: "auth-points" }, POINTS.map((p) => h("li", {},
        h("span", { class: "ico", html: icon(p.icon) }),
        h("div", {}, h("strong", {}, p.title), h("span", {}, p.text)))))),
    h("div", { class: "auth-scene" }, illustration("auth-scene", "", "", { eager: true, width: 1200, height: 420 })),
    h("p", { class: "auth-art-foot" }, "Not a medical tool. If you're struggling, free confidential support is available at ",
      h("a", { href: "https://findahelpline.com", target: "_blank", rel: "noopener noreferrer" }, "findahelpline.com"), "."));

  // ----------------------------------------------------------- form panel
  const heading = h("h2");
  const lead = h("p", { class: "lead" });
  const tabs = h("div", { class: "auth-tabs", role: "tablist", "aria-label": "Sign in or create an account" });
  const alertBox = h("div", { class: "form-alert", role: "alert", hidden: true });

  const email = textField({ id: "auth-email", label: "Email", type: "email", icon: "mail", autocomplete: "email", placeholder: "you@example.com" });
  const name = textField({ id: "auth-name", label: "Your name", type: "text", icon: "user", autocomplete: "given-name", placeholder: "Optional", maxlength: 40 });
  const password = passwordField();
  const submit = button("", { variant: "primary", size: "lg", type: "submit", class: "btn-block" });

  const form = h("form", { class: "auth-form", novalidate: true }, alertBox, name.el, email.el, password.el, submit);

  const guestBtn = h("button", { type: "button", class: "btn btn-block guest-btn" },
    h("span", { class: "guest-ico", html: icon("user") }),
    h("span", { class: "guest-text" }, h("span", {}, "Continue as guest"), h("small", {}, "No email needed. Upgrade to an account any time.")),
    h("span", { class: "arrow", html: icon("arrowRight") }));
  const guestBlock = h("div", {}, h("div", { class: "auth-divider" }, "or"), guestBtn);

  const backBtn = h("a", { class: "btn btn-ghost btn-block mt-12", href: "#/dashboard" }, "Back to my journal");
  const upgradeNote = h("div", { class: "upgrade-note", html: icon("cloud") },
    h("span", {}, "Your guest journal will be moved into your new account, so nothing you've written is lost."));

  const restoreLink = h("button", { type: "button" }, "Use a recovery key");
  const foot = h("p", { class: "auth-foot" }, "Have a guest recovery key? ", restoreLink);

  const themeBtn = h("button", { type: "button", class: "btn btn-ghost icon-btn auth-theme" });
  const paintTheme = () => {
    const dark = theme.isDark();
    themeBtn.innerHTML = icon(dark ? "sun" : "moon");
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  };
  themeBtn.addEventListener("click", () => { theme.set(theme.isDark() ? "light" : "dark"); paintTheme(); });
  paintTheme();

  const demoNote = session.storage === "ephemeral"
    ? h("div", { class: "banner warn", role: "note", style: { margin: "16px 0 0" } }, iconEl("info"),
        h("span", { class: "small" }, "Demo server: accounts and entries can be reset when it restarts. Export your journal from Settings to keep a copy."))
    : null;
  const card = h("div", { class: "auth-card" }, heading, lead, demoNote, tabs, form,
    upgrading ? [upgradeNote, backBtn] : [guestBlock, foot]);
  const panel = h("section", { class: "auth-panel" }, h("div", { class: "auth-top" }, themeBtn), card);
  root.append(h("div", { class: "auth" }, art, panel));

  // ----------------------------------------------------------- mode switching
  function setMode(next, focus = true) {
    mode = next;
    const register = mode === "register";
    heading.textContent = upgrading ? "Save your journal" : register ? "Create your account" : "Welcome back";
    lead.textContent = upgrading
      ? "Create an account to keep your entries safe and open them on any device."
      : register ? "Start a private journal you can open from any device." : "Sign in to continue your journal.";
    tabs.replaceChildren(...[["signin", "Sign in"], ["register", "Create account"]].map(([key, label]) => h("button", {
      type: "button", role: "tab", "aria-selected": String(mode === key), disabled: upgrading && key === "signin",
      onclick: () => { if (mode !== key) setMode(key); },
    }, label)));
    tabs.hidden = upgrading;
    name.el.hidden = !register;
    password.setMode(register);
    submit.innerHTML = `<span>${register ? (upgrading ? "Create account and keep my entries" : "Create account") : "Sign in"}</span>${icon("arrowRight")}`;
    clearErrors();
    history.replaceState(null, "", `#/sign-in${register && !upgrading ? "?mode=register" : ""}`);
    if (focus) requestAnimationFrame(() => (register && !upgrading ? name.input : email.input).focus());
  }

  function clearErrors() {
    alertBox.hidden = true;
    [email, name, password].forEach((f) => f.setError(""));
  }

  function showAlert(message) {
    alertBox.replaceChildren(iconEl("alert"), h("span", {}, message));
    alertBox.hidden = false;
  }

  function validate() {
    clearErrors();
    let ok = true;
    const e = email.input.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)) { email.setError("Enter a valid email address."); ok = false; }
    const p = password.input.value;
    if (!p) { password.setError("Enter your password."); ok = false; }
    else if (mode === "register") {
      if (p.length < 8) { password.setError("Use at least 8 characters."); ok = false; }
      else if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) { password.setError("Include at least one letter and one number."); ok = false; }
    }
    if (!ok) (email.el.classList.contains("invalid") ? email.input : password.input).focus();
    return ok;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    const register = mode === "register";
    setBusy(submit, true, register ? "Creating your account…" : "Signing in…");
    try {
      if (register) {
        const result = await session.register(email.input.value.trim(), password.input.value, name.input.value.trim());
        toast(result.upgraded ? "Account created, journal saved" : "Welcome aboard", {
          type: "success",
          message: result.upgraded ? "Your guest entries are now part of your account." : "Your private journal is ready.",
        });
        navigate(result.upgraded ? "dashboard" : "check-in");
      } else {
        const profile = await session.signIn(email.input.value.trim(), password.input.value);
        toast(`Welcome back${profile.display_name ? `, ${profile.display_name}` : ""}`, { type: "success" });
        navigate("dashboard");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
        const map = { email, password, display_name: name };
        err.details.forEach((d) => map[d.field]?.setError(d.message));
      } else if (err instanceof ApiError && err.status === 409 && register && !upgrading) {
        setMode("signin", false);
        showAlert("An account with this email already exists. Sign in instead.");
        password.input.focus();
      } else {
        showAlert(err.message);
      }
      setBusy(submit, false);
    }
  });

  guestBtn.addEventListener("click", async () => {
    guestBtn.disabled = true;
    guestBtn.querySelector(".arrow").innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    try {
      await session.startGuest();
      navigate("dashboard");
    } catch (err) {
      showAlert(err.message);
      guestBtn.disabled = false;
      guestBtn.querySelector(".arrow").innerHTML = icon("arrowRight");
    }
  });

  restoreLink.addEventListener("click", () => openRestore(navigate));

  setMode(mode, false);
  requestAnimationFrame(() => (upgrading || mode === "signin" ? email.input : name.input).focus({ preventScroll: true }));
}

function textField({ id, label, type, icon: ic, ...attrs }) {
  const input = h("input", { id, class: "input", type, ...attrs });
  const err = h("p", { class: "field-error", role: "alert" });
  const el = h("div", { class: "field" }, h("label", { class: "label", for: id }, label),
    h("div", { class: "input-icon" }, iconEl(ic), input), err);
  return {
    el, input,
    setError(msg) { err.textContent = msg; el.classList.toggle("invalid", !!msg); input.setAttribute("aria-invalid", String(!!msg)); },
  };
}

function passwordField() {
  const input = h("input", { id: "auth-password", class: "input", type: "password", autocomplete: "current-password", maxlength: 128, placeholder: "Your password" });
  const toggle = h("button", { type: "button", class: "pw-toggle", "aria-label": "Show password", html: icon("eye") });
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.innerHTML = icon(show ? "eyeOff" : "eye");
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
  const meter = h("div", { class: "strength", "aria-hidden": "true" }, h("span"), h("span"), h("span"), h("span"));
  const meterLabel = h("p", { class: "strength-label", "aria-live": "polite" });
  const meterWrap = h("div", { hidden: true }, meter, meterLabel);
  const err = h("p", { class: "field-error", role: "alert" });
  const labelText = h("span", {}, "Password");
  const el = h("div", { class: "field" }, h("label", { class: "label", for: "auth-password" }, labelText),
    h("div", { class: "pw-wrap input-icon" }, iconEl("lock"), input, toggle), meterWrap, err);

  input.addEventListener("input", () => {
    const v = input.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (/[A-Za-z]/.test(v) && /\d/.test(v)) score++;
    if (v.length >= 12) score++;
    if (/[^A-Za-z0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v))) score++;
    meter.dataset.level = v ? String(Math.max(1, score)) : "0";
    meterLabel.textContent = v ? ["Too weak", "Too weak", "Fair", "Good", "Strong"][score] : "Use 8+ characters with a letter and a number.";
    if (err.textContent) { err.textContent = ""; el.classList.remove("invalid"); }
  });

  return {
    el, input,
    setMode(register) {
      meterWrap.hidden = !register;
      input.autocomplete = register ? "new-password" : "current-password";
      input.placeholder = register ? "At least 8 characters" : "Your password";
      if (register && !input.value) meterLabel.textContent = "Use 8+ characters with a letter and a number.";
    },
    setError(msg) { err.textContent = msg; el.classList.toggle("invalid", !!msg); input.setAttribute("aria-invalid", String(!!msg)); },
  };
}

function openRestore(navigate) {
  const input = h("input", { class: "input", placeholder: "mhp_…", autocomplete: "off", spellcheck: "false", "aria-label": "Recovery key" });
  const err = h("p", { class: "field-error mt-8", role: "alert" });
  const go = button("Open journal", { variant: "primary" });
  const cancel = button("Cancel");
  const m = modal({
    title: "Open a guest journal", size: "sm",
    body: h("div", {}, h("p", { class: "small muted", style: { marginBottom: "12px" } }, "Paste the recovery key from Settings on your other device."), input, err),
    footer: [cancel, go],
  });
  cancel.addEventListener("click", m.close);
  const submit = async () => {
    const key = input.value.trim();
    if (!/^mhp_[A-Za-z0-9_-]{20,}$/.test(key)) { err.textContent = "That doesn't look like a recovery key."; return; }
    setBusy(go, true, "Checking…");
    try {
      await session.restore(key);
      m.close();
      toast("Journal opened", { type: "success" });
      navigate("dashboard");
    } catch (e) {
      err.textContent = e.status === 401 ? "No journal matches that key." : e.message;
      setBusy(go, false);
    }
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  requestAnimationFrame(() => input.focus());
}
