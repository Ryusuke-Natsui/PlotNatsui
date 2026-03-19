export const state = {
  spectra: [],
  selectedSpectrumId: null,
  ui: {
    xLabel: "Raman shift / cm⁻¹",
    yLabel: "Intensity / a.u.",
    theme: "light",
    offsetStep: 0,
    plotHeight: 560,
    plotViewport: {
      selectedXRange: null,
      manualXRange: null,
      manualYRange: null,
      lockXRange: false,
      lockYRange: false,
      snapXRange: true,
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
  state.spectra.push(spectrum);
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
    ...spectrum,
  }));
  state.selectedSpectrumId = project.selectedSpectrumId ?? state.spectra[0]?.id ?? null;
  state.ui = {
    ...state.ui,
    ...(project.ui ?? {}),
    plotViewport: {
      ...state.ui.plotViewport,
      ...(project.ui?.plotViewport ?? {}),
    },
  };
}
