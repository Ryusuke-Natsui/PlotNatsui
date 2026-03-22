function cloneArray(values) {
  return Array.isArray(values) ? [...values] : [];
}

function getMeasurementScale(spectrum) {
  const measurementTimeSeconds = Number(spectrum.measurementTimeSeconds);
  return Number.isFinite(measurementTimeSeconds) && measurementTimeSeconds > 0
    ? measurementTimeSeconds
    : null;
}

function normalizeRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function mergeRanges(ranges = []) {
  const normalized = ranges
    .map((range) => normalizeRange(range))
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);

  return normalized.reduce((acc, range) => {
    const last = acc[acc.length - 1];
    if (!last || range[0] > last[1]) {
      acc.push([...range]);
    } else {
      last[1] = Math.max(last[1], range[1]);
    }
    return acc;
  }, []);
}

function subtractRanges(sourceRanges = [], rangeToRemove) {
  const remove = normalizeRange(rangeToRemove);
  if (!remove) return mergeRanges(sourceRanges);

  return mergeRanges(sourceRanges).flatMap((range) => {
    if (remove[1] <= range[0] || remove[0] >= range[1]) return [range];
    const next = [];
    if (remove[0] > range[0]) next.push([range[0], Math.min(remove[0], range[1])]);
    if (remove[1] < range[1]) next.push([Math.max(remove[1], range[0]), range[1]]);
    return next.filter((candidate) => candidate[1] > candidate[0]);
  });
}

function clampRangeToTarget(range, targetRange) {
  const normalizedRange = normalizeRange(range);
  const normalizedTarget = normalizeRange(targetRange);
  if (!normalizedRange || !normalizedTarget) return null;
  const start = Math.max(normalizedRange[0], normalizedTarget[0]);
  const end = Math.min(normalizedRange[1], normalizedTarget[1]);
  return end > start ? [start, end] : null;
}

function ensureBackgroundCorrectionState(spectrum) {
  if (!spectrum.backgroundCorrection || typeof spectrum.backgroundCorrection !== 'object') {
    spectrum.backgroundCorrection = {};
  }

  const background = spectrum.backgroundCorrection;
  background.mode = background.mode ?? 'none';
  background.constant = {
    range: normalizeRange(background.constant?.range),
    value: Number.isFinite(Number(background.constant?.value)) ? Number(background.constant.value) : 0,
  };
  background.linear = {
    targetRange: normalizeRange(background.linear?.targetRange),
    fitRanges: mergeRanges(background.linear?.fitRanges ?? []),
    coefficients: Array.isArray(background.linear?.coefficients) ? [...background.linear.coefficients] : null,
  };

  return background;
}

function getIndicesInRange(xValues, range) {
  const normalized = normalizeRange(range);
  if (!normalized) return [];
  const [start, end] = normalized;
  const indices = [];
  xValues.forEach((rawX, index) => {
    const x = Number(rawX);
    if (Number.isFinite(x) && x >= start && x <= end) indices.push(index);
  });
  return indices;
}

function fitLinearBackground(xValues, yValues, fitRanges) {
  const points = [];
  fitRanges.forEach((range) => {
    getIndicesInRange(xValues, range).forEach((index) => {
      points.push([Number(xValues[index]), Number(yValues[index])]);
    });
  });

  if (points.length < 2) {
    throw new Error('線形バックグラウンドには 2 点以上の近似点が必要です。');
  }

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  points.forEach(([x, y]) => {
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  });

  const n = points.length;
  const denominator = (n * sumXX) - (sumX * sumX);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    throw new Error('選択した範囲では線形近似が安定しません。x が同じ値に偏っていないか確認してください。');
  }

  const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
  const intercept = (sumY - (slope * sumX)) / n;
  return { slope, intercept };
}

export function ensureSpectrumProcessingState(spectrum) {
  if (!spectrum) return;
  ensureBackgroundCorrectionState(spectrum);
  if (!Array.isArray(spectrum.xProcessed)) spectrum.xProcessed = cloneArray(spectrum.xRaw);
  if (!Array.isArray(spectrum.yProcessed)) spectrum.yProcessed = cloneArray(spectrum.yRaw);
  if (!Array.isArray(spectrum.detectedPeaks)) spectrum.detectedPeaks = [];
}

