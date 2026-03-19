import { state, getSelectedSpectrum } from "./state.js";
import { applyOffsets } from "./process.js";

let isApplyingViewport = false;
let pointSelectionHandler = null;

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

function clampFontSize(value, fallback) {
  const size = Number(value);
  return Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : fallback;
}

function createAxisConfig(title, colors, typography = {}, titleStandoff = 18) {
  const titleFontSize = clampFontSize(typography.titleFontSize, 30);
  const tickFontSize = clampFontSize(typography.tickFontSize, 18);

  return {
    title: {
      text: title,
      font: {
        size: titleFontSize,
        family: 'Arial, "Helvetica Neue", sans-serif',
        color: colors.text,
      },
      standoff: titleStandoff,
    },
    showgrid: false,
    zeroline: false,
    showline: true,
    linecolor: colors.axis,
    linewidth: 3,
    mirror: "allticks",
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
      size: tickFontSize,
      family: 'Arial, "Helvetica Neue", sans-serif',
      color: colors.text,
    },
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function countDecimals(value) {
  if (!isFiniteNumber(value)) return 0;
  const asString = String(value).toLowerCase();
  if (asString.includes("e-")) {
    return Number(asString.split("e-")[1]) || 0;
  }
  const parts = asString.split(".");
  return parts[1]?.length ?? 0;
}

function formatTickValue(value, decimals) {
  if (!isFiniteNumber(value)) return "";
  const abs = Math.abs(value);
  if ((abs >= 1e5 || (abs > 0 && abs < 1e-3))) {
    return value.toExponential(2);
  }
  const safeDecimals = Math.min(Math.max(decimals, 0), 6);
  return Number(value.toFixed(safeDecimals)).toString();
}

function estimateTickLabelLength(axisSpec) {
  if (!axisSpec?.range || !isFiniteNumber(axisSpec.dtick) || axisSpec.dtick <= 0) return 4;
  const decimals = Math.max(countDecimals(axisSpec.tick0), countDecimals(axisSpec.dtick));
  const [start, end] = axisSpec.range;
  const step = axisSpec.dtick;
  const span = end - start;
  const tickCount = Math.min(Math.max(Math.round(span / step) + 1, 2), 50);
  let maxLength = 0;

  for (let index = 0; index < tickCount; index += 1) {
    const value = start + (step * index);
    maxLength = Math.max(maxLength, formatTickValue(value, decimals).length);
  }

  return Math.max(maxLength, formatTickValue(end, decimals).length, 4);
}

function buildAxisTypography(axisSpec, stateUi, axisKey) {
  const titleFontSize = clampFontSize(stateUi.axisTitleFontSize, 30);
  const tickFontSize = clampFontSize(stateUi.axisTickFontSize, 18);
  const labelLength = estimateTickLabelLength(axisSpec);
  const tickBand = Math.ceil(tickFontSize * 1.9);
  const titleStandoff = axisKey === "y"
    ? Math.max(22, Math.ceil((labelLength * tickFontSize * 0.58) + (tickFontSize * 0.8)))
    : Math.max(18, Math.ceil(tickBand * 0.75));

  return {
    titleFontSize,
    tickFontSize,
    titleStandoff,
    labelLength,
    tickBand,
  };
}

function createLayoutMargins(xTypography, yTypography) {
  const left = Math.max(96, Math.ceil((yTypography.labelLength * yTypography.tickFontSize * 0.62) + yTypography.titleFontSize + yTypography.titleStandoff + 36));
  const bottom = Math.max(90, Math.ceil(xTypography.tickBand + xTypography.titleFontSize + xTypography.titleStandoff + 34));

  return { l: left, r: 28, t: 28, b: bottom };
}

function normalizeRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function roundToStep(value, step) {
  if (!isFiniteNumber(value) || !isFiniteNumber(step) || step === 0) return value;
  const precision = Math.max(0, Math.ceil(-Math.log10(Math.abs(step))) + 2);
  return Number(value.toFixed(precision));
}

function niceStep(rawStep, roundResult = true) {
  if (!isFiniteNumber(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / (10 ** exponent);
  let niceFraction;

  if (roundResult) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * (10 ** exponent);
}

function buildNiceAxis(range, { targetTicks = 6, paddingRatio = 0 } = {}) {
  const normalized = normalizeRange(range);
  if (!normalized) return null;

  const [rawMin, rawMax] = normalized;
  const span = rawMax - rawMin;
  const paddedSpan = span > 0 ? span * (1 + paddingRatio * 2) : Math.max(Math.abs(rawMax) * 0.2, 1);
  const center = (rawMin + rawMax) / 2;
  const paddedMin = span > 0 ? rawMin - (span * paddingRatio) : center - (paddedSpan / 2);
  const paddedMax = span > 0 ? rawMax + (span * paddingRatio) : center + (paddedSpan / 2);
  const step = niceStep((paddedMax - paddedMin) / Math.max(targetTicks - 1, 1));
  const min = roundToStep(Math.floor(paddedMin / step) * step, step);
  const max = roundToStep(Math.ceil(paddedMax / step) * step, step);

  return {
    range: [min, max],
    tick0: min,
    dtick: step,
  };
}

function getVisibleXRange(traces) {
  const values = [];
  traces.forEach((trace) => {
    trace.x.forEach((value) => {
      if (isFiniteNumber(value)) values.push(value);
    });
  });
  if (!values.length) return null;
  return [Math.min(...values), Math.max(...values)];
}

function getVisibleYRange(traces, xRange = null) {
  const normalizedX = normalizeRange(xRange);
  const yValues = [];

  traces.forEach((trace) => {
    for (let index = 0; index < trace.x.length; index += 1) {
      const x = Number(trace.x[index]);
      const y = Number(trace.y[index]);
      const inRange = !normalizedX || (isFiniteNumber(x) && x >= normalizedX[0] && x <= normalizedX[1]);
      if (inRange && isFiniteNumber(y)) {
        yValues.push(y);
      }
    }
  });

  if (!yValues.length) return null;
  return [Math.min(...yValues), Math.max(...yValues)];
}

function updateAxisRangeInputs(xRange, yRange) {
  const mappings = [
    ["xRangeMinInput", xRange?.[0]],
    ["xRangeMaxInput", xRange?.[1]],
    ["yRangeMinInput", yRange?.[0]],
    ["yRangeMaxInput", yRange?.[1]],
  ];

  mappings.forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = isFiniteNumber(value) ? String(value) : "";
  });
}

function syncAxisControlState(resolvedViewport = null) {
  const viewport = state.ui.plotViewport;
  const resetBtn = document.getElementById("resetZoomBtn");
  const xLock = document.getElementById("lockXRangeInput");
  const yLock = document.getElementById("lockYRangeInput");
  const snapX = document.getElementById("snapXRangeInput");

  if (resetBtn) {
    resetBtn.disabled = !normalizeRange(viewport.selectedXRange)
      && !normalizeRange(viewport.manualXRange)
      && !normalizeRange(viewport.manualYRange)
      && !viewport.lockXRange
      && !viewport.lockYRange;
  }

  if (xLock) xLock.checked = Boolean(viewport.lockXRange);
  if (yLock) yLock.checked = Boolean(viewport.lockYRange);
  if (snapX) snapX.checked = viewport.snapXRange !== false;

  updateAxisRangeInputs(
    resolvedViewport?.displayXRange ?? normalizeRange(viewport.manualXRange) ?? normalizeRange(viewport.selectedXRange),
    resolvedViewport?.displayYRange ?? normalizeRange(viewport.manualYRange)
  );
}

function resolveViewport(traces) {
  const viewport = state.ui.plotViewport;
  const dataXRange = getVisibleXRange(traces);

  const requestedXRange = normalizeRange(viewport.lockXRange
    ? viewport.manualXRange
    : (viewport.manualXRange ?? viewport.selectedXRange ?? dataXRange));

  const shouldSnapX = viewport.lockXRange ? false : viewport.snapXRange !== false;
  const xAxis = requestedXRange
    ? buildNiceAxis(requestedXRange, { targetTicks: 7, paddingRatio: shouldSnapX ? 0.04 : 0 })
    : (dataXRange ? buildNiceAxis(dataXRange, { targetTicks: 7, paddingRatio: 0.02 }) : null);

  const displayXRange = normalizeRange(xAxis?.range ?? requestedXRange ?? dataXRange);

  const requestedYRange = normalizeRange(viewport.lockYRange ? viewport.manualYRange : null)
    ?? getVisibleYRange(traces, displayXRange)
    ?? getVisibleYRange(traces);

  const yAxis = requestedYRange
    ? buildNiceAxis(requestedYRange, { targetTicks: 6, paddingRatio: viewport.lockYRange ? 0 : 0.08 })
    : null;

  return {
    dataXRange,
    displayXRange,
    displayYRange: normalizeRange(yAxis?.range ?? requestedYRange),
    xAxis,
    yAxis,
  };
}

function applyAxisLayout(axisLayout, axisSpec) {
  if (!axisSpec?.range) {
    axisLayout.autorange = true;
    delete axisLayout.range;
    delete axisLayout.tick0;
    delete axisLayout.dtick;
    return;
  }

  axisLayout.autorange = false;
  axisLayout.range = axisSpec.range;
  axisLayout.tick0 = axisSpec.tick0;
  axisLayout.dtick = axisSpec.dtick;
}

function storeViewportFromRelayout(eventData) {
  if (!eventData) return false;

  const viewport = state.ui.plotViewport;
  const resetRequested = ["xaxis.autorange", "yaxis.autorange", "autosize"].some((key) => eventData[key]);
  if (resetRequested) {
    if (!viewport.lockXRange) viewport.manualXRange = null;
    if (!viewport.lockYRange) viewport.manualYRange = null;
    viewport.selectedXRange = null;
    return true;
  }

  const xRange = normalizeRange([
    eventData["xaxis.range[0]"],
    eventData["xaxis.range[1]"],
  ]) ?? normalizeRange(eventData["xaxis.range"]);

  if (!xRange) return false;

  viewport.selectedXRange = xRange;
  if (!viewport.lockXRange) {
    viewport.manualXRange = xRange;
  }
  return true;
}

function dispatchPeakEvent(plotEl, eventName, detail = {}) {
  plotEl.dispatchEvent(new CustomEvent(eventName, {
    detail,
    bubbles: true,
  }));
export function setPlotPointSelectionHandler(handler) {
  pointSelectionHandler = typeof handler === "function" ? handler : null;
}

function bindPlotInteractions(plotEl) {
  if (plotEl.dataset.viewportBound === "true") return;

  plotEl.on("plotly_relayout", async (eventData) => {
    if (isApplyingViewport) return;
    const changed = storeViewportFromRelayout(eventData);
    if (!changed) return;
    await renderPlot();
  });

  plotEl.on("plotly_click", (eventData) => {
    const point = eventData?.points?.[0];
    const peakData = point?.customdata;
    if (!peakData?.isPeakMarker) {
      dispatchPeakEvent(plotEl, "peak-marker-clear");
      return;
    }

    dispatchPeakEvent(plotEl, "peak-marker-click", {
      spectrumId: peakData.spectrumId,
      peakIndex: peakData.peakIndex,
      peakNumber: peakData.peakNumber,
      x: peakData.x,
      y: peakData.y,
      prominence: peakData.prominence,
      clientX: eventData?.event?.clientX ?? 0,
      clientY: eventData?.event?.clientY ?? 0,
    });
  });

  plotEl.on("plotly_doubleclick", () => {
    dispatchPeakEvent(plotEl, "peak-marker-clear");
  plotEl.on("plotly_click", async (eventData) => {
    if (!pointSelectionHandler) return;
    await pointSelectionHandler(eventData);
  });

  plotEl.dataset.viewportBound = "true";
}

export function getCurrentPlotRanges() {
  const plotEl = document.getElementById("plot");
  const xRange = normalizeRange(plotEl?._fullLayout?.xaxis?.range);
  const yRange = normalizeRange(plotEl?._fullLayout?.yaxis?.range);
  return { xRange, yRange };
}

export function applyManualAxisRanges({ xRange = null, yRange = null, lockXRange = false, lockYRange = false, snapXRange = true } = {}) {
  const viewport = state.ui.plotViewport;
  viewport.lockXRange = Boolean(lockXRange);
  viewport.lockYRange = Boolean(lockYRange);
  viewport.snapXRange = Boolean(snapXRange);

  const normalizedX = normalizeRange(xRange);
  const normalizedY = normalizeRange(yRange);

  viewport.manualXRange = normalizedX;
  viewport.selectedXRange = normalizedX;
  viewport.manualYRange = normalizedY;
}

export async function snapCurrentXAxisRange() {
  const current = getCurrentPlotRanges();
  if (!current.xRange) return;
  state.ui.plotViewport.manualXRange = current.xRange;
  state.ui.plotViewport.selectedXRange = current.xRange;
  await renderPlot();
}

export async function fixCurrentScale() {
  const current = getCurrentPlotRanges();
  if (!current.xRange && !current.yRange) return;
  const viewport = state.ui.plotViewport;
  if (current.xRange) {
    viewport.manualXRange = current.xRange;
    viewport.selectedXRange = current.xRange;
    viewport.lockXRange = true;
  }
  if (current.yRange) {
    viewport.manualYRange = current.yRange;
    viewport.lockYRange = true;
  }
  await renderPlot();
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
      dash: s.lineStyle || "solid",
    },
    hovertemplate: "%{x}<br>%{y}<extra>%{fullData.name}</extra>",
  }));
  const traces = prepared.flatMap((s, index) => {
    const lineTrace = {
      x: s.xPlot,
      y: s.yPlot,
      type: "scatter",
      mode: "lines",
      name: s.name,
      meta: {
        spectrumId: s.id,
        traceRole: "spectrum",
      },
      line: {
        color: s.color || defaultColor(index),
        width: Number(s.lineWidth) || 2,
      },
      hovertemplate: "%{x}<br>%{y}<extra>%{fullData.name}</extra>",
    };

    const selectedSpectrum = getSelectedSpectrum();
    const selectedIndex = selectedSpectrum?.id === s.id ? selectedSpectrum.selectedRemovalPointIndex : null;
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= s.xPlot.length) {
      return [lineTrace];
    }

    return [
      lineTrace,
      {
        x: [s.xPlot[selectedIndex]],
        y: [s.yPlot[selectedIndex]],
        type: "scatter",
        mode: "markers",
        name: `${s.name} selected point`,
        showlegend: false,
        hoverinfo: "skip",
        meta: {
          spectrumId: s.id,
          traceRole: "selected-removal-point",
        },
        marker: {
          size: 12,
          color: "#ef4444",
          line: {
            color: "#ffffff",
            width: 2,
          },
          symbol: "x",
        },
      },
    ];
  });

  const selectedSpectrum = getSelectedSpectrum();
  const selectedPrepared = prepared.find((s) => s.id === selectedSpectrum?.id);
  const selectedColor = selectedPrepared
    ? (selectedPrepared.color || defaultColor(prepared.findIndex((s) => s.id === selectedPrepared.id)))
    : defaultColor(0);

  if (selectedPrepared?.detectedPeaks?.length) {
    traces.push({
      x: selectedPrepared.detectedPeaks.map((peak) => selectedPrepared.xPlot[peak.index]),
      y: selectedPrepared.detectedPeaks.map((peak) => selectedPrepared.yPlot[peak.index]),
      type: "scatter",
      mode: "markers",
      name: `${selectedPrepared.name} peaks`,
      showlegend: false,
      marker: {
        size: 11,
        color: selectedColor,
        symbol: "diamond-open",
        line: {
          width: 2,
          color: colors.text,
        },
      },
      customdata: selectedPrepared.detectedPeaks.map((peak, peakNumber) => ({
        isPeakMarker: true,
        spectrumId: selectedPrepared.id,
        peakIndex: peak.index,
        peakNumber: peakNumber + 1,
        x: peak.x,
        y: peak.y,
        prominence: peak.prominence,
      })),
      hovertemplate: "peak #%{customdata.peakNumber}<br>x=%{customdata.x:.4f}<br>y=%{customdata.y:.4f}<br>prominence=%{customdata.prominence:.4f}<extra>Click for actions</extra>",
    });
  }

  const resolvedViewport = resolveViewport(traces);

  const xTypography = buildAxisTypography(resolvedViewport.xAxis, state.ui, "x");
  const yTypography = buildAxisTypography(resolvedViewport.yAxis, state.ui, "y");

  const layout = {
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.plot,
    font: {
      color: colors.text,
      family: 'Arial, "Helvetica Neue", sans-serif',
    },
    xaxis: createAxisConfig(state.ui.xLabel, colors, xTypography, xTypography.titleStandoff),
    yaxis: createAxisConfig(state.ui.yLabel, colors, yTypography, yTypography.titleStandoff),
    dragmode: "zoom",
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
    margin: createLayoutMargins(xTypography, yTypography),
    height: Number(state.ui.plotHeight) || 560,
    hoverlabel: {
      bgcolor: colors.paper,
      bordercolor: colors.axis,
      font: {
        color: colors.text,
      },
    },
  };

  applyAxisLayout(layout.xaxis, resolvedViewport.xAxis);
  applyAxisLayout(layout.yaxis, resolvedViewport.yAxis);

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    scrollZoom: true,
  };

  isApplyingViewport = true;
  await window.Plotly.react(plotEl, traces, layout, config);
  plotEl.__currentTraces = traces;
  isApplyingViewport = false;
  bindPlotInteractions(plotEl);
  syncAxisControlState(resolvedViewport);
}

export async function resetPlotZoom() {
  const viewport = state.ui.plotViewport;
  viewport.selectedXRange = null;
  if (!viewport.lockXRange) viewport.manualXRange = null;
  if (!viewport.lockYRange) viewport.manualYRange = null;
  await renderPlot();
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
