import { state, getSelectedSpectrum } from "./state.js";
import { applyOffsets } from "./process.js";

let isApplyingViewport = false;
let pointSelectionHandler = null;
let backgroundRangeSelectionHandler = null;

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
  if (asString.includes("e-")) return Number(asString.split("e-")[1]) || 0;
  const parts = asString.split(".");
  return parts[1]?.length ?? 0;
}

function formatTickValue(value, decimals) {
  if (!isFiniteNumber(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1e5 || (abs > 0 && abs < 1e-3)) return value.toExponential(2);
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

  return { titleFontSize, tickFontSize, titleStandoff, labelLength, tickBand };
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

function buildAxisWithExactRange(range, { targetTicks = 6 } = {}) {
  const normalized = normalizeRange(range);
  if (!normalized) return null;

  const [min, max] = normalized;
  const span = max - min;
  const step = niceStep(span / Math.max(targetTicks - 1, 1));

  return { range: [min, max], tick0: min, dtick: step };
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

  return { range: [min, max], tick0: min, dtick: step };
}

function getVisibleXRange(traces) {
  const values = [];
  traces.forEach((trace) => {
    trace.x.forEach((value) => {
      if (isFiniteNumber(value)) values.push(value);
    });
  });
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

function getVisibleYRange(traces, xRange = null) {
  const normalizedX = normalizeRange(xRange);
  const yValues = [];

  traces.forEach((trace) => {
    for (let index = 0; index < trace.x.length; index += 1) {
      const x = Number(trace.x[index]);
      const y = Number(trace.y[index]);
      const inRange = !normalizedX || (isFiniteNumber(x) && x >= normalizedX[0] && x <= normalizedX[1]);
      if (inRange && isFiniteNumber(y)) yValues.push(y);
    }
  });

  return yValues.length ? [Math.min(...yValues), Math.max(...yValues)] : null;
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
    if (input) input.value = isFiniteNumber(value) ? String(value) : "";
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
    resolvedViewport?.displayYRange ?? normalizeRange(viewport.manualYRange),
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
    ? (shouldSnapX
      ? buildNiceAxis(requestedXRange, { targetTicks: 7, paddingRatio: 0.04 })
      : buildAxisWithExactRange(requestedXRange, { targetTicks: 7 }))
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

  const yRange = normalizeRange([
    eventData["yaxis.range[0]"],
    eventData["yaxis.range[1]"],
  ]) ?? normalizeRange(eventData["yaxis.range"]);

  let changed = false;

  if (xRange) {
    viewport.selectedXRange = xRange;
    if (!viewport.lockXRange) viewport.manualXRange = xRange;
    changed = true;
  }

  if (yRange && !viewport.lockYRange) {
    viewport.manualYRange = yRange;
    changed = true;
  }

  return changed;
}

function dispatchPeakEvent(plotEl, eventName, detail = {}) {
  plotEl.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
}

export function setPlotPointSelectionHandler(handler) {
  pointSelectionHandler = typeof handler === "function" ? handler : null;
}

export function setPlotBackgroundRangeSelectionHandler(handler) {
  backgroundRangeSelectionHandler = typeof handler === 'function' ? handler : null;
}


function getPlotInteractionOverlay(plotEl) {
  const stage = plotEl?.closest('.plot-stage');
  if (!stage) return null;
  let overlay = stage.querySelector('.plot-selection-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'plot-selection-overlay';
    overlay.hidden = true;
    stage.appendChild(overlay);
  }
  return overlay;
}

function updateBackgroundSelectionOverlay(plotEl) {
  const overlay = getPlotInteractionOverlay(plotEl);
  if (!overlay) return;
  const active = Boolean(state.ui.backgroundSelection?.enabled);
  overlay.hidden = !active;
  overlay.classList.toggle('is-active', active);
}

function extractPlotAreaBounds(plotEl) {
  const fullLayout = plotEl?._fullLayout;
  if (!fullLayout) return null;
  const left = Number(fullLayout.margin?.l) || 0;
  const top = Number(fullLayout.margin?.t) || 0;
  const width = Number(fullLayout._size?.w) || 0;
  const height = Number(fullLayout._size?.h) || 0;
  if (!width || !height) return null;
  return { left, top, width, height };
}

function bindBackgroundSelectionInteractions(plotEl) {
  if (plotEl.dataset.backgroundSelectionBound === 'true') return;
  const overlay = getPlotInteractionOverlay(plotEl);
  if (!overlay) return;

  let dragState = null;
  const finishSelection = async (clientX, shouldApply = true) => {
    if (!dragState) return;
    const fullLayout = plotEl._fullLayout;
    const xaxis = fullLayout?.xaxis;
    const bounds = extractPlotAreaBounds(plotEl);
    const plotRect = plotEl.getBoundingClientRect();
    const relativeEnd = clientX - plotRect.left;
    const clampedEnd = Math.min(Math.max(relativeEnd, bounds.left), bounds.left + bounds.width);
    const x0 = Number(xaxis.p2l(dragState.startPixel - bounds.left));
    const x1 = Number(xaxis.p2l(clampedEnd - bounds.left));

    state.ui.backgroundSelection.startX = null;
    state.ui.backgroundSelection.currentX = null;

    dragState = null;

    if (shouldApply && backgroundRangeSelectionHandler && Number.isFinite(x0) && Number.isFinite(x1) && x0 !== x1) {
      await backgroundRangeSelectionHandler({ range: [x0, x1], mode: x1 >= x0 ? 'include' : 'exclude' });
    } else {
      await renderPlot();
    }
  };

  overlay.addEventListener('pointerdown', (event) => {
    if (!state.ui.backgroundSelection?.enabled) return;
    const xaxis = plotEl._fullLayout?.xaxis;
    const bounds = extractPlotAreaBounds(plotEl);
    if (!xaxis || !bounds) return;
    const plotRect = plotEl.getBoundingClientRect();
    const relativeX = event.clientX - plotRect.left;
    const clampedX = Math.min(Math.max(relativeX, bounds.left), bounds.left + bounds.width);
    dragState = { startPixel: clampedX, pointerId: event.pointerId };
    state.ui.backgroundSelection.startX = Number(xaxis.p2l(clampedX - bounds.left));
    state.ui.backgroundSelection.currentX = state.ui.backgroundSelection.startX;
    overlay.setPointerCapture(event.pointerId);
    renderPlot();
    event.preventDefault();
  });

  overlay.addEventListener('pointermove', async (event) => {
    if (!dragState || !state.ui.backgroundSelection?.enabled) return;
    const xaxis = plotEl._fullLayout?.xaxis;
    const bounds = extractPlotAreaBounds(plotEl);
    if (!xaxis || !bounds) return;
    const plotRect = plotEl.getBoundingClientRect();
    const relativeX = event.clientX - plotRect.left;
    const clampedX = Math.min(Math.max(relativeX, bounds.left), bounds.left + bounds.width);
    state.ui.backgroundSelection.currentX = Number(xaxis.p2l(clampedX - bounds.left));
    await renderPlot();
    event.preventDefault();
  });

  overlay.addEventListener('pointerup', async (event) => {
    if (dragState?.pointerId !== event.pointerId) return;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    await finishSelection(event.clientX, true);
    event.preventDefault();
  });

  overlay.addEventListener('pointercancel', async (event) => {
    if (dragState?.pointerId !== event.pointerId) return;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    await finishSelection(event.clientX, false);
    event.preventDefault();
  });

  plotEl.dataset.backgroundSelectionBound = 'true';
}

function createBackgroundShapes(selectedPrepared, displayYRange) {
  if (!selectedPrepared) return [];
  const background = selectedPrepared.backgroundCorrection;
  const shapes = [];

  if (background?.constant?.range && background.mode === 'constant') {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: background.constant.range[0], x1: background.constant.range[1], y0: 0, y1: 1, fillcolor: 'rgba(37,99,235,0.08)', line: { color: 'rgba(37,99,235,0.4)', dash: 'dot' } });
  }

  if (background?.linear?.targetRange && background.mode === 'linear') {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: background.linear.targetRange[0], x1: background.linear.targetRange[1], y0: 0, y1: 1, fillcolor: 'rgba(16,185,129,0.08)', line: { color: 'rgba(16,185,129,0.35)', dash: 'dot' } });
    (background.linear.fitRanges ?? []).forEach((range) => {
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: range[0], x1: range[1], y0: 0, y1: 1, fillcolor: 'rgba(16,185,129,0.18)', line: { color: 'rgba(16,185,129,0.55)', width: 1 } });
    });
    const [slope, intercept] = background.linear.coefficients ?? [];
    if (Number.isFinite(slope) && Number.isFinite(intercept) && background.linear.targetRange) {
      const [start, end] = background.linear.targetRange;
      shapes.push({ type: 'line', xref: 'x', yref: 'y', x0: start, x1: end, y0: (slope * start) + intercept, y1: (slope * end) + intercept, line: { color: 'rgba(234,88,12,0.9)', width: 2, dash: 'dash' } });
    }
  }

  const selectionStart = state.ui.backgroundSelection?.startX;
  const selectionCurrent = state.ui.backgroundSelection?.currentX;
  if (state.ui.backgroundSelection?.enabled && Number.isFinite(selectionStart) && Number.isFinite(selectionCurrent) && selectionStart !== selectionCurrent) {
    const include = selectionCurrent >= selectionStart;
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: Math.min(selectionStart, selectionCurrent), x1: Math.max(selectionStart, selectionCurrent), y0: 0, y1: 1, fillcolor: include ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.18)', line: { color: include ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)', dash: 'dash' } });
  }

  return shapes;
}

