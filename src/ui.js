import { state, addSpectrum, removeSpectrum, updateSpectrum, selectSpectrum, getSelectedSpectrum, importProject } from "./state.js";
import { parseSpectrumFile } from "./parser.js";
import { renderPlot, exportPlotPng, resetPlotZoom, applyManualAxisRanges, snapCurrentXAxisRange, fixCurrentScale, getCurrentPlotRanges } from "./plot.js";
import { detectPeaks } from "./peaks.js";
import { normalizeByPeakIndex, resetProcessed } from "./process.js";
import { saveProjectJson } from "./export.js";

const DEFAULT_TRACE_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#0891b2", "#4b5563", "#db2777", "#65a30d", "#ea580c",
];

const TRACE_LINE_STYLE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
  { value: "dashdot", label: "Dash dot" },
];

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

function renderTraceList() {
  const container = document.getElementById("traceList");
  if (!container) return;

  if (!state.spectra.length) {
    container.innerHTML = '<div class="empty">まだスペクトルが読み込まれていません。</div>';
    return;
  }

  container.innerHTML = state.spectra.map((s, index) => {
    const fallbackColor = s.color || DEFAULT_TRACE_COLORS[index % DEFAULT_TRACE_COLORS.length];
    const styleOptions = TRACE_LINE_STYLE_OPTIONS.map((option) => `
      <option value="${option.value}" ${(s.lineStyle || "solid") === option.value ? "selected" : ""}>${option.label}</option>
    `).join("");

    return `
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
        <div class="trace-controls trace-controls-extended">
          <label>
            Color
            <div class="trace-color-row">
              <input type="color" class="trace-color-picker" value="${escapeHtml(fallbackColor)}" />
              <input type="text" class="trace-color-text" value="${escapeHtml(fallbackColor)}" placeholder="#2563eb" />
            </div>
          </label>
          <label>
            Line style
            <select class="trace-line-style">${styleOptions}</select>
          </label>
          <label>
            Line width
            <input type="number" class="trace-width" min="1" step="0.5" value="${Number(s.lineWidth) || 2}" />
          </label>
          <label>
            Offset
            <input type="number" class="trace-offset" step="0.1" value="${Number(s.offset) || 0}" />
          </label>
        </div>
      </div>
    `;
  }).join("");

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

    const colorPicker = item.querySelector(".trace-color-picker");
    const colorText = item.querySelector(".trace-color-text");

    const applyTraceColor = async (rawValue) => {
      const normalizedColor = normalizeHexColor(rawValue);
      if (!normalizedColor) {
        const spectrumIndex = state.spectra.findIndex((entry) => entry.id === id);
        const fallback = spectrumIndex >= 0 ? DEFAULT_TRACE_COLORS[spectrumIndex % DEFAULT_TRACE_COLORS.length] : "#2563eb";
        const spectrum = state.spectra.find((entry) => entry.id === id);
        colorText.value = spectrum?.color || fallback;
        return;
      }
      if (colorPicker) colorPicker.value = normalizedColor;
      if (colorText) colorText.value = normalizedColor;
      updateSpectrum(id, { color: normalizedColor });
      await renderPlot();
    };

    colorPicker?.addEventListener("input", async (event) => {
      await applyTraceColor(event.target.value);
    });

    colorText?.addEventListener("change", async (event) => {
      await applyTraceColor(event.target.value);
    });

    item.querySelector(".trace-line-style")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { lineStyle: event.target.value || "solid" });
      await renderPlot();
    });

    item.querySelector(".trace-offset")?.addEventListener("change", async (event) => {
      updateSpectrum(id, { offset: Number(event.target.value) || 0 });
      await renderPlot();
    });

    item.querySelector(".trace-remove-btn")?.addEventListener("click", async () => {
      removeSpectrum(id);
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

function normalizeHexColor(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
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

export function renderAll() {
  document.body.classList.toggle("dark", state.ui.theme === "dark");
  document.getElementById("xLabelInput").value = state.ui.xLabel;
  document.getElementById("yLabelInput").value = state.ui.yLabel;
  document.getElementById("themeSelect").value = state.ui.theme;
  document.getElementById("offsetStepInput").value = state.ui.offsetStep;
  document.getElementById("plotHeightInput").value = state.ui.plotHeight;
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

function bindSpectrumDropzone() {
  const dropzone = document.getElementById("fileDropzone");
  const fileInput = document.getElementById("fileInput");
  if (!dropzone || !fileInput) return;

  const setDragActive = (active) => {
    dropzone.classList.toggle("drag-active", active);
  };

  ["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      setDragActive(true);
    });
  });

  ["dragleave", "dragend"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (!dropzone.contains(event.relatedTarget)) {
        setDragActive(false);
      }
    });
  });

  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer?.files?.length) {
      await handleSpectrumFiles(event.dataTransfer.files);
      fileInput.value = "";
    }
  });

  fileInput.addEventListener("change", async (event) => {
    if (event.target.files?.length) {
      await handleSpectrumFiles(event.target.files);
      event.target.value = "";
    }
  });
}

