import { h, icon, illustration } from "../ui.js";

// Verified, free, confidential lines. findahelpline.com covers other countries.
export const HELPLINES = [
  { region: "India", name: "Tele-MANAS (24/7)", contact: "14416", href: "tel:14416" },
  { region: "United States", name: "988 Suicide & Crisis Lifeline", contact: "988", href: "tel:988" },
  { region: "UK & Ireland", name: "Samaritans", contact: "116 123", href: "tel:116123" },
  { region: "Anywhere", name: "Find a helpline near you", contact: "findahelpline.com", href: "https://findahelpline.com" },
];

export function supportCard({ urgent = false } = {}) {
  const list = h("ul", { class: "support-list" }, HELPLINES.map((l) => h("li", {},
    h("span", {}, h("span", { class: "subtle small" }, `${l.region} · `), l.name),
    h("a", { href: l.href, ...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, h("strong", {}, l.contact)))));

  if (urgent) {
    return h("section", { class: "card support-card", role: "alert" },
      h("div", { class: "row", style: { alignItems: "flex-start", gap: "12px" } },
        h("div", { class: "insight-icon", style: { background: "var(--surface)", color: "var(--high)" }, html: icon("heart") }),
        h("div", {},
          h("h2", { class: "card-title" }, "You don't have to go through this alone"),
          h("p", { class: "small mt-8" }, "It sounds like things are really hard right now. Please talk to someone today. These services are free, confidential and available any time. If you are in immediate danger, call your local emergency number (112 in India and Europe, 911 in the US)."))),
      list);
  }
  return h("section", { class: "card" },
    h("div", { class: "row", style: { gap: "18px", alignItems: "center" } },
      illustration("support", "", "", { width: 120, height: 90 }),
      h("div", {},
        h("h2", { class: "card-title" }, "Support is always available"),
        h("p", { class: "small muted mt-8" }, "If you're struggling, reaching out helps. These lines are free and confidential. In an emergency, call your local emergency number."))),
    list);
}
