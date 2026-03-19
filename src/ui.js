import { state, addSpectrum, removeSpectrum, updateSpectrum, selectSpectrum, getSelectedSpectrum, importProject } from "./state.js";
import { parseSpectrumFile } from "./parser.js";
import { renderPlot, exportPlotPng } from "./plot.js";
import { detectPeaks } from "./peaks.js";
import { normalizeByPeakIndex, resetProcessed } from "./process.js";
import { saveProjectJson } from "./export.js";

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
}

export function bindUi() {
  document.getElementById("fileInput")?.addEventListener("change", async (event) => {
    if (event.target.files?.length) {
      await handleSpectrumFiles(event.target.files);
      event.target.value = "";
    }
  });

  bindSpectrumDropzone();

  document.getElementById("projectInput")?.addEventListener("change", async (event) => {
    if (event.target.files?.[0]) {
      await handleProjectFile(event.target.files[0]);
      event.target.value = "";
    }
  });

  document.getElementById("applyViewBtn")?.addEventListener("click", async () => {
    state.ui.xLabel = document.getElementById("xLabelInput").value.trim() || state.ui.xLabel;
    state.ui.yLabel = document.getElementById("yLabelInput").value.trim() || state.ui.yLabel;
    state.ui.theme = document.getElementById("themeSelect").value;
    state.ui.offsetStep = Number(document.getElementById("offsetStepInput").value) || 0;
    state.ui.plotHeight = Number(document.getElementById("plotHeightInput").value) || 560;
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