function applyBackgroundCorrection(spectrum) {
  const background = ensureBackgroundCorrectionState(spectrum);
  const x = cloneArray(spectrum.xRaw);
  const yRaw = cloneArray(spectrum.yRaw);
  const yNext = cloneArray(yRaw);

  if (background.mode === 'constant') {
    const range = normalizeRange(background.constant.range);
    const value = Number(background.constant.value) || 0;
    if (range) {
      getIndicesInRange(x, range).forEach((index) => {
        yNext[index] = yRaw[index] - value;
      });
    }
  } else if (background.mode === 'linear') {
    const targetRange = normalizeRange(background.linear.targetRange);
    const fitRanges = mergeRanges((background.linear.fitRanges ?? []).map((range) => clampRangeToTarget(range, targetRange)).filter(Boolean));
    if (targetRange && fitRanges.length) {
      const { slope, intercept } = fitLinearBackground(x, yRaw, fitRanges);
      background.linear.coefficients = [slope, intercept];
      getIndicesInRange(x, targetRange).forEach((index) => {
        yNext[index] = yRaw[index] - ((slope * Number(x[index])) + intercept);
      });
    } else {
      background.linear.coefficients = null;
    }
  } else {
    background.linear.coefficients = background.linear.coefficients ?? null;
  }

  spectrum.xProcessed = x;
  spectrum.yProcessed = yNext;
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = null;
  spectrum.cosmicRayHistory = [];
}

function ensureCleanupState(spectrum) {
  if (!spectrum) {
    throw new Error('スペクトルが選択されていません。');
  }
  ensureSpectrumProcessingState(spectrum);
  if (!Array.isArray(spectrum.cosmicRayHistory)) spectrum.cosmicRayHistory = [];
  if (!Number.isInteger(spectrum.selectedRemovalPointIndex)) spectrum.selectedRemovalPointIndex = null;
}

export function resetProcessed(spectrum) {
  ensureBackgroundCorrectionState(spectrum);
  spectrum.xProcessed = cloneArray(spectrum.xRaw);
  spectrum.yProcessed = cloneArray(spectrum.yRaw);
  spectrum.normalization = null;
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = null;
  spectrum.cosmicRayHistory = [];
  spectrum.backgroundCorrection.mode = 'none';
  spectrum.backgroundCorrection.constant = { range: null, value: 0 };
  spectrum.backgroundCorrection.linear = { targetRange: null, fitRanges: [], coefficients: null };
}

export function setConstantBackground(spectrum, range, value) {
  ensureSpectrumProcessingState(spectrum);
  const normalizedRange = normalizeRange(range);
  const numericValue = Number(value);
  if (!normalizedRange) throw new Error('定数バックグラウンドを適用する範囲を指定してください。');
  if (!Number.isFinite(numericValue)) throw new Error('差し引く定数は数値で入力してください。');
  spectrum.normalization = null;
  spectrum.backgroundCorrection.mode = 'constant';
  spectrum.backgroundCorrection.constant = { range: normalizedRange, value: numericValue };
  spectrum.backgroundCorrection.linear = { ...spectrum.backgroundCorrection.linear, coefficients: null };
  applyBackgroundCorrection(spectrum);
}

export function configureLinearBackground(spectrum, targetRange) {
  ensureSpectrumProcessingState(spectrum);
  const normalizedTarget = normalizeRange(targetRange);
  if (!normalizedTarget) throw new Error('線形バックグラウンドの対象範囲を指定してください。');
  spectrum.normalization = null;
  spectrum.backgroundCorrection.mode = 'linear';
  spectrum.backgroundCorrection.linear = {
    targetRange: normalizedTarget,
    fitRanges: [],
    coefficients: null,
  };
  applyBackgroundCorrection(spectrum);
}

export function updateLinearBackgroundSelection(spectrum, range, selectionMode = 'include') {
  ensureSpectrumProcessingState(spectrum);
  const background = spectrum.backgroundCorrection;
  const targetRange = normalizeRange(background.linear.targetRange);
  const clamped = clampRangeToTarget(range, targetRange);
  if (!clamped) throw new Error('対象範囲内で近似に使う区間をドラッグしてください。');
  const current = mergeRanges(background.linear.fitRanges ?? []);
  background.mode = 'linear';
  background.linear.fitRanges = selectionMode === 'exclude'
    ? subtractRanges(current, clamped)
    : mergeRanges([...current, clamped]);
  applyBackgroundCorrection(spectrum);
}