function bindPlotInteractions(plotEl) {
  if (plotEl.dataset.viewportBound === "true") return;

  plotEl.on("plotly_relayout", async (eventData) => {
    if (isApplyingViewport) return;
    const changed = storeViewportFromRelayout(eventData);
    if (!changed) return;
    await renderPlot();
  });

  plotEl.on("plotly_click", async (eventData) => {
    const point = eventData?.points?.[0];
    const peakData = point?.customdata;
    if (peakData?.isPeakMarker) {
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
      return;
    }

    dispatchPeakEvent(plotEl, "peak-marker-clear");
    if (pointSelectionHandler) {
      await pointSelectionHandler(eventData);
    }
  });

  plotEl.on("plotly_doubleclick", () => {
    dispatchPeakEvent(plotEl, "peak-marker-clear");
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
  viewport.manualXRange = normalizeRange(xRange);
  viewport.selectedXRange = viewport.manualXRange;
  viewport.manualYRange = normalizeRange(yRange);
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
  const prepared = applyOffsets(state.spectra.filter((s) => s.visible), state.ui.offsetStep);
  const selectedSpectrum = getSelectedSpectrum();

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
        dash: s.lineStyle || "solid",
      },
      hovertemplate: "%{x}<br>%{y}<extra>%{fullData.name}</extra>",
    };

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

  const viewportTraces = traces.filter((trace) => Array.isArray(trace.x) && Array.isArray(trace.y) && trace.meta?.traceRole !== "selected-removal-point");
  const resolvedViewport = resolveViewport(viewportTraces);
  const xTypography = buildAxisTypography(resolvedViewport.xAxis, state.ui, "x");
  const yTypography = buildAxisTypography(resolvedViewport.yAxis, state.ui, "y");

  const layout = {
    shapes: createBackgroundShapes(selectedPrepared, resolvedViewport.displayYRange),
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
      font: { size: 13 },
    },
    margin: createLayoutMargins(xTypography, yTypography),
    height: Number(state.ui.plotHeight) || 560,
    hoverlabel: {
      bgcolor: colors.paper,
      bordercolor: colors.axis,
      font: { color: colors.text },
    },
  };

  applyAxisLayout(layout.xaxis, resolvedViewport.xAxis);
  applyAxisLayout(layout.yaxis, resolvedViewport.yAxis);
  layout.xaxis.fixedrange = false;
  layout.yaxis.fixedrange = true;

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["zoom2d", "lasso2d", "select2d", "autoScale2d"],
    scrollZoom: true,
  };

  isApplyingViewport = true;
  await window.Plotly.react(plotEl, traces, layout, config);
  isApplyingViewport = false;
  plotEl.__currentTraces = traces;
  bindPlotInteractions(plotEl);
  bindBackgroundSelectionInteractions(plotEl);
  updateBackgroundSelectionOverlay(plotEl);
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
