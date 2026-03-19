import { state } from "./state.js";
import { applyOffsets } from "./process.js";

function getThemeColors(theme) {
  return theme === "dark"
    ? {
        paper: "#0b0b0d",
        plot: "#0b0b0d",
        text: "#f5f5f5",
        axis: "#f5f5f5",
        grid: "rgba(255,255,255,0.12)",
        legendBg: "rgba(11,11,13,0.78)",
      }
    : {
        paper: "#ffffff",
        plot: "#ffffff",
        text: "#111111",
        axis: "#111111",
        grid: "rgba(17,17,17,0.10)",
        legendBg: "rgba(255,255,255,0.90)",
      };
}

function defaultColor(index) {
  const colors = [
    "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
    "#0891b2", "#4b5563", "#db2777", "#65a30d", "#ea580c",
  ];
  return colors[index % colors.length];
}

function createAxisConfig(title, colors) {
  return {
    title: {
      text: title,
      font: {
        size: 30,
        family: 'Arial, "Helvetica Neue", sans-serif',
        color: colors.text,
      },
      standoff: 18,
    },
    showgrid: false,
    zeroline: false,
    showline: true,
    linecolor: colors.axis,
    linewidth: 3,
    mirror: true,
    ticks: "inside",
    ticklen: 12,
    tickwidth: 3,
    tickcolor: colors.axis,
    minor: {
      ticks: "inside",
      ticklen: 6,
      tickwidth: 2,
      tickcolor: colors.axis,
      showgrid: false,
    },
    automargin: true,
    tickfont: {
      size: 18,
      family: 'Arial, "Helvetica Neue", sans-serif',
      color: colors.text,
    },
  };
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
    hovertemplate: "%{x}<br>%{y}<extra>%{fullData.name}</extra>",
  }));

  const layout = {
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.plot,
    font: {
      color: colors.text,
      family: 'Arial, "Helvetica Neue", sans-serif',
    },
    xaxis: createAxisConfig(state.ui.xLabel, colors),
    yaxis: createAxisConfig(state.ui.yLabel, colors),
    showlegend: true,
    legend: {
      orientation: "v",
      x: 1,
      xanchor: "right",
      y: 1,
      yanchor: "top",
      bgcolor: colors.legendBg,
      bordercolor: colors.axis,
      borderwidth: 1,
      font: {
        size: 13,
      },
    },
    margin: { l: 96, r: 28, t: 28, b: 90 },
    height: Number(state.ui.plotHeight) || 560,
    hoverlabel: {
      bgcolor: colors.paper,
      bordercolor: colors.axis,
      font: {
        color: colors.text,
      },
    },
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
