import { createId } from "./state.js";

function detectDelimiter(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  if (firstLines.includes("\t")) return "\t";
  if (firstLines.includes(";")) return ";";
  if (firstLines.includes(",")) return ",";
  return null;
}

function parseRows(text) {
  const delimiter = detectDelimiter(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    const parts = delimiter ? line.split(delimiter) : line.split(/\s+/);
    const nums = parts
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));

    if (nums.length >= 2) {
      rows.push(nums);
    }
  }
  return rows;
}

export async function parseSpectrumFile(file) {
  const text = await file.text();
  const rows = parseRows(text);

  if (!rows.length) {
    throw new Error(`${file.name}: 数値データを読み取れませんでした。`);
  }

  const x = rows.map((r) => r[0]);
  const y = rows.map((r) => r[1]);

  return {
    id: createId("spectrum"),
    name: file.name,
    sourceFileName: file.name,
    xRaw: x,
    yRaw: y,
    xProcessed: [...x],
    yProcessed: [...y],
    visible: true,
    color: "",
    lineWidth: 2,
    offset: 0,
    normalization: null,
    detectedPeaks: [],
    selectedRemovalPointIndex: null,
    cosmicRayHistory: [],
    metadata: {
      pointCount: x.length,
    },
  };
}
