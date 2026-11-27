import { api, ApiError } from "../api.js";
import { session } from "../session.js";
import {
  h, icon, iconEl, clear, button, setBusy, toast, riskBadge, emotionBadge, debounce, illustration, EMOTION_META,
} from "../ui.js";
import { supportCard } from "./support.js";

const PRESET_TAGS = ["work", "study", "family", "friends", "exercise", "health", "sleep", "money", "relationship", "self-care"];
const DRAFT_KEY = "mhp.draft";
const MAX_CHARS = 5000;

export function render(root, { navigate }) {
  const profile = session.profile;
  const draft = loadDraft();
  const selectedTags = new Set(draft.tags || []);

  // ------------------------------------------------------------- inputs
  const journal = h("textarea", {
    id: "journal", class: "textarea", rows: 7, maxlength: MAX_CHARS, required: true,
    placeholder: "How was your day? What took up most of your energy, and how did it leave you feeling?",
    "aria-describedby": "journal-help journal-error",
  });
  journal.value = draft.journal || "";
  const counter = h("span", { class: "hint tabular" });
  const journalError = h("p", { id: "journal-error", class: "field-error", role: "alert" });
  const journalField = h("div", { class: "field" },
    h("label", { class: "label", for: "journal" }, "Your reflection", counter),
    journal, journalError);

  const toneText = h("span", {}, "Start writing to see the tone of your entry.");
  const toneDot = h("i", { style: { left: "50%" } });
  const tone = h("div", { class: "tone-preview", id: "journal-help", "aria-live": "polite" }, toneText, h("div", { class: "tone-bar", "aria-hidden": "true" }, toneDot));
  let crisisShown = false;
  const crisisSlot = h("div");

  const sleep = sliderField({ id: "sleep", label: "Sleep", unit: "h", icon: "bed", min: 0, max: 14, step: 0.5, value: draft.sleep_hours ?? 7.5,
    hint: (v) => v >= profile.sleep_goal ? ["ok", `Meets your ${profile.sleep_goal}h goal`] : ["off", `${(profile.sleep_goal - v).toFixed(1)}h below your ${profile.sleep_goal}h goal`] });
  const screen = sliderField({ id: "screen", label: "Screen time", unit: "h", icon: "phone", min: 0, max: 18, step: 0.5, value: draft.screen_time ?? 4,
    hint: (v) => v <= profile.screen_limit ? ["ok", `Within your ${profile.screen_limit}h limit`] : ["off", `${(v - profile.screen_limit).toFixed(1)}h over your ${profile.screen_limit}h limit`] });
  const steps = sliderField({ id: "steps", label: "Steps", unit: "", icon: "walk", min: 0, max: 30000, step: 250, value: draft.activity_level ?? 5000, integer: true,
    hint: (v) => v >= profile.step_goal ? ["ok", `Reached your ${profile.step_goal.toLocaleString()} step goal`] : ["off", `${(profile.step_goal - v).toLocaleString()} steps to your goal`] });

  const tagWrap = h("div", { class: "chips", role: "group", "aria-label": "Tags" });
  const customTag = h("input", { class: "input", placeholder: "Add a tag", maxlength: 24, "aria-label": "Custom tag" });
  const tagError = h("p", { class: "field-error" });
  function renderTags() {
    clear(tagWrap);
    const all = [...new Set([...PRESET_TAGS, ...selectedTags])];
    for (const t of all) {
      const pressed = selectedTags.has(t);
      tagWrap.append(h("button", {
        type: "button", class: "chip-toggle", "aria-pressed": String(pressed),
        onclick: () => { pressed ? selectedTags.delete(t) : selectedTags.add(t); renderTags(); saveDraft(); },
        html: pressed ? icon("check") : "",
      }, t));
    }
  }
  function addCustomTag() {
    const t = customTag.value.trim().toLowerCase().replace(/\s+/g, " ");
    tagError.textContent = "";
    if (!t) return;
    if (!/^[a-z0-9][a-z0-9 -]{0,22}[a-z0-9]$|^[a-z0-9]$/.test(t)) { tagError.textContent = "Use letters, numbers, spaces or dashes (up to 24 characters)."; return; }
    if (selectedTags.size >= 8 && !selectedTags.has(t)) { tagError.textContent = "You can add up to 8 tags."; return; }
    selectedTags.add(t); customTag.value = ""; renderTags(); saveDraft();
  }
  customTag.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } });
  renderTags();

  const submit = button("Analyse and save", { variant: "primary", size: "lg", type: "submit", icon: "spark", class: "btn-block" });
  const resetBtn = button("Clear", { variant: "ghost", onclick: () => { journal.value = ""; selectedTags.clear(); renderTags(); updateCount(); clearDraft(); updateTone(); journal.focus(); } });

  const form = h("form", { class: "card stack", novalidate: true },
    h("div", {}, h("h2", { class: "card-title" }, "Today's check-in"), h("p", { class: "card-sub" }, "Everything you write stays in your private profile.")),
    journalField, tone, crisisSlot,
    h("div", {}, h("p", { class: "label" }, "Daily habits"), h("div", { class: "mt-8" }, sleep.el, screen.el, steps.el)),
    h("div", { class: "field" },
      h("p", { class: "label" }, "Tags", h("span", { class: "hint" }, "Optional · helps you filter and spot patterns")),
      tagWrap,
      h("div", { class: "chip-add mt-8" }, customTag, button("Add", { size: "sm", onclick: addCustomTag })),
      tagError),
    h("div", { class: "row" }, submit, resetBtn));

  const resultPane = h("div", { class: "stack", "aria-live": "polite" }, placeholder());

  root.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "New check-in"), h("p", {}, "Take a moment to reflect. There are no right or wrong answers."))),
    h("div", { class: "grid grid-checkin" }, form, resultPane));

  // ------------------------------------------------------------- behaviour
  function updateCount() {
    const n = journal.value.length;
    counter.textContent = `${n.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
  }
  updateCount();

  const updateTone = debounce(async () => {
    const text = journal.value.trim();
    if (text.length < 3) {
      toneText.textContent = "Start writing to see the tone of your entry.";
      toneDot.style.left = "50%";
      return;
    }
    try {
      const r = await api.analyze(text);
      const word = r.sentiment_score > 0.15 ? "positive" : r.sentiment_score < -0.05 ? "negative" : "neutral";
      toneText.textContent = `Tone: ${word} · ${EMOTION_META[r.emotion]?.label || r.emotion}`;
      toneDot.style.left = `${((r.sentiment_score + 1) / 2) * 100}%`;
      if (r.crisis_flag && !crisisShown) {
        crisisShown = true;
        clear(crisisSlot).append(supportCard({ urgent: true }));
      }
    } catch { /* the preview is best-effort; the save will surface real errors */ }
  }, 600);

  journal.addEventListener("input", () => {
    updateCount();
    if (journalError.textContent) validateJournal();
    updateTone();
    saveDraftDebounced();
  });
  [sleep, screen, steps].forEach((f) => f.onChange(() => saveDraftDebounced()));
  if (journal.value) updateTone();

  function validateJournal() {
    const text = journal.value.trim();
    let msg = "";
    if (text.replace(/\s/g, "").length < 3) msg = "Write at least a few words about your day.";
    else if (text.length > MAX_CHARS) msg = `Please keep it under ${MAX_CHARS.toLocaleString()} characters.`;
    journalError.textContent = msg;
    journalField.classList.toggle("invalid", !!msg);
    journal.setAttribute("aria-invalid", String(!!msg));
    return !msg;
  }

  function currentPayload() {
    return {
      journal: journal.value.trim(),
      sleep_hours: sleep.value(),
      screen_time: screen.value(),
      activity_level: Math.round(steps.value()),
      tags: [...selectedTags],
    };
  }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(currentPayload())); } catch { /* ignore */ } }
  const saveDraftDebounced = debounce(saveDraft, 400);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateJournal()) { journal.focus(); return; }
    if (![sleep, screen, steps].every((f) => f.validate())) return;
    setBusy(submit, true, "Analysing…");
    clear(resultPane).append(loadingResult());
    try {
      const entry = await api.createEntry(currentPayload());
      clearDraft();
      clear(resultPane).append(resultView(entry, navigate, () => {
        journal.value = ""; selectedTags.clear(); renderTags(); updateCount(); updateTone();
        clear(crisisSlot); crisisShown = false;
        clear(resultPane).append(placeholder());
        journal.focus();
      }));
      toast("Check-in saved", { type: "success", message: `${entry.risk_level} risk · ${EMOTION_META[entry.emotion]?.label || entry.emotion}` });
      if (window.matchMedia("(max-width: 1024px)").matches) resultPane.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      clear(resultPane).append(placeholder());
      if (err instanceof ApiError && err.status === 409) {
        toast("Already saved", { type: "warn", message: err.message });
      } else if (err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
        const j = err.details.find((d) => d.field === "journal");
        if (j) { journalError.textContent = j.message; journalField.classList.add("invalid"); journal.focus(); }
        toast("Please check the form", { type: "error", message: err.message });
      } else {
        toast("Couldn't save your check-in", { type: "error", message: `${err.message} Your draft is kept on this device.` });
      }
    } finally {
      setBusy(submit, false);
    }
  });

  requestAnimationFrame(() => journal.focus({ preventScroll: true }));
}

function sliderField({ id, label, unit, icon: ic, min, max, step, value, hint, integer = false }) {
  const range = h("input", { type: "range", id: `${id}-range`, min, max, step, value, "aria-label": `${label} slider` });
  const number = h("input", { type: "number", id, class: "input tabular", min, max, step: integer ? 1 : 0.5, value, inputmode: integer ? "numeric" : "decimal" });
  const suffixed = unit ? h("div", { class: "input-suffix" }, number, h("span", {}, unit)) : number;
  const hintEl = h("p", { class: "goal-hint" }, h("span", { class: "dot" }), h("span"));
  const err = h("p", { class: "field-error", role: "alert" });
  const wrap = h("div", { class: "slider-field field" },
    h("label", { class: "label", for: id, html: `<span class="row" style="gap:8px">${icon(ic)}${label}</span>` }),
    h("div", { class: "slider-row" }, range, suffixed), hintEl, err);
  wrap.querySelector("svg").style.cssText = "width:16px;height:16px;color:var(--text-3)";
  const listeners = [];

  function paint() {
    const v = Number(range.value);
    range.style.setProperty("--pct", `${((v - min) / (max - min)) * 100}%`);
    const [cls, text] = hint(Number(number.value));
    hintEl.className = `goal-hint ${cls}`;
    hintEl.lastChild.textContent = text;
  }
  range.addEventListener("input", () => { number.value = range.value; err.textContent = ""; wrap.classList.remove("invalid"); paint(); listeners.forEach((f) => f()); });
  number.addEventListener("input", () => {
    const v = Number(number.value);
    if (number.value !== "" && v >= min && v <= max) { range.value = String(v); err.textContent = ""; wrap.classList.remove("invalid"); paint(); listeners.forEach((f) => f()); }
  });
  number.addEventListener("blur", () => validate());
  function validate() {
    const v = Number(number.value);
    const ok = number.value !== "" && Number.isFinite(v) && v >= min && v <= max;
    err.textContent = ok ? "" : `Enter a value between ${min} and ${max.toLocaleString()}.`;
    wrap.classList.toggle("invalid", !ok);
    if (!ok) number.focus();
    return ok;
  }
  paint();
  return { el: wrap, value: () => Number(number.value), validate, onChange: (f) => listeners.push(f) };
}

function placeholder() {
  return h("section", { class: "card placeholder-panel" },
    illustration("empty-journal", "", "", { eager: true }),
    h("h2", { class: "card-title" }, "Your analysis will appear here"),
    h("p", { class: "small muted", style: { maxWidth: "36ch" } }, "We look at the tone of your writing together with your sleep, screen time and movement, then explain what influenced the result."));
}

function loadingResult() {
  return h("section", { class: "card", "aria-busy": "true" },
    h("div", { class: "result-head" }, h("div", { class: "skeleton", style: { width: "104px", height: "104px", borderRadius: "50%" } }),
      h("div", { style: { flex: 1 } }, h("div", { class: "skeleton sk-title" }), h("div", { class: "skeleton sk-line", style: { width: "60%" } }))),
    h("div", { class: "skeleton sk-line mt-24" }), h("div", { class: "skeleton sk-line" }), h("div", { class: "skeleton sk-line", style: { width: "70%" } }),
    h("p", { class: "small muted mt-16" }, "Reading your reflection and weighing your habits…"));
}

export function factorList(factors) {
  const maxImpact = 0.4;
  return h("div", {}, factors.map((f) => h("div", { class: "factor" },
    h("span", { class: "factor-name" }, f.label),
    h("div", { class: "factor-track", title: `${Math.round(f.share * 100)}% of today's risk pressure` },
      h("span", { class: f.direction, style: { width: `${Math.max(3, (f.impact / maxImpact) * 100)}%` } })),
    h("span", { class: "factor-val" }, f.display),
    h("span", { class: "factor-note" }, f.note))));
}

