// Theme-aware Chart.js helpers. Chart.js is loaded with `defer` as a global.

const FONT = "Outfit, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function waitForChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.Chart) return resolve(window.Chart);
      if (Date.now() - started > 8000) return reject(new Error("Chart library failed to load"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Single-series line chart with an optional dashed goal reference line.
 * One series, one axis: different metrics are shown by switching tabs.
 */
export async function lineChart(canvas, { labels, values, yMin, yMax, yTicks, format, goal, goalLabel, pointLabel }) {
  const Chart = await waitForChart();
  const text2 = css("--text-2");
  const text3 = css("--text-3");
  const grid = css("--grid");
  const series = css("--series-1");
  const surface = css("--surface");

  const datasets = [{
    label: pointLabel,
    data: values,
    borderColor: series,
    backgroundColor: series,
    borderWidth: 2,
    cubicInterpolationMode: "monotone",
    spanGaps: true,
    pointRadius: values.length > 40 ? 0 : 4,
    pointHoverRadius: 6,
    pointBackgroundColor: series,
    pointBorderColor: surface,
    pointBorderWidth: 2,
    fill: false,
  }];
  if (goal !== undefined && goal !== null) {
    datasets.push({
      label: goalLabel || "Goal",
      data: labels.map(() => goal),
      borderColor: text3,
      borderWidth: 1.5,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
    });
  }

  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--surface"),
          titleColor: css("--text"),
          bodyColor: text2,
          borderColor: css("--border-strong"),
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
          displayColors: false,
          titleFont: { family: FONT, weight: "600" },
          bodyFont: { family: FONT },
          filter: (item) => item.datasetIndex === 0,
          callbacks: { label: (ctx) => `${pointLabel}: ${format(ctx.raw)}` },
        },
      },
      scales: {
        y: {
          min: yMin, max: yMax,
          border: { display: false },
          grid: { color: grid, drawTicks: false },
          ticks: { color: text3, padding: 8, font: { family: FONT, size: 12 }, maxTicksLimit: 5, ...(yTicks || {}) },
        },
        x: {
          border: { color: grid },
          grid: { display: false },
          ticks: { color: text3, font: { family: FONT, size: 12 }, maxRotation: 0, autoSkipPadding: 16 },
        },
      },
    },
  });
}