export function bindUi() {
  bindSpectrumDropzone();

  document.getElementById("projectInput")?.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    await handleProjectFile(file);
    event.target.value = "";
  });

  document.getElementById("exportPngBtn")?.addEventListener("click", async () => {
    await exportPlotPng();
  });

  document.getElementById("saveProjectBtn")?.addEventListener("click", () => {
    saveProjectJson();
    setStatus("プロジェクトを書き出しました。");
  });

  document.getElementById("applyViewBtn")?.addEventListener("click", async () => {
    state.ui.xLabel = document.getElementById("xLabelInput").value.trim() || "X";
    state.ui.yLabel = document.getElementById("yLabelInput").value.trim() || "Y";
    state.ui.theme = document.getElementById("themeSelect").value;
    state.ui.offsetStep = Number(document.getElementById("offsetStepInput").value) || 0;
    state.ui.plotHeight = Number(document.getElementById("plotHeightInput").value) || 560;
    renderAll();
    await renderPlot();
    setStatus("表示設定を更新しました。");
  });

  document.getElementById("applyAxisRangeBtn")?.addEventListener("click", async () => {
    const xRange = getRangeFromInputs("xRangeMinInput", "xRangeMaxInput");
    const yRange = getRangeFromInputs("yRangeMinInput", "yRangeMaxInput");
    const lockXRange = document.getElementById("lockXRangeInput")?.checked;
    const lockYRange = document.getElementById("lockYRangeInput")?.checked;
    const snapXRange = document.getElementById("snapXRangeInput")?.checked;

    applyManualAxisRanges({ xRange, yRange, lockXRange, lockYRange, snapXRange });
    await renderPlot();
    setStatus("軸範囲を更新しました。");
  });

  document.getElementById("snapXAxisBtn")?.addEventListener("click", async () => {
    await snapCurrentXAxisRange();
    setStatus("現在の x 軸範囲を切りのいい値にスナップしました。");
  });

  document.getElementById("fixScaleBtn")?.addEventListener("click", async () => {
    await fixCurrentScale();
    renderAll();
    setStatus("現在の表示範囲で軸スケールを固定しました。");
  });

  document.getElementById("resetZoomBtn")?.addEventListener("click", async () => {
    await resetPlotZoom();
    setStatus("ズームをリセットしました。");
  });

  document.getElementById("detectPeaksBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) {
      setStatus("ピーク検出するスペクトルを選択してください。");
      return;
    }

    const prominence = Number(document.getElementById("prominenceInput").value) || 0;
    const minDistance = Number(document.getElementById("distanceInput").value) || 1;
    spectrum.detectedPeaks = detectPeaks(spectrum.xProcessed, spectrum.yProcessed, { prominence, minDistance });
    renderPeakList();
    await renderPlot();
    setStatus(`${spectrum.detectedPeaks.length} 個のピークを検出しました。`);
  });

  document.getElementById("resetNormalizationBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    resetProcessed(spectrum);
    renderPeakList();
    await renderPlot();
    setStatus("選択スペクトルの正規化をリセットしました。");
  });

  window.addEventListener("resize", async () => {
    const { xRange, yRange } = getCurrentPlotRanges();
    if (xRange || yRange) {
      applyManualAxisRanges({
        xRange,
        yRange,
        lockXRange: document.getElementById("lockXRangeInput")?.checked,
        lockYRange: document.getElementById("lockYRangeInput")?.checked,
        snapXRange: document.getElementById("snapXRangeInput")?.checked,
      });
    }
    await renderPlot();
  });
}
