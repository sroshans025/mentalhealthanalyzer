import { api } from "../api.js";
import { session } from "../session.js";
import { lineChart } from "../charts.js";
import {
  h, icon, iconEl, clear, fmt, riskBadge, emotionBadge, skeleton, illustration, errorState,
  emptyState, EMOTION_META,
} from "../ui.js";

const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];

const METRICS = {
  risk: {
    label: "Risk", pointLabel: "Average risk", key: "risk", yMin: 0.8, yMax: 3.2,
    format: (v) => (v < 1.5 ? "Low" : v < 2.5 ? "Medium" : "High") + ` (${v.toFixed(1)})`,
    yTicks: { stepSize: 1, callback: (v) => ({ 1: "Low", 2: "Medium", 3: "High" }[v] || "") },
    note: "Daily average of your check-in risk levels.",
  },
  sentiment: {
    label: "Journal tone", pointLabel: "Tone", key: "sentiment", yMin: -1, yMax: 1,
    format: (v) => (v > 0 ? "+" : "") + v.toFixed(2),
    yTicks: { stepSize: 0.5 },
    note: "From -1 (very negative) to +1 (very positive).",
  },
  sleep: {
    label: "Sleep", pointLabel: "Sleep", key: "sleep", yMin: 0, goalKey: "sleep_goal", goalLabel: "Sleep goal",
    format: (v) => `${v} h`, note: "Hours slept, with your goal as a dashed line.",
  },
  screen: {
    label: "Screen", pointLabel: "Screen time", key: "screen", yMin: 0, goalKey: "screen_limit", goalLabel: "Screen limit",
    format: (v) => `${v} h`, note: "Hours of screen time, with your limit as a dashed line.",
  },
  steps: {
    label: "Steps", pointLabel: "Steps", key: "steps", yMin: 0, goalKey: "step_goal", goalLabel: "Step goal",
    format: (v) => fmt.num(v), note: "Daily steps, with your goal as a dashed line.",
  },
};

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}

