import { downloadExport } from "./export.js";
import { api } from "../api.js";
import {
  h, icon, iconEl, clear, button, toast, modal, confirmDialog, dropdown, fmt, riskBadge, emotionBadge,
  debounce, skeleton, emptyState, errorState, EMOTION_META,
} from "../ui.js";
import { factorList } from "./checkin.js";

const SORTS = [
  ["newest", "Newest first"], ["oldest", "Oldest first"],
  ["risk_desc", "Highest risk"], ["risk_asc", "Lowest risk"],
  ["sentiment_desc", "Most positive"], ["sentiment_asc", "Most negative"],
];
const PAGE_SIZE = 10;

export function render(root, { params, isCurrent }) {
  const state = {
    q: params.get("q") || "",
    risk: ["Low", "Medium", "High"].includes(params.get("risk")) ? params.get("risk") : "",
    emotion: Object.keys(EMOTION_META).includes(params.get("emotion")) ? params.get("emotion") : "",
    tag: params.get("tag") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    sort: SORTS.some(([k]) => k === params.get("sort")) ? params.get("sort") : "newest",
    page: Math.min(10_000, Math.max(1, Math.floor(Number(params.get("page"))) || 1)),
  };
  let requestSeq = 0;

  // ------------------------------------------------------------ toolbar
  const search = h("input", { class: "input", type: "search", placeholder: "Search your entries…", value: state.q, "aria-label": "Search entries", maxlength: 100 });
  const riskSel = select("Risk level", [["", "All risk levels"], ["Low", "Low risk"], ["Medium", "Medium risk"], ["High", "High risk"]], state.risk);
  const emoSel = select("Feeling", [["", "All feelings"], ...Object.entries(EMOTION_META).map(([k, m]) => [k, m.label])], state.emotion);
  const tagSel = select("Tag", [["", "All tags"]], state.tag);
  const sortSel = select("Sort", SORTS, state.sort);
  const from = h("input", { class: "input", type: "date", value: state.from, "aria-label": "From date", max: fmt.localDate() });
  const to = h("input", { class: "input", type: "date", value: state.to, "aria-label": "To date", max: fmt.localDate() });
  const clearBtn = button("Clear filters", { variant: "ghost", size: "sm", icon: "x" });
  const summary = h("span", { class: "tabular" });

  const exportBtn = button("Export", { size: "sm", icon: "download" });
  const exportMenu = dropdown(exportBtn, [
    { label: "Download CSV (spreadsheet)", icon: "file", onSelect: () => downloadExport("csv") },
    { label: "Download JSON (full backup)", icon: "file", onSelect: () => downloadExport("json") },
  ]);

  const listHost = h("div");
  const card = h("section", { class: "card flush" },
    h("div", { class: "toolbar" },
      h("div", { class: "input-icon search" }, iconEl("search"), search),
      riskSel, emoSel, tagSel, sortSel),
    h("div", { class: "toolbar-2" },
      h("span", {}, "From"), from, h("span", {}, "to"), to, clearBtn,
      h("span", { class: "spacer" }), summary),
    listHost);

  root.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Journal"), h("p", {}, "Every check-in you've saved, searchable and filterable.")),
      h("div", { class: "row" }, exportMenu, h("a", { class: "btn btn-primary btn-sm", href: "#/check-in", html: `${icon("plus")}<span>New check-in</span>` }))),
    card);

  // ------------------------------------------------------------ events
  const onSearch = debounce(() => { state.q = search.value.trim(); state.page = 1; load(); }, 350);
  search.addEventListener("input", onSearch);
  riskSel.addEventListener("change", () => { state.risk = riskSel.value; state.page = 1; load(); });
  emoSel.addEventListener("change", () => { state.emotion = emoSel.value; state.page = 1; load(); });
  tagSel.addEventListener("change", () => { state.tag = tagSel.value; state.page = 1; load(); });
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; state.page = 1; load(); });
  const onDate = () => {
    if (from.value && to.value && from.value > to.value) {
      toast("Check the dates", { type: "warn", message: "The start date must be on or before the end date." });
      return;
    }
    state.from = from.value; state.to = to.value; state.page = 1; load();
  };
  from.addEventListener("change", onDate);
  to.addEventListener("change", onDate);
  clearBtn.addEventListener("click", () => {
    Object.assign(state, { q: "", risk: "", emotion: "", tag: "", from: "", to: "", sort: "newest", page: 1 });
    search.value = ""; riskSel.value = ""; emoSel.value = ""; tagSel.value = ""; sortSel.value = "newest"; from.value = ""; to.value = "";
    load();
  });

  function hasFilters() { return !!(state.q || state.risk || state.emotion || state.tag || state.from || state.to); }

  function syncUrl() {
    const p = new URLSearchParams();
    for (const k of ["q", "risk", "emotion", "tag", "from", "to"]) if (state[k]) p.set(k, state[k]);
    if (state.sort !== "newest") p.set("sort", state.sort);
    if (state.page > 1) p.set("page", String(state.page));
    const qs = p.toString();
    history.replaceState(null, "", `#/journal${qs ? `?${qs}` : ""}`);
  }

  async function loadTags() {
    try {
      const { tags } = await api.tags();
      for (const t of tags) tagSel.append(h("option", { value: t }, t));
      if (state.tag && !tags.includes(state.tag)) tagSel.append(h("option", { value: state.tag }, state.tag));
      tagSel.value = state.tag;
    } catch { /* tag list is optional */ }
  }

  async function load() {
    const seq = ++requestSeq;
    syncUrl();
    clearBtn.hidden = !hasFilters();
    clear(listHost).append(listSkeleton());
    summary.textContent = "Loading…";
    let data;
    try {
      data = await api.entries({
        q: state.q, risk: state.risk || undefined, emotion: state.emotion || undefined, tag: state.tag,
        from: state.from, to: state.to, sort: state.sort, page: state.page, page_size: PAGE_SIZE,
      });
    } catch (err) {
      if (seq !== requestSeq || !isCurrent()) return;
      summary.textContent = "";
      clear(listHost).append(errorState(err.message, load));
      return;
    }
    if (seq !== requestSeq || !isCurrent()) return;
    if (data.page > data.pages && data.total > 0) { state.page = data.pages; load(); return; }

    const start = data.total ? (data.page - 1) * data.page_size + 1 : 0;
    const end = Math.min(data.total, data.page * data.page_size);
    summary.textContent = data.total ? `${start}–${end} of ${data.total} ${data.total === 1 ? "entry" : "entries"}` : "";
    clear(listHost);

    if (!data.items.length) {
      listHost.append(hasFilters()
        ? emptyState({ image: "empty-journal", title: "No matching entries", text: "Try a different search term or clear some filters.", action: button("Clear filters", { onclick: () => clearBtn.click() }), compact: true })
        : emptyState({ image: "empty-journal", title: "Your journal is empty", text: "Your first check-in will appear here. It only takes a couple of minutes.", action: h("a", { class: "btn btn-primary", href: "#/check-in" }, "Write your first entry") }));
      return;
    }
    listHost.append(table(data.items), cards(data.items), pagination(data));
  }

  function table(items) {
    return h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Entry"), h("th", { scope: "col" }, "Feeling"),
        h("th", { scope: "col" }, "Risk"), h("th", { scope: "col", class: "num" }, "Sleep"), h("th", { scope: "col", class: "num" }, "Screen"),
        h("th", { scope: "col", class: "num" }, "Steps"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
      h("tbody", {}, items.map((e) => {
        const del = h("button", { class: "btn btn-ghost icon-btn", "aria-label": "Delete entry", title: "Delete", html: icon("trash") });
        del.addEventListener("click", (ev) => { ev.stopPropagation(); remove(e); });
        const row = h("tr", { tabindex: "0", "aria-label": `Open entry from ${fmt.dateTime(e.created_at)}` },
          h("td", { class: "date-cell" }, h("strong", {}, fmt.date(e.created_at, { month: "short", day: "numeric" })), h("span", {}, fmt.time(e.created_at))),
          h("td", {}, h("span", { class: "excerpt" }, e.journal),
            e.tags.length ? h("div", { class: "row wrap mt-8", style: { gap: "6px" } }, e.tags.map((t) => h("span", { class: "tag" }, t))) : null),
          h("td", {}, emotionBadge(e.emotion)),
          h("td", {}, riskBadge(e.risk_level)),
          h("td", { class: "num" }, `${e.sleep_hours} h`),
          h("td", { class: "num" }, `${e.screen_time} h`),
          h("td", { class: "num" }, fmt.num(e.activity_level)),
          h("td", { class: "actions-cell" }, del));
        row.addEventListener("click", () => openEntry(e.id));
        row.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openEntry(e.id); });
        return row;
      }))));
  }

  function cards(items) {
    return h("div", { class: "entry-cards" }, items.map((e) => h("button", { class: "entry-card", type: "button", onclick: () => openEntry(e.id) },
      h("div", { class: "row-between" }, h("strong", { class: "small" }, fmt.dateTime(e.created_at)), riskBadge(e.risk_level)),
      h("p", { class: "excerpt mt-8" }, e.journal),
      h("div", { class: "meta" }, emotionBadge(e.emotion),
        h("span", { class: "xs subtle tabular" }, `${e.sleep_hours}h sleep · ${e.screen_time}h screen · ${fmt.num(e.activity_level)} steps`)))));
  }

  function pagination(data) {
    const go = (p) => { state.page = p; load(); card.scrollIntoView({ behavior: "smooth", block: "start" }); };
    const pages = [];
    const windowStart = Math.max(1, Math.min(data.page - 2, data.pages - 4));
    for (let p = windowStart; p <= Math.min(data.pages, windowStart + 4); p++) pages.push(p);
    return h("div", { class: "pagination" },
      h("span", {}, `Page ${data.page} of ${data.pages}`),
      h("nav", { class: "pages", "aria-label": "Pagination" },
        h("button", { class: "page-btn", disabled: data.page <= 1, "aria-label": "Previous page", onclick: () => go(data.page - 1), html: icon("chevronLeft") }),
        pages.map((p) => h("button", { class: "page-btn", "aria-current": p === data.page ? "page" : null, onclick: () => go(p) }, String(p))),
        h("button", { class: "page-btn", disabled: data.page >= data.pages, "aria-label": "Next page", onclick: () => go(data.page + 1), html: icon("chevronRight") })));
  }

  async function openEntry(id) {
    const bodyHost = h("div", { "aria-busy": "true" }, skeleton("sk-title"), skeleton("sk-block mt-16"));
    const delBtn = button("Delete", { variant: "ghost", icon: "trash" });
    const closeBtn = button("Close", { variant: "primary" });
    const m = modal({ title: "Journal entry", body: bodyHost, footer: [delBtn, closeBtn] });
    closeBtn.addEventListener("click", m.close);
    try {
      const e = await api.entry(id);
      delBtn.addEventListener("click", async () => { if (await remove(e)) m.close(); });
      clear(bodyHost).removeAttribute("aria-busy");
      bodyHost.append(
        h("p", { class: "small subtle" }, fmt.dateTime(e.created_at)),
        h("div", { class: "row wrap mt-8" }, riskBadge(e.risk_level), emotionBadge(e.emotion), e.tags.map((t) => h("span", { class: "tag" }, t))),
        h("div", { class: "modal-journal mt-16" }, e.journal),
        h("div", { class: "stat-row mt-16" },
          stat("Sleep", `${e.sleep_hours} h`), stat("Screen time", `${e.screen_time} h`), stat("Steps", fmt.num(e.activity_level))),
        h("p", { class: "mt-16" }, e.explanation),
        h("p", { class: "small subtle mt-8" }, `Tone ${e.sentiment_score > 0 ? "+" : ""}${e.sentiment_score} · Confidence ${e.confidence}%`),
        e.factors.length ? h("div", { class: "mt-16" }, h("h3", { class: "card-title" }, "What influenced this"), factorList(e.factors)) : null);
    } catch (err) {
      clear(bodyHost).append(errorState(err.status === 404 ? "This entry no longer exists." : err.message));
      delBtn.hidden = true;
    }
  }

  async function remove(entry) {
    const ok = await confirmDialog({
      title: "Delete this entry?",
      message: `The check-in from ${fmt.dateTime(entry.created_at)} will be permanently removed. This can't be undone.`,
      confirmLabel: "Delete entry", danger: true,
    });
    if (!ok) return false;
    try {
      await api.deleteEntry(entry.id);
      toast("Entry deleted", { type: "success" });
      load();
      return true;
    } catch (err) {
      toast("Couldn't delete entry", { type: "error", message: err.message });
      return false;
    }
  }

  loadTags();
  load();
  const openId = Number(params.get("open"));
  if (Number.isSafeInteger(openId) && openId > 0) {
    openEntry(openId);
  }
}

function select(label, options, value) {
  const el = h("select", { class: "select", "aria-label": label }, options.map(([v, t]) => h("option", { value: v }, t)));
  el.value = value;
  return el;
}

function stat(label, value) {
  return h("div", { class: "stat-mini" }, h("span", {}, label), h("strong", {}, value));
}

function listSkeleton() {
  return h("div", { style: { padding: "8px 16px" }, "aria-busy": "true", "aria-label": "Loading entries" },
    [1, 2, 3, 4, 5].map(() => h("div", { class: "row", style: { padding: "14px 0", gap: "16px" } },
      h("div", { class: "skeleton sk-line", style: { width: "72px" } }), h("div", { style: { flex: 1 } }, skeleton("sk-line"), h("div", { class: "skeleton sk-line", style: { width: "55%" } })))));
}
