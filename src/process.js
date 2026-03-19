function cloneArray(values) {
  return Array.isArray(values) ? [...values] : [];
}

function getMeasurementScale(spectrum) {
  const measurementTimeSeconds = Number(spectrum.measurementTimeSeconds);
  return Number.isFinite(measurementTimeSeconds) && measurementTimeSeconds > 0
    ? measurementTimeSeconds
    : null;
}

export function resetProcessed(spectrum) {
  spectrum.xProcessed = cloneArray(spectrum.xRaw);
  spectrum.yProcessed = cloneArray(spectrum.yRaw);
  spectrum.normalization = null;
}

export function normalizeByPeakIndex(spectrum, peakIndex) {
  const y = spectrum.yProcessed;
  const scale = y?.[peakIndex];

  if (!Number.isFinite(scale) || scale === 0) {
    throw new Error("選択したピーク強度で正規化できません。");
  }

  spectrum.yProcessed = y.map((v) => v / scale);
  spectrum.normalization = {
    type: "peak-height",
    peakIndex,
    scale,
  };
}

export function applyOffsets(spectra, offsetStep = 0) {
  return spectra.map((s, index) => {
    const shift = Number(offsetStep) * index;
    const measurementScale = getMeasurementScale(s);
    return {
      ...s,
      xPlot: s.xProcessed,
      yPlot: s.yProcessed.map((v) => (measurementScale ? v / measurementScale : v) + shift + (Number(s.offset) || 0)),
    };
  });
}

export function hasMeasurementTimeSpectra(spectra) {
  return spectra.some((s) => getMeasurementScale(s));
}
