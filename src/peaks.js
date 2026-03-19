export function detectPeaks(x, y, options = {}) {
  const minProminence = Number(options.minProminence ?? options.prominence ?? 10);
  const minDistance = Math.max(1, Number(options.minDistance ?? 5));

  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 3) {
    return [];
  }

  const peaks = [];
  let lastAccepted = -Infinity;

  for (let i = 1; i < y.length - 1; i += 1) {
    const isLocalMax = y[i] > y[i - 1] && y[i] >= y[i + 1];
    if (!isLocalMax) continue;

    const leftBase = Math.min(y[i - 1], y[Math.max(0, i - minDistance)]);
    const rightBase = Math.min(y[i + 1], y[Math.min(y.length - 1, i + minDistance)]);
    const prominence = y[i] - Math.max(leftBase, rightBase);

    if (prominence < minProminence) continue;
    if (i - lastAccepted < minDistance) continue;

    peaks.push({
      index: i,
      x: x[i],
      y: y[i],
      prominence,
    });
    lastAccepted = i;
  }

  return peaks;
}
