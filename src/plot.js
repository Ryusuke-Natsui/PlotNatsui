import { state } from "./state.js";
import { applyOffsets } from "./process.js";

function getThemeColors(theme) {
  return theme === "dark"
    ? {
        paper: "#111827",
        plot: "#111827",
        text: "#f9fafb",
        grid: "#374151",
      }
    : {
        paper: "#ffffff",
        plot: "#ffffff",
        text: "#111827",
        grid: "#d1d5db",
      };
}

function defaultColor(index) {
  const colors = [
    "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
    "#0891b2", "#4b5563", "#db2777", "#65a30d", "#ea580c",
  ];
  return colors[index % colors.length];
}

export async function renderPlot() {
  const plotEl = document.getElementById("plot");
  if (!plotEl || !window.Plotly) return;

  const colors = getThemeColors(state.ui.theme);
  const prepared = applyOffsets(
    state.spectra.filter((s) => s.visible),
    state.ui.offsetStep
  );

  const traces = prepared.map((s, index) => ({
    x: s.xPlot,
    y: s.yPlot,
    type: "scatter",
    mode: "lines",
    name: s.name,
    line: {
      color: s.color || defaultColor(index),
      width: Number(s.lineWidth) || 2,
    },
  }));

  const layout = {
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.plot,
    font: { color: colors.text },
    xaxis: {
      title: state.ui.xLabel,
      gridcolor: colors.grid,
      zerolinecolor: colors.grid,
    },
    yaxis: {
      title: state.ui.yLabel,
      gridcolor: colors.grid,
      zerolinecolor: colors.grid,
    },
    showlegend: true,
    legend: { orientation: "h" },
    margin: { l: 70, r: 20, t: 20, b: 60 },
    height: Number(state.ui.plotHeight) || 560,
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  await window.Plotly.react(plotEl, traces, layout, config);
}

export async function exportPlotPng() {
  const plotEl = document.getElementById("plot");
  if (!plotEl || !window.Plotly) return;
  const url = await window.Plotly.toImage(plotEl, {
    format: "png",
    width: 1600,
    height: Number(state.ui.plotHeight) || 560,
    scale: 2,
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = "spectrum-plot.png";
  a.click();
}
