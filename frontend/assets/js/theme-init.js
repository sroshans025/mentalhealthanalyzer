// Applies the saved theme before first paint to avoid a flash of the wrong theme.
(function () {
  try {
    var pref = localStorage.getItem("mhp.theme") || "system";
    var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