function resultView(entry, navigate, onAnother) {
  const ring = h("div", { class: `risk-ring risk-${entry.risk_level}` },
    h("div", {}, h("div", {}, h("strong", {}, entry.risk_level), h("span", {}, "risk"))));
  ring.style.setProperty("--val", "0");
  requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty("--val", String(entry.confidence))));

  const probs = entry.probabilities || {};
  const pane = document.createDocumentFragment();
  if (entry.crisis_flag) pane.append(supportCard({ urgent: true }));
  pane.append(
    h("section", { class: "card" },
      h("div", { class: "result-head" }, ring,
        h("div", {},
          h("div", { class: "row wrap" }, riskBadge(entry.risk_level), emotionBadge(entry.emotion)),
          h("p", { class: "mt-8" }, entry.explanation),
          h("p", { class: "small subtle mt-8 tabular" },
            `Confidence ${entry.confidence}% · Low ${probs.Low ?? "–"}% · Medium ${probs.Medium ?? "–"}% · High ${probs.High ?? "–"}%`))),
      h("h3", { class: "card-title mt-24" }, "What influenced this"),
      h("p", { class: "card-sub" }, "Longer red bars added more risk. Green means the factor was working in your favour."),
      h("div", { class: "mt-8" }, factorList(entry.factors))),
    h("section", { class: "card" },
      h("h3", { class: "card-title" }, "Ideas for today"),
      h("ul", { class: "tips mt-12" }, (entry.suggestions || []).map((s) => h("li", { html: icon("lightbulb") }, s)))),
    h("div", { class: "row wrap" },
      button("Open in journal", { onclick: () => navigate("journal", { open: entry.id }), icon: "book" }),
      button("See dashboard", { onclick: () => navigate("dashboard"), icon: "home" }),
      button("New check-in", { variant: "ghost", onclick: onAnother, icon: "plus" })),
    h("p", { class: "xs subtle" }, "This is an estimate to support self-reflection, not a medical assessment."));
  return pane;
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch { return {}; }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