export function render(root, { navigate, isCurrent }) {
  const state = { days: 30, metric: "risk", chart: null };
  const name = session.profile?.display_name;

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("p", { class: "eyebrow" }, fmt.date(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric" })),
      h("h1", {}, `${greeting()}${name ? `, ${name}` : ""}`),
      h("p", {}, "Here's how your wellbeing has been trending.")));
  const body = h("div");
  root.append(head, body);

  async function load() {
    clear(body);
    body.append(loadingSkeleton());
    let stats, recent;
    try {
      [stats, recent] = await Promise.all([api.stats(state.days), api.entries({ page_size: 4 })]);
    } catch (err) {
      if (!isCurrent()) return;
      clear(body).append(errorState(err.message, load));
      return;
    }
    if (!isCurrent()) return;
    clear(body);
    if (stats.totals.all_time === 0) {
      body.append(welcome(navigate));
      return;
    }
    body.append(content(stats, recent.items));
  }

  function content(stats, recent) {
    const frag = document.createDocumentFragment();

    if (!stats.checked_in_today) {
      frag.append(h("div", { class: "banner", role: "status" }, iconEl("sunrise"),
        h("div", {}, h("strong", {}, "You haven't checked in today. "),
          h("span", { class: "muted" }, stats.streak ? `Keep your ${stats.streak}-day streak going.` : "A two-minute reflection is enough.")),
        h("a", { class: "btn btn-primary btn-sm", href: "#/check-in" }, "Check in now")));
    }

    const notice = storageNotice();
    if (notice) frag.append(notice);
    frag.append(kpis(stats));

    const chartCard = trendCard(stats);
    const side = h("div", { class: "stack" }, latestCard(stats), distributionCard(stats), emotionsCard(stats));
    frag.append(h("div", { class: "grid grid-main" }, h("div", { class: "stack" }, chartCard, recentCard(recent)), side));
    return frag;
  }

  function kpis(stats) {
    const a = stats.averages;
    const g = stats.goals;
    const change = stats.risk_change;
    const changeEl = change === null || change === undefined || Math.abs(change) < 0.05
      ? h("span", {}, "Similar to the previous period")
      : h("span", { class: `delta ${change < 0 ? "good" : "bad"}`, html: icon(change < 0 ? "trendDown" : "trendUp") + `<span>${change < 0 ? "Lower" : "Higher"} risk than previous ${state.days} days</span>` });
    const items = [
      { icon: "calendar", label: "Check-ins", value: fmt.num(stats.totals.in_range), unit: "", foot: changeEl },
      { icon: "flame", label: "Current streak", value: fmt.num(stats.streak), unit: stats.streak === 1 ? "day" : "days", foot: `Longest: ${stats.longest_streak} ${stats.longest_streak === 1 ? "day" : "days"}` },
      { icon: "bed", label: "Avg. sleep", value: a.sleep ?? "–", unit: "h", foot: `Goal met on ${g.sleep_met_pct ?? 0}% of days`, meter: g.sleep_met_pct },
      { icon: "walk", label: "Avg. steps", value: fmt.num(a.steps), unit: "", foot: `Goal met on ${g.steps_met_pct ?? 0}% of days`, meter: g.steps_met_pct },
    ];
    return h("section", { class: "kpis", "aria-label": "Key figures" },
      items.map((k) => h("div", { class: "card kpi" },
        h("div", { class: "kpi-label" }, iconEl(k.icon), k.label),
        h("div", { class: "kpi-value" }, String(k.value), k.unit ? h("small", {}, k.unit) : null),
        k.meter !== undefined ? h("div", { class: "meter", role: "progressbar", "aria-valuenow": k.meter ?? 0, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${k.label} goal adherence` }, h("span", { style: { width: `${k.meter ?? 0}%` } })) : null,
        h("div", { class: "kpi-foot" }, k.foot))));
  }

  function trendCard(stats) {
    const canvas = h("canvas", { role: "img", "aria-label": "Trend chart" });
    const box = h("div", { class: "chart-box" }, canvas);
    const note = h("p", { class: "card-sub" });
    const legend = h("div", { class: "chart-legend" });
    const tableToggle = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, "View as table");
    const tableWrap = h("div", { hidden: true });

    const metricTabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Metric" },
      Object.entries(METRICS).map(([key, m]) => h("button", {
        class: "tab", role: "tab", type: "button", "aria-selected": String(key === state.metric),
        onclick: () => { state.metric = key; drawChart(); syncTabs(metricTabs, key); },
        dataset: { key },
      }, m.label)));

    const rangeTabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Date range" },
      RANGES.map((r) => h("button", {
        class: "tab", role: "tab", type: "button", "aria-selected": String(r.days === state.days),
        dataset: { key: String(r.days) },
        onclick: () => { if (state.days !== r.days) { state.days = r.days; load(); } },
      }, r.label)));

    function drawChart() {
      const m = METRICS[state.metric];
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      const tl = stats.timeline;
      note.textContent = m.note;
      clear(legend);
      clear(box).append(canvas);
      if (!tl.length) {
        clear(box).append(emptyState({ title: "No check-ins in this range", text: "Try a longer range or add a check-in.", compact: true }));
        return;
      }
      const goal = m.goalKey ? stats.goals[m.goalKey] : null;
      legend.append(h("span", {}, h("i"), m.pointLabel));
      if (goal !== null) legend.append(h("span", {}, h("i", { class: "goal" }), `${m.goalLabel}: ${m.format(goal)}`));
      canvas.setAttribute("aria-label", `${m.pointLabel} over the last ${state.days} days`);
      const values = tl.map((d) => d[m.key]);
      const maxVal = Math.max(...values, goal || 0);
      lineChart(canvas, {
        labels: tl.map((d) => fmt.dayLabel(d.date)),
        values,
        yMin: m.yMin,
        yMax: m.yMax ?? (m.key === "steps" ? Math.ceil((maxVal * 1.15) / 2000) * 2000 : Math.ceil(maxVal * 1.15 + 0.5)),
        yTicks: m.yTicks,
        format: m.format,
        goal,
        goalLabel: m.goalLabel,
        pointLabel: m.pointLabel,
      }).then((c) => { if (isCurrent()) state.chart = c; else c.destroy(); })
        .catch(() => { clear(box).append(emptyState({ title: "Chart unavailable", text: "The chart library didn't load. Refresh to try again.", compact: true })); });

      clear(tableWrap).append(h("table", { class: "table mt-12" },
        h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", { class: "num" }, m.pointLabel), h("th", { class: "num" }, "Check-ins"))),
        h("tbody", {}, tl.slice().reverse().map((d) => h("tr", {}, h("td", {}, fmt.dayLabel(d.date)), h("td", { class: "num" }, m.format(d[m.key])), h("td", { class: "num" }, String(d.count)))))));
    }

    tableToggle.addEventListener("click", () => {
      tableWrap.hidden = !tableWrap.hidden;
      tableToggle.textContent = tableWrap.hidden ? "View as table" : "Hide table";
    });

    queueMicrotask(drawChart);
    return h("section", { class: "card" },
      h("div", { class: "card-head wrap" },
        h("div", {}, h("h2", { class: "card-title" }, "Wellbeing trend"), note),
        rangeTabs),
      h("div", { class: "row-between wrap", style: { marginBottom: "14px" } }, metricTabs, tableToggle),
      box, legend, tableWrap);
  }

  function latestCard(stats) {
    const l = stats.latest;
    return h("section", { class: "card" },
      h("div", { class: "card-head" }, h("div", {}, h("h2", { class: "card-title" }, "Latest check-in"), h("p", { class: "card-sub" }, fmt.relative(l.created_at)))),
      h("div", { class: "row wrap" }, riskBadge(l.risk_level), emotionBadge(l.emotion)),
      h("p", { class: "small muted mt-12" }, `Model confidence ${l.confidence}%`),
      h("a", { class: "btn btn-sm mt-16", href: `#/journal?open=${l.id}` }, "Open entry"));
  }

  function distributionCard(stats) {
    const d = stats.risk_distribution;
    const total = d.Low + d.Medium + d.High;
    const segs = [["Low", "low"], ["Medium", "medium"], ["High", "high"]];
    return h("section", { class: "card" },
      h("div", { class: "card-head" }, h("div", {}, h("h2", { class: "card-title" }, "Risk mix"), h("p", { class: "card-sub" }, `${total} check-ins in the last ${state.days} days`))),
      total
        ? [h("div", { class: "seg-bar", role: "img", "aria-label": segs.map(([k]) => `${k}: ${d[k]}`).join(", ") },
            segs.filter(([k]) => d[k]).map(([k, c]) => h("span", { class: `bg-${c}`, style: { flexGrow: d[k] }, title: `${k}: ${d[k]}` }))),
          h("div", { class: "seg-legend" }, segs.map(([k, c]) => h("span", {}, h("i", { class: `bg-${c}` }), `${k} `, h("strong", { class: "tabular" }, String(d[k])))))]
        : h("p", { class: "small muted" }, "No check-ins in this range."));
  }

  function emotionsCard(stats) {
    const entries = Object.entries(stats.emotions).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return h("section", { class: "card" },
      h("div", { class: "card-head" }, h("div", {}, h("h2", { class: "card-title" }, "Feelings detected"), h("p", { class: "card-sub" }, "From the language in your journal"))),
      entries.map(([k, v]) => h("div", { class: "hbar" },
        h("span", { class: "hbar-label" }, EMOTION_META[k]?.label || k),
        h("div", { class: "hbar-track" }, h("span", { style: { width: `${(v / max) * 100}%` } })),
        h("span", { class: "hbar-val" }, String(v)))));
  }

  function recentCard(items) {
    return h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { class: "card-title" }, "Recent entries"), h("a", { class: "card-link", href: "#/journal" }, "View all →")),
      items.map((e) => h("div", {
        class: "recent-item", role: "link", tabindex: "0",
        onclick: () => navigate("journal", { open: e.id }),
        onkeydown: (ev) => { if (ev.key === "Enter") navigate("journal", { open: e.id }); },
      },
      h("span", { class: `recent-dot bg-${e.risk_level.toLowerCase()}`, title: `${e.risk_level} risk` }),
      h("div", { class: "recent-body" }, h("p", {}, e.journal), h("span", {}, `${fmt.dateTime(e.created_at)} · ${e.risk_level} risk · ${EMOTION_META[e.emotion]?.label || e.emotion}`)))));
  }

  load();
  return () => { if (state.chart) state.chart.destroy(); };
}

function storageNotice() {
  if (session.storage !== "ephemeral") return null;
  try { if (localStorage.getItem("mhp.storageNoticeDismissed")) return null; } catch { /* ignore */ }
  const close = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, "Got it");
  const el = h("div", { class: "banner warn", role: "note" }, iconEl("info"),
    h("div", {}, h("strong", {}, "Demo storage. "),
      h("span", { class: "muted" }, "This server doesn't keep entries permanently. Export your journal from Settings if you want to keep it.")),
    close);
  close.addEventListener("click", () => { try { localStorage.setItem("mhp.storageNoticeDismissed", "1"); } catch { /* ignore */ } el.remove(); });
  return el;
}

function syncTabs(group, key) {
  group.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.key === key)));
}

