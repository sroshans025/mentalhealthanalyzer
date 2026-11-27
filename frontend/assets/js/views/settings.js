import { downloadExport } from "./export.js";
import { confirmAndSignOut } from "./account.js";
import { api, ApiError, tokenStore } from "../api.js";
import { session, theme } from "../session.js";
import { h, icon, iconEl, button, setBusy, toast, confirmDialog, modal, fmt } from "../ui.js";

export function render(root, { navigate }) {
  const p = session.profile;

  // ----------------------------------------------------------- profile + goals
  const name = field("display_name", "Display name", h("input", { class: "input", maxlength: 40, value: p.display_name || "", placeholder: "Optional", autocomplete: "nickname" }), "Used for your dashboard greeting.");
  const sleepGoal = field("sleep_goal", "Sleep goal", suffix(h("input", { class: "input", type: "number", min: 4, max: 12, step: 0.5, value: p.sleep_goal }), "h"), "Between 4 and 12 hours.");
  const screenLimit = field("screen_limit", "Screen time limit", suffix(h("input", { class: "input", type: "number", min: 0.5, max: 16, step: 0.5, value: p.screen_limit }), "h"), "Between 0.5 and 16 hours.");
  const stepGoal = field("step_goal", "Step goal", h("input", { class: "input", type: "number", min: 1000, max: 50000, step: 500, value: p.step_goal }), "Between 1,000 and 50,000.");
  const saveBtn = button("Save changes", { variant: "primary", type: "submit" });

  const profileForm = h("form", { novalidate: true, class: "stack" },
    name.el, h("div", { class: "form-grid" }, sleepGoal.el, screenLimit.el, stepGoal.el),
    h("div", {}, saveBtn));

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const checks = [
      [sleepGoal, 4, 12], [screenLimit, 0.5, 16], [stepGoal, 1000, 50000],
    ];
    let ok = true;
    for (const [f, min, max] of checks) {
      const v = Number(f.input.value);
      const valid = f.input.value !== "" && v >= min && v <= max;
      f.setError(valid ? "" : `Enter a value between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
      ok = ok && valid;
    }
    if (!ok) return;
    setBusy(saveBtn, true, "Saving…");
    try {
      const updated = await api.updateProfile({
        display_name: name.input.value.trim(),
        sleep_goal: Number(sleepGoal.input.value),
        screen_limit: Number(screenLimit.input.value),
        step_goal: Math.round(Number(stepGoal.input.value)),
      });
      session.setProfile(updated);
      toast("Settings saved", { type: "success", message: "Your goals now shape your dashboard and insights." });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map = { display_name: name, sleep_goal: sleepGoal, screen_limit: screenLimit, step_goal: stepGoal };
        err.details.forEach((d) => map[d.field]?.setError(d.message));
      }
      toast("Couldn't save settings", { type: "error", message: err.message });
    } finally {
      setBusy(saveBtn, false);
    }
  });

  // ----------------------------------------------------------- appearance
  const themeOpts = [["system", "System", "monitor"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];
  const themeGroup = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Theme" });
  const paintTheme = () => {
    themeGroup.replaceChildren(...themeOpts.map(([value, label, ic]) => h("button", {
      type: "button", class: "seg-opt", role: "radio", "aria-checked": String(theme.get() === value),
      onclick: () => { theme.set(value); paintTheme(); },
    }, iconEl(ic), label)));
  };
  paintTheme();

  // ----------------------------------------------------------- privacy / key
  let revealed = false;
  const keyCode = h("code", {});
  const paintKey = () => {
    const k = tokenStore.get() || "";
    keyCode.textContent = revealed ? k : `${k.slice(0, 8)}${"•".repeat(24)}`;
  };
  paintKey();
  const revealBtn = button("", { size: "sm", class: "icon-btn", "aria-label": "Show recovery key", html: icon("eye") });
  revealBtn.addEventListener("click", () => {
    revealed = !revealed; paintKey();
    revealBtn.innerHTML = icon(revealed ? "eyeOff" : "eye");
    revealBtn.setAttribute("aria-label", revealed ? "Hide recovery key" : "Show recovery key");
  });
  const copyBtn = button("Copy", { size: "sm", icon: "copy" });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(tokenStore.get() || "");
      toast("Recovery key copied", { type: "success", message: "Store it somewhere safe, like a password manager." });
    } catch {
      revealed = true; paintKey();
      toast("Copy isn't available", { type: "warn", message: "The key is now shown so you can copy it manually." });
    }
  });

  const restoreBtn = button("Use a recovery key", { size: "sm", icon: "key", onclick: openRestore });
  const exportCsv = button("Export CSV", { size: "sm", icon: "download", onclick: () => downloadExport("csv") });
  const exportJson = button("Export JSON", { size: "sm", icon: "download", onclick: () => downloadExport("json") });
  const deleteBtn = button(p.has_account ? "Delete account" : "Delete all my data", { variant: "danger", size: "sm", icon: "trash", onclick: deleteAll });

  const signOutBtn = button(p.has_account ? "Sign out" : "Leave guest journal", { size: "sm", icon: "logOut", onclick: () => signOut() });
  const accountSection = p.has_account
    ? section("Account", "You can sign in with this email on any device.",
        h("div", { class: "row-between wrap", style: { gap: "14px" } },
          h("div", { class: "row" }, h("span", { class: "avatar", "aria-hidden": "true" }, (p.display_name || p.email)[0]),
            h("div", {}, h("strong", {}, p.display_name || p.email.split("@")[0]), h("p", { class: "small muted" }, p.email))),
          signOutBtn))
    : section("Account", "You're using a guest journal. It lives only in this browser unless you save your recovery key.",
        h("div", { class: "stack", style: { gap: "12px" } },
          h("div", { class: "upgrade-note", style: { marginTop: 0 }, html: icon("cloud") },
            h("span", {}, "Create an account to keep everything you've written and sign in from any device.")),
          h("div", { class: "row wrap" },
            h("a", { class: "btn btn-primary btn-sm", href: "#/sign-in?mode=register" }, "Create an account"),
            signOutBtn)));

  root.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Settings"), h("p", {}, "Personalise your goals, appearance and privacy."))),
    h("section", { class: "card" },
      accountSection,
      section("Profile & daily goals", "Goals are used for habit hints during check-in, goal tracking on the dashboard and personal insights.", profileForm),
      section("Appearance", "Choose a theme or follow your device setting.", themeGroup),
      p.has_account ? null : section("Recovery key", "Guest journals have no password. This key is the only way to open your journal on another device or browser. Keep it private.",
        h("div", { class: "stack", style: { gap: "12px" } },
          h("div", { class: "key-box" }, keyCode, revealBtn, copyBtn),
          h("p", { class: "small muted" }, `Journal started ${fmt.date(p.created_at)}.`),
          h("div", {}, restoreBtn))),
      section("Your data", "Download everything you've written, or erase it permanently.",
        h("div", { class: "stack", style: { gap: "14px" } },
          session.storage === "ephemeral"
            ? h("div", { class: "banner warn", style: { marginBottom: 0 } }, iconEl("info"),
                h("span", { class: "small" }, "This server is running without a permanent database, so entries can be lost when it restarts. Export regularly to keep a copy."))
            : null,
          h("div", { class: "row wrap" }, exportCsv, exportJson),
          h("div", { class: "danger-zone" },
            h("div", {}, h("strong", {}, p.has_account ? "Delete account and journal" : "Delete guest journal"), h("p", { class: "small muted" }, "Removes every entry, your goals and your profile from the server. This can't be undone.")),
            deleteBtn))),
      section("About", "", h("p", { class: "small muted" },
        "Mental Health Predictor combines the tone of your writing with sleep, screen time and activity to estimate a daily wellbeing risk level. It is designed for self-reflection and is not a medical or diagnostic tool. If you are worried about your mental health, please speak to a qualified professional."))));

  const signOut = () => confirmAndSignOut(navigate);

  function openRestore() {
    const input = h("input", { class: "input", placeholder: "mhp_…", autocomplete: "off", spellcheck: "false", "aria-label": "Recovery key" });
    const err = h("p", { class: "field-error mt-8", role: "alert" });
    const go = button("Switch profile", { variant: "primary" });
    const cancel = button("Cancel");
    const m = modal({
      title: "Open a journal with a recovery key", size: "sm",
      body: h("div", {}, h("p", { class: "small muted", style: { marginBottom: "12px" } }, "Paste the key from your other device. This browser will switch to that profile. Save your current key first if you want to come back to it."), input, err),
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
        toast("Profile restored", { type: "success", message: "You're now viewing that journal." });
        navigate("dashboard");
      } catch (e) {
        err.textContent = e.status === 401 ? "No profile matches that key." : e.message;
      } finally {
        setBusy(go, false);
      }
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    requestAnimationFrame(() => input.focus());
  }

  async function deleteAll() {
    const ok = await confirmDialog({
      title: "Delete everything?",
      message: "Your journal entries, goals and profile will be permanently erased from the server.",
      confirmLabel: "Delete permanently", danger: true, requireText: "DELETE",
    });
    if (!ok) return;
    setBusy(deleteBtn, true, "Deleting…");
    try {
      await api.deleteProfile();
      session.forget();
      toast("All data deleted", { type: "success", message: "Your journal and profile have been permanently removed." });
      navigate("sign-in");
    } catch (e) {
      toast("Couldn't delete data", { type: "error", message: e.message });
      setBusy(deleteBtn, false);
    }
  }
}

function section(title, text, content) {
  return h("div", { class: "settings-section" },
    h("div", {}, h("h2", {}, title), text ? h("p", {}, text) : null),
    h("div", {}, content));
}

function suffix(input, unit) {
  const wrap = h("div", { class: "input-suffix" }, input, h("span", {}, unit));
  wrap.input = input;
  return wrap;
}

function field(id, label, control, help) {
  const input = control.input || control;
  input.id = `f-${id}`;
  const err = h("p", { class: "field-error", role: "alert" });
  const el = h("div", { class: "field" }, h("label", { class: "label", for: input.id }, label), control, help ? h("p", { class: "field-help" }, help) : null, err);
  return {
    el, input,
    setError(msg) { err.textContent = msg; el.classList.toggle("invalid", !!msg); input.setAttribute("aria-invalid", String(!!msg)); },
  };
}
