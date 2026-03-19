function cloneArray(values) {
  return Array.isArray(values) ? [...values] : [];
}

function ensureCleanupState(spectrum) {
  if (!Array.isArray(spectrum.cosmicRayHistory)) spectrum.cosmicRayHistory = [];
}

export function resetProcessed(spectrum) {
  spectrum.xProcessed = cloneArray(spectrum.xRaw);
  spectrum.yProcessed = cloneArray(spectrum.yRaw);
  spectrum.normalization = null;
  spectrum.detectedPeaks = [];
  spectrum.selectedRemovalPointIndex = null;
  spectrum.cosmicRayHistory = [];
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

export function selectRemovalPoint(spectrum, pointIndex) {
  if (!spectrum || !Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= spectrum.yProcessed.length) {
    throw new Error("除去対象の点を選択できませんでした。");
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
    throw new Error("先に除去したい点を 1 つ選択してください。");
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
    throw new Error("元に戻せる宇宙線除去はありません。");
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
    return {
      ...s,
      xPlot: s.xProcessed,
      yPlot: s.yProcessed.map((v) => v + shift + (Number(s.offset) || 0)),
    };
  });
}