function loadingSkeleton() {
  return h("div", { "aria-busy": "true", "aria-label": "Loading dashboard" },
    h("div", { class: "kpis" }, [1, 2, 3, 4].map(() => skeleton("sk-kpi"))),
    h("div", { class: "grid grid-main" },
      h("div", { class: "card" }, skeleton("sk-title"), skeleton("sk-block mt-16")),
      h("div", { class: "card" }, skeleton("sk-title"), skeleton("sk-line"), skeleton("sk-line"), skeleton("sk-line"))));
}

function welcome(navigate) {
  const steps = [
    { icon: "pen", title: "Write a short reflection", text: "A few sentences about your day. Only you can see it." },
    { icon: "bed", title: "Log three habits", text: "Sleep, screen time and steps help put your mood in context." },
    { icon: "spark", title: "Spot your patterns", text: "After a few check-ins, see what tends to lift or lower your days." },
  ];
  return h("div", { class: "stack" },
    h("section", { class: "card hero" },
      h("div", {},
        h("p", { class: "eyebrow" }, "Welcome"),
        h("h2", {}, "A calmer way to understand your days"),
        h("p", {}, "Check in once a day. We'll read the tone of your reflection alongside your sleep, screen time and activity, and show how things are trending over time."),
        h("div", { class: "hero-actions" },
          h("a", { class: "btn btn-primary btn-lg", href: "#/check-in", html: `${icon("plus")}<span>Start your first check-in</span>` }),
          h("button", { class: "btn btn-lg btn-ghost", type: "button", onclick: () => navigate("settings") }, "Set your goals"))),
      illustration("hero", "Rolling hills at sunrise", "hero-art", { eager: true, width: 640, height: 400 })),
    h("div", { class: "grid grid-3" }, steps.map((s, i) => h("div", { class: "card" },
      h("div", { class: "insight-icon", html: icon(s.icon) }),
      h("p", { class: "eyebrow mt-16" }, `Step ${i + 1}`),
      h("h3", { class: "card-title mt-8" }, s.title),
      h("p", { class: "small muted mt-8" }, s.text)))));
}

