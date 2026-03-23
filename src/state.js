function normalizeSpectrumState(spectrum) {
  return {
    ...spectrum,
    xProcessed: Array.isArray(spectrum.xProcessed) ? spectrum.xProcessed : [...(spectrum.xRaw ?? [])],
    yProcessed: Array.isArray(spectrum.yProcessed) ? spectrum.yProcessed : [...(spectrum.yRaw ?? [])],
    normalization: spectrum.normalization && typeof spectrum.normalization === 'object'
      ? {
        type: spectrum.normalization.type ?? null,
        peakIndex: Number.isInteger(spectrum.normalization.peakIndex) ? spectrum.normalization.peakIndex : null,
        scale: Number.isFinite(Number(spectrum.normalization.scale)) ? Number(spectrum.normalization.scale) : null,
      }
      : null,
    detectedPeaks: Array.isArray(spectrum.detectedPeaks) ? spectrum.detectedPeaks : [],
    selectedRemovalPointIndex: Number.isInteger(spectrum.selectedRemovalPointIndex)
      ? spectrum.selectedRemovalPointIndex
      : null,
    cosmicRayHistory: Array.isArray(spectrum.cosmicRayHistory)
      ? spectrum.cosmicRayHistory.map((entry) => ({
        start: Number.isInteger(entry?.start) ? entry.start : null,
        end: Number.isInteger(entry?.end) ? entry.end : null,
        selectedRemovalPointIndex: Number.isInteger(entry?.selectedRemovalPointIndex)
          ? entry.selectedRemovalPointIndex
          : null,
      })).filter((entry) => Number.isInteger(entry.start) && Number.isInteger(entry.end))
      : [],
    backgroundCorrection: {
      mode: spectrum.backgroundCorrection?.mode ?? 'none',
      constant: {
        range: Array.isArray(spectrum.backgroundCorrection?.constant?.range) ? [...spectrum.backgroundCorrection.constant.range] : null,
        value: Number.isFinite(Number(spectrum.backgroundCorrection?.constant?.value)) ? Number(spectrum.backgroundCorrection.constant.value) : 0,
      },
      linear: {
        targetRange: Array.isArray(spectrum.backgroundCorrection?.linear?.targetRange) ? [...spectrum.backgroundCorrection.linear.targetRange] : null,
        fitRanges: Array.isArray(spectrum.backgroundCorrection?.linear?.fitRanges) ? spectrum.backgroundCorrection.linear.fitRanges.map((range) => [...range]) : [],
        coefficients: Array.isArray(spectrum.backgroundCorrection?.linear?.coefficients) ? [...spectrum.backgroundCorrection.linear.coefficients] : null,
      },
    },
  };
}

export const state = {
  spectra: [],
  selectedSpectrumId: null,
  ui: {
    xLabel: "Raman shift / cm⁻¹",
    yLabel: "Intensity (a.u.)",
    xLabelPreset: "raman",
    yLabelPreset: "a.u.",
    theme: "light",
    offsetStep: 0,
    plotHeight: 560,
    axisTitleFontSize: 30,
    axisTickFontSize: 18,
    plotViewport: {
      selectedXRange: null,
      manualXRange: null,
      manualYRange: null,
      lockXRange: false,
      lockYRange: false,
      snapXRange: false,
    },
    cosmicRayRemoval: {
      enabled: false,
      halfWidth: 1,
    },
    backgroundSelection: {
      enabled: false,
      mode: 'include',
      startX: null,
      currentX: null,
    },
  },
};

export function createId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getSelectedSpectrum() {
  return state.spectra.find((s) => s.id === state.selectedSpectrumId) ?? null;
}

export function addSpectrum(spectrum) {
  state.spectra.push(normalizeSpectrumState(spectrum));
  if (!state.selectedSpectrumId) {
    state.selectedSpectrumId = spectrum.id;
  }
}

export function removeSpectrum(id) {
  state.spectra = state.spectra.filter((s) => s.id !== id);
  if (state.selectedSpectrumId === id) {
    state.selectedSpectrumId = state.spectra[0]?.id ?? null;
  }
}

export function updateSpectrum(id, patch) {
  const target = state.spectra.find((s) => s.id === id);
  if (!target) return;
  Object.assign(target, patch);
}

export function selectSpectrum(id) {
  state.selectedSpectrumId = id;
}

export function exportProject() {
  return JSON.stringify(state, null, 2);
}

function sanitizeRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function sanitizeUiState(ui = {}, previousUi = state.ui) {
  const importedViewport = ui.plotViewport ?? {};
  const importedCosmicRayRemoval = ui.cosmicRayRemoval ?? {};

  return {
    ...previousUi,
    ...ui,
    xLabelPreset: ui.xLabelPreset ?? previousUi.xLabelPreset,
    yLabelPreset: ui.yLabelPreset ?? previousUi.yLabelPreset,
    plotViewport: {
      ...previousUi.plotViewport,
      ...importedViewport,
      selectedXRange: sanitizeRange(importedViewport.selectedXRange),
      manualXRange: sanitizeRange(importedViewport.manualXRange),
      manualYRange: sanitizeRange(importedViewport.manualYRange),
      lockXRange: Boolean(importedViewport.lockXRange),
      lockYRange: Boolean(importedViewport.lockYRange),
      snapXRange: importedViewport.snapXRange !== false,
    },
    cosmicRayRemoval: {
      ...previousUi.cosmicRayRemoval,
      ...importedCosmicRayRemoval,
      enabled: Boolean(importedCosmicRayRemoval.enabled),
      halfWidth: Number.isFinite(Number(importedCosmicRayRemoval.halfWidth))
        ? Math.max(0, Math.floor(Number(importedCosmicRayRemoval.halfWidth)))
        : previousUi.cosmicRayRemoval.halfWidth,
    },
    backgroundSelection: {
      ...previousUi.backgroundSelection,
      enabled: false,
      mode: 'include',
      startX: null,
      currentX: null,
    },
  };
}

export function importProject(project) {
  if (!project || typeof project !== "object") {
    throw new Error("プロジェクト JSON の形式が不正です。");
  }

  state.spectra = (project.spectra ?? []).map((spectrum) => normalizeSpectrumState({
    visible: true,
    color: "",
    lineStyle: "solid",
    lineWidth: 2,
    offset: 0,
    detectedPeaks: [],
    metadata: {},
    measurementTimeSeconds: null,
    ...spectrum,
  }));
  state.selectedSpectrumId = state.spectra.some((spectrum) => spectrum.id === project.selectedSpectrumId)
    ? project.selectedSpectrumId
    : state.spectra[0]?.id ?? null;
  state.ui = sanitizeUiState(project.ui, state.ui);
}
