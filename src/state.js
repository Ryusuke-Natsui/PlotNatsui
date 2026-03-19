function normalizeSpectrumState(spectrum) {
  return {
    ...spectrum,
    xProcessed: Array.isArray(spectrum.xProcessed) ? spectrum.xProcessed : [...(spectrum.xRaw ?? [])],
    yProcessed: Array.isArray(spectrum.yProcessed) ? spectrum.yProcessed : [...(spectrum.yRaw ?? [])],
    detectedPeaks: Array.isArray(spectrum.detectedPeaks) ? spectrum.detectedPeaks : [],
    selectedRemovalPointIndex: Number.isInteger(spectrum.selectedRemovalPointIndex)
      ? spectrum.selectedRemovalPointIndex
      : null,
    cosmicRayHistory: Array.isArray(spectrum.cosmicRayHistory) ? spectrum.cosmicRayHistory : [],
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
      snapXRange: true,
    },
    cosmicRayRemoval: {
      enabled: false,
      halfWidth: 1,
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

export function importProject(project) {
  state.spectra = (project.spectra ?? []).map((spectrum) => ({
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
  state.selectedSpectrumId = project.selectedSpectrumId ?? state.spectra[0]?.id ?? null;
  state.ui = {
    ...state.ui,
    ...(project.ui ?? {}),
    xLabelPreset: project.ui?.xLabelPreset ?? state.ui.xLabelPreset,
    yLabelPreset: project.ui?.yLabelPreset ?? state.ui.yLabelPreset,
    plotViewport: {
      ...state.ui.plotViewport,
      ...(project.ui?.plotViewport ?? {}),
    },
    cosmicRayRemoval: {
      ...state.ui.cosmicRayRemoval,
      ...(project.ui?.cosmicRayRemoval ?? {}),
    },
  };
}
