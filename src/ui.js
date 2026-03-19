import { state, addSpectrum, removeSpectrum, updateSpectrum, selectSpectrum, getSelectedSpectrum, importProject } from "./state.js";
import { parseSpectrumFile } from "./parser.js";
import { renderPlot, exportPlotPng, resetPlotZoom, applyManualAxisRanges, snapCurrentXAxisRange, fixCurrentScale, getCurrentPlotRanges } from "./plot.js";
import { detectPeaks } from "./peaks.js";
import { normalizeByPeakIndex, resetProcessed, hasMeasurementTimeSpectra } from "./process.js";
import { saveProjectJson } from "./export.js";

const X_LABEL_PRESETS = {
  raman: "Raman shift / cm⁻¹",
  pl: "Wavelength / nm",
  energy: "Photon energy / eV",
  custom: null,
};

const Y_LABEL_PRESETS = {
  "a.u.": "Intensity (a.u.)",
  counts: "Intensity (counts)",
  cps: "Intensity (cps)",
  custom: null,
};

function setStatus(message) {
  const el = document.getElementById("statusText");
  if (el) el.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveLabelFromPreset(presetMap, presetKey, fallback) {
  return presetMap[presetKey] ?? fallback;
}

function syncAutoYLabel() {
  if (hasMeasurementTimeSpectra(state.spectra)) {
    state.ui.yLabelPreset = "cps";
    state.ui.yLabel = Y_LABEL_PRESETS.cps;
  } else if (state.ui.yLabelPreset !== "custom") {
    state.ui.yLabel = resolveLabelFromPreset(Y_LABEL_PRESETS, state.ui.yLabelPreset, state.ui.yLabel);
  }
}

function renderTraceList() {
  const container = document.getElementById("traceList");
  if (!container) return;

  if (!state.spectra.length) {
    container.innerHTML = '<div class="empty">まだスペクトルが読み込まれていません。</div>';
    return;
  }

  container.innerHTML = state.spectra.map((s) => `
    <div class="trace-item" data-trace-id="${s.id}">
      <div class="trace-head">
        <button class="trace-select-btn">${state.selectedSpectrumId === s.id ? "Selected" : "Select"}</button>
        <span class="badge">${s.metadata?.pointCount ?? 0} pts</span>
      </div>
      <div class="trace-name">${escapeHtml(s.name)}</div>
      <div class="trace-row">
        <label><input type="checkbox" class="trace-visible" ${s.visible ? "checked" : ""} /> show</label>
        <input type="text" class="trace-rename" value="${escapeHtml(s.name)}" />
        <button class="trace-remove-btn">Remove</button>
      </div>
      <div class="trace-controls">
        <label>
          Line width
          <input type="number" class="trace-width" min="1" step="0.5" value="${Number(s.lineWidth) || 2}" />
        </label>
        <label>
          Offset
          <input type="number" class="trace-offset" step="0.1" value="${Number(s.offset) || 0}" />
        </label>
        <label>
          Measurement time (s)
          <input type="number" class="trace-measurement-time" min="0" step="0.001" placeholder="counts only" value="${s.measurementTimeSeconds ?? ""}" />
        </label>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".trace-item").forEach((item) => {
    const id = item.dataset.traceId;

    item.querySelector(".trace-select-btn")?.addEventListener("click", async () => {
      selectSpectrum(id);
      renderAll();
      await renderPlot();
      setStatus("スペクトルを選択しました。");
    });

    item.querySelector(".trace-visible")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { visible: event.target.checked });
      await renderPlot();
    });

    item.querySelector(".trace-rename")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { name: event.target.value.trim() || "Untitled spectrum" });
      renderTraceList();
      await renderPlot();
    });

    item.querySelector(".trace-width")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { lineWidth: Number(event.target.value) || 2 });
      await renderPlot();
    });

    item.querySelector(".trace-offset")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { offset: Number(event.target.value) || 0 });
      await renderPlot();
    });

    item.querySelector(".trace-measurement-time")?.addEventListener("change", async (event) => {
      const rawValue = event.target.value.trim();
      const measurementTimeSeconds = rawValue === "" ? null : Number(rawValue);
      updateSpectrum(id, {
        measurementTimeSeconds: Number.isFinite(measurementTimeSeconds) && measurementTimeSeconds > 0 ? measurementTimeSeconds : null,
      });
      syncAutoYLabel();
      renderAll();
      await renderPlot();
      setStatus(hasMeasurementTimeSpectra(state.spectra)
        ? "測定時間を反映し、Intensity (cps) に切り替えました。"
        : "測定時間をクリアしました。");
    });

    item.querySelector(".trace-remove-btn")?.addEventListener("click", async () => {
      removeSpectrum(id);
      syncAutoYLabel();
      renderAll();
      await renderPlot();
      setStatus("スペクトルを削除しました。");
    });
  });
}

function renderPeakList() {
  const container = document.getElementById("peakList");
  if (!container) return;

  const spectrum = getSelectedSpectrum();
  const peaks = spectrum?.detectedPeaks ?? [];

  if (!spectrum) {
    container.innerHTML = '<div class="empty">スペクトルを選択してください。</div>';
    return;
  }

  if (!peaks.length) {
    container.innerHTML = '<div class="empty">ピークはまだ検出されていません。</div>';
    return;
  }

  container.innerHTML = peaks.map((p, idx) => `
    <div class="peak-item">
      <div><strong>#${idx + 1}</strong></div>
      <div>x = ${Number(p.x).toFixed(4)}</div>
      <div>y = ${Number(p.y).toFixed(4)}</div>
      <div>prominence = ${Number(p.prominence).toFixed(4)}</div>
      <button data-peak-index="${p.index}">Normalize to this peak = 1</button>
    </div>
  `).join("");

  container.querySelectorAll("button[data-peak-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const peakIndex = Number(btn.dataset.peakIndex);
      const target = getSelectedSpectrum();
      if (!target) return;
      try {
        normalizeByPeakIndex(target, peakIndex);
        await renderPlot();
        setStatus("選択ピークを 1 に正規化しました。");
      } catch (error) {
        setStatus(error.message);
      }
    });
  });
}

function parseOptionalNumber(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return null;
  const value = input.value.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRangeFromInputs(minId, maxId) {
  const min = parseOptionalNumber(minId);
  const max = parseOptionalNumber(maxId);
  if (min === null || max === null || min === max) return null;
  return min < max ? [min, max] : [max, min];
}

function renderLabelControls() {
  const xPresetInput = document.getElementById("xLabelPresetInput");
  const yPresetInput = document.getElementById("yLabelPresetInput");
  const xLabelInput = document.getElementById("xLabelInput");
  const yLabelInput = document.getElementById("yLabelInput");

  if (xPresetInput) xPresetInput.value = state.ui.xLabelPreset;
  if (yPresetInput) yPresetInput.value = hasMeasurementTimeSpectra(state.spectra) ? "cps" : state.ui.yLabelPreset;
  if (xLabelInput) xLabelInput.value = state.ui.xLabel;
  if (yLabelInput) yLabelInput.value = state.ui.yLabel;
  if (xLabelInput) xLabelInput.disabled = state.ui.xLabelPreset !== "custom";
  if (yLabelInput) yLabelInput.disabled = hasMeasurementTimeSpectra(state.spectra) || state.ui.yLabelPreset !== "custom";
}

export function renderAll() {
  syncAutoYLabel();
  document.body.classList.toggle("dark", state.ui.theme === "dark");
  renderLabelControls();
  document.getElementById("themeSelect").value = state.ui.theme;
  document.getElementById("offsetStepInput").value = state.ui.offsetStep;
  document.getElementById("plotHeightInput").value = state.ui.plotHeight;
  document.getElementById("axisTitleFontSizeInput").value = state.ui.axisTitleFontSize;
  document.getElementById("axisTickFontSizeInput").value = state.ui.axisTickFontSize;
  renderTraceList();
  renderPeakList();
}

async function handleSpectrumFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    try {
      const spectrum = await parseSpectrumFile(file);
      addSpectrum(spectrum);
    } catch (error) {
      setStatus(error.message);
    }
  }
  syncAutoYLabel();
  renderAll();
  await renderPlot();
  setStatus(`${files.length} file(s) loaded.`);
}

async function handleProjectFile(file) {
  const text = await file.text();
  const project = JSON.parse(text);
  importProject(project);
  renderAll();
  await renderPlot();
  setStatus("プロジェクトを読み込みました。");
}

function bindFileDropTarget(dropzone, onDropFiles) {
  if (!dropzone) return;

  let dragDepth = 0;

  const isFileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const setDragActive = (active) => {
    dropzone.classList.toggle("drag-active", active);
  };

  dropzone.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setDragActive(true);
  });

  dropzone.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  });

  dropzone.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragActive(false);
  });

  dropzone.addEventListener("dragend", () => {
    dragDepth = 0;
    setDragActive(false);
  });

  dropzone.addEventListener("drop", async (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setDragActive(false);
    if (event.dataTransfer?.files?.length) {
      await onDropFiles(event.dataTransfer.files);
    }
  });
}

function bindSpectrumDropzones() {
  const fileInput = document.getElementById("fileInput");
  const dropzones = [document.getElementById("fileDropzone"), document.getElementById("plotDropzone")].filter(Boolean);
  if (!fileInput || !dropzones.length) return;

  dropzones.forEach((dropzone) => {
    bindFileDropTarget(dropzone, async (files) => {
      await handleSpectrumFiles(files);
      fileInput.value = "";
    });
  });
}

export function bindUi() {
  document.getElementById("fileInput")?.addEventListener("change", async (event) => {
    if (event.target.files?.length) {
      await handleSpectrumFiles(event.target.files);
      event.target.value = "";
    }
  });

  bindSpectrumDropzones();

  document.getElementById("projectInput")?.addEventListener("change", async (event) => {
    if (event.target.files?.[0]) {
      await handleProjectFile(event.target.files[0]);
      event.target.value = "";
    }
  });

  document.getElementById("xLabelPresetInput")?.addEventListener("change", (event) => {
    const preset = event.target.value;
    state.ui.xLabelPreset = preset;
    if (preset !== "custom") {
      state.ui.xLabel = resolveLabelFromPreset(X_LABEL_PRESETS, preset, state.ui.xLabel);
    }
    renderLabelControls();
  });

  document.getElementById("yLabelPresetInput")?.addEventListener("change", (event) => {
    if (hasMeasurementTimeSpectra(state.spectra)) {
      renderLabelControls();
      return;
    }
    const preset = event.target.value;
    state.ui.yLabelPreset = preset;
    if (preset !== "custom") {
      state.ui.yLabel = resolveLabelFromPreset(Y_LABEL_PRESETS, preset, state.ui.yLabel);
    }
    renderLabelControls();
  });

  document.getElementById("resetZoomBtn")?.addEventListener("click", async () => {
    await resetPlotZoom();
    setStatus("ズームをリセットしました。");
  });

  document.getElementById("applyAxisRangeBtn")?.addEventListener("click", async () => {
    const xRange = getRangeFromInputs("xRangeMinInput", "xRangeMaxInput");
    const yRange = getRangeFromInputs("yRangeMinInput", "yRangeMaxInput");
    const lockXRange = document.getElementById("lockXRangeInput")?.checked ?? false;
    const lockYRange = document.getElementById("lockYRangeInput")?.checked ?? false;
    const snapXRange = document.getElementById("snapXRangeInput")?.checked ?? true;

    applyManualAxisRanges({ xRange, yRange, lockXRange, lockYRange, snapXRange });
    await renderPlot();
    setStatus("数値指定の表示範囲を適用しました。");
  });

  document.getElementById("snapXAxisBtn")?.addEventListener("click", async () => {
    await snapCurrentXAxisRange();
    setStatus("現在の x 表示範囲を切りのいい目盛りに合わせました。");
  });

  document.getElementById("fixScaleBtn")?.addEventListener("click", async () => {
    await fixCurrentScale();
    const { xRange, yRange } = getCurrentPlotRanges();
    document.getElementById("lockXRangeInput").checked = Boolean(xRange);
    document.getElementById("lockYRangeInput").checked = Boolean(yRange);
    setStatus("現在の表示範囲を固定スケールとして保存しました。");
  });

  document.getElementById("applyViewBtn")?.addEventListener("click", async () => {
    const xPreset = document.getElementById("xLabelPresetInput").value;
    const yPreset = document.getElementById("yLabelPresetInput").value;
    state.ui.xLabelPreset = xPreset;
    state.ui.yLabelPreset = hasMeasurementTimeSpectra(state.spectra) ? "cps" : yPreset;
    state.ui.xLabel = xPreset === "custom"
      ? (document.getElementById("xLabelInput").value.trim() || state.ui.xLabel)
      : resolveLabelFromPreset(X_LABEL_PRESETS, xPreset, state.ui.xLabel);
    state.ui.yLabel = state.ui.yLabelPreset === "custom"
      ? (document.getElementById("yLabelInput").value.trim() || state.ui.yLabel)
      : resolveLabelFromPreset(Y_LABEL_PRESETS, state.ui.yLabelPreset, state.ui.yLabel);
    syncAutoYLabel();
    state.ui.theme = document.getElementById("themeSelect").value;
    state.ui.offsetStep = Number(document.getElementById("offsetStepInput").value) || 0;
    state.ui.plotHeight = Number(document.getElementById("plotHeightInput").value) || 560;
    state.ui.axisTitleFontSize = Number(document.getElementById("axisTitleFontSizeInput").value) || 30;
    state.ui.axisTickFontSize = Number(document.getElementById("axisTickFontSizeInput").value) || 18;
    renderAll();
    await renderPlot();
    setStatus("表示設定を更新しました。");
  });

  document.getElementById("detectPeaksBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) {
      setStatus("先にスペクトルを選択してください。");
      return;
    }

    const minProminence = Number(document.getElementById("prominenceInput").value) || 0;
    const minDistance = Number(document.getElementById("distanceInput").value) || 5;
    spectrum.detectedPeaks = detectPeaks(spectrum.xProcessed, spectrum.yProcessed, { minProminence, minDistance });
    renderPeakList();
    setStatus(`${spectrum.detectedPeaks.length} peak(s) detected.`);
  });

  document.getElementById("resetNormalizationBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    resetProcessed(spectrum);
    spectrum.detectedPeaks = [];
    renderPeakList();
    await renderPlot();
    setStatus("選択スペクトルを元データに戻しました。");
  });

  document.getElementById("exportPngBtn")?.addEventListener("click", async () => {
    await exportPlotPng();
    setStatus("PNG を書き出しました。");
  });

  document.getElementById("saveProjectBtn")?.addEventListener("click", () => {
    saveProjectJson();
    setStatus("プロジェクト JSON を保存しました。");
  });
}