export function clearLinearBackgroundSelection(spectrum) {
  ensureSpectrumProcessingState(spectrum);
  spectrum.backgroundCorrection.mode = 'linear';
  spectrum.backgroundCorrection.linear.fitRanges = [];
  spectrum.backgroundCorrection.linear.coefficients = null;
  applyBackgroundCorrection(spectrum);
}

export function clearBackgroundCorrection(spectrum) {
  ensureSpectrumProcessingState(spectrum);
  spectrum.backgroundCorrection.mode = 'none';
  spectrum.backgroundCorrection.constant = { range: null, value: 0 };
  spectrum.backgroundCorrection.linear = { targetRange: null, fitRanges: [], coefficients: null };
  spectrum.normalization = null;
  spectrum.xProcessed = cloneArray(spectrum.xRaw);
  spectrum.yProcessed = cloneArray(spectrum.yRaw);
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = null;
  spectrum.cosmicRayHistory = [];
}

export function normalizeByPeakIndex(spectrum, peakIndex) {
  const y = spectrum.yProcessed;
  const scale = y?.[peakIndex];

  if (!Number.isFinite(scale) || scale === 0) {
    throw new Error('選択したピーク強度で正規化できません。');
  }

  spectrum.yProcessed = y.map((v) => v / scale);
  spectrum.normalization = {
    type: 'peak-height',
    peakIndex,
    scale,
  };
}

export function selectRemovalPoint(spectrum, pointIndex) {
  if (!spectrum || !Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= spectrum.yProcessed.length) {
    throw new Error('除去対象の点を選択できませんでした。');
  }
  spectrum.selectedRemovalPointIndex = pointIndex;
}

export function clearRemovalPoint(spectrum) {
  if (!spectrum) return;
  spectrum.selectedRemovalPointIndex = null;
}

export function removeSelectedSpike(spectrum, halfWidth = 1) {
  ensureCleanupState(spectrum);

  const centerIndex = spectrum?.selectedRemovalPointIndex;
  const y = spectrum?.yProcessed;
  if (!Number.isInteger(centerIndex) || !Array.isArray(y) || y.length < 2) {
    throw new Error('先に除去したい点を 1 つ選択してください。');
  }

  const width = Math.max(0, Math.floor(Number(halfWidth) || 0));
  const start = Math.max(0, centerIndex - width);
  const end = Math.min(y.length - 1, centerIndex + width);
  const leftIndex = start - 1;
  const rightIndex = end + 1;
  const next = [...y];
  const originalSegment = y.slice(start, end + 1);

  if (leftIndex >= 0 && rightIndex < y.length) {
    const leftValue = y[leftIndex];
    const rightValue = y[rightIndex];
    const span = rightIndex - leftIndex;
    for (let index = start; index <= end; index += 1) {
      const ratio = (index - leftIndex) / span;
      next[index] = leftValue + ((rightValue - leftValue) * ratio);
    }
  } else {
    const fillValue = leftIndex >= 0 ? y[leftIndex] : y[rightIndex];
    for (let index = start; index <= end; index += 1) {
      next[index] = fillValue;
    }
  }

  spectrum.cosmicRayHistory.push({
    start,
    end,
    values: originalSegment,
    selectedRemovalPointIndex: centerIndex,
  });
  spectrum.yProcessed = next;
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = null;

  return { start, end };
}

export function undoLastSpikeRemoval(spectrum) {
  ensureCleanupState(spectrum);
  const lastEdit = spectrum.cosmicRayHistory.pop();
  if (!lastEdit) {
    throw new Error('元に戻せる宇宙線除去はありません。');
  }

  lastEdit.values.forEach((value, offset) => {
    spectrum.yProcessed[lastEdit.start + offset] = value;
  });
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = lastEdit.selectedRemovalPointIndex;

  return { start: lastEdit.start, end: lastEdit.end };
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
