import { api } from "../api.js";
import { h, icon, clear, skeleton, emptyState, errorState, illustration } from "../ui.js";
import { supportCard } from "./support.js";

const TONE_ICON = { positive: "trendUp", warning: "alert", info: "lightbulb" };
const BREAKDOWNS = [
  { key: "sleep", title: "Risk by sleep", sub: "Average risk for nights in each range" },
  { key: "screen", title: "Risk by screen time", sub: "Average risk for days in each range" },
  { key: "activity", title: "Risk by steps", sub: "Average risk for days in each range" },
];

export function render(root, { isCurrent }) {
  const body = h("div");
  root.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Insights"),
      h("p", {}, "Patterns found in your own check-ins. The more you check in, the sharper they get."))),
    body);

  async function load() {
    clear(body).append(h("div", { class: "stack", "aria-busy": "true" },
      h("div", { class: "grid grid-2" }, [1, 2, 3, 4].map(() => h("div", { class: "card" }, skeleton("sk-title"), skeleton("sk-line mt-12"), skeleton("sk-line"))))));
    let data;
    try {
      data = await api.insights();
    } catch (err) {
      if (isCurrent()) clear(body).append(errorState(err.message, load));
      return;
    }
    if (!isCurrent()) return;
    clear(body);

    if (!data.ready) {
      const total = data.entries + data.needed;
      body.append(h("section", { class: "card" }, h("div", { class: "empty" },
        illustration("empty-insights", ""),
        h("h3", {}, data.entries ? "Your insights are growing" : "Insights unlock after a few check-ins"),
        h("p", {}, `Check in ${data.needed} more ${data.needed === 1 ? "time" : "times"} and we'll start pointing out what tends to lift or weigh on your days.`),
        h("div", { class: "progress-steps", style: { width: "220px" }, role: "progressbar", "aria-valuenow": data.entries, "aria-valuemin": 0, "aria-valuemax": total, "aria-label": "Check-ins completed" },
          Array.from({ length: total }, (_, i) => h("span", { class: i < data.entries ? "done" : "" }))),
        h("a", { class: "btn btn-primary mt-16", href: "#/check-in" }, "Check in now"))));
      body.append(h("div", { class: "mt-24" }, supportCard()));
      return;
    }

    const list = data.insights.length
      ? h("div", { class: "grid grid-2" }, data.insights.map((i) => h("article", { class: `card insight ${i.tone}` },
          h("div", { class: "insight-icon", html: icon(TONE_ICON[i.tone] || "info") }),
          h("div", {}, h("h3", {}, i.title), h("p", {}, i.detail)),
          i.metric ? h("span", { class: "insight-metric" }, i.metric) : null)))
      : h("section", { class: "card" }, emptyState({ image: "empty-insights", title: "No strong patterns yet", text: "Your check-ins look fairly consistent so far. Keep going and new patterns will show up here.", compact: true }));

    body.append(
      h("p", { class: "eyebrow", style: { marginBottom: "12px" } }, `Based on ${data.entries} check-ins`),
      list,
      h("h2", { class: "card-title mt-24", style: { marginBottom: "12px" } }, "How your habits line up with risk"),
      h("div", { class: "grid grid-3" }, BREAKDOWNS.map((b) => breakdownCard(b, data.breakdowns[b.key]))),
      h("div", { class: "mt-24" }, supportCard()));
  }

  load();
}

function breakdownCard({ title, sub }, rows) {
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("div", {}, h("h3", { class: "card-title" }, title), h("p", { class: "card-sub" }, sub))),
    rows.map((r) => {
      const pct = r.avg_risk ? ((r.avg_risk - 1) / 2) * 100 : 0;
      const word = r.avg_risk === null ? "" : r.avg_risk < 1.5 ? "Low" : r.avg_risk < 2.5 ? "Med" : "High";
      return h("div", { class: "hbar sm", title: r.count ? `${r.count} check-ins, average risk ${r.avg_risk}/3` : "No check-ins" },
        h("span", { class: "hbar-label small" }, r.label),
        h("div", { class: "hbar-track" }, r.count ? h("span", { style: { width: `${Math.max(4, pct)}%` } }) : null),
        h("span", { class: "hbar-val small" }, r.count ? `${word} · ${r.count}` : "–"));
    }),
    h("p", { class: "xs subtle mt-8" }, "Bar length = average risk (Low → High). Number = check-ins."));
}
