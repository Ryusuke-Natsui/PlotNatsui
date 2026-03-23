import {
  state,
  addSpectrum,
  removeSpectrum,
  updateSpectrum,
  selectSpectrum,
  getSelectedSpectrum,
  importProject,
} from "./state.js";
import { parseSpectrumFile } from "./parser.js";
import {
  renderPlot,
  exportPlotPng,
  resetPlotZoom,
  applyManualAxisRanges,
  snapCurrentXAxisRange,
  fixCurrentScale,
  setPlotPointSelectionHandler,
  setPlotBackgroundRangeSelectionHandler,
} from "./plot.js";
import { detectPeaks } from "./peaks.js";
import {
  normalizeByPeakIndex,
  resetProcessed,
  hasMeasurementTimeSpectra,
  selectRemovalPoint,
  clearRemovalPoint,
  removeSelectedSpike,
  undoLastSpikeRemoval,
  setConstantBackground,
  configureLinearBackground,
  updateLinearBackgroundSelection,
  clearLinearBackgroundSelection,
  clearBackgroundCorrection,
  ensureSpectrumProcessingState,
} from "./process.js";
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

const peakMenuState = {
  open: false,
  spectrumId: null,
  peakIndex: null,
  peakNumber: null,
  x: null,
  y: null,
  prominence: null,
  clientX: 0,
  clientY: 0,
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

function normalizeHexColor(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
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

function resetPeakMenuState() {
  peakMenuState.open = false;
  peakMenuState.spectrumId = null;
  peakMenuState.peakIndex = null;
  peakMenuState.peakNumber = null;
  peakMenuState.x = null;
  peakMenuState.y = null;
  peakMenuState.prominence = null;
  peakMenuState.clientX = 0;
  peakMenuState.clientY = 0;
}

function closePeakMenu() {
  resetPeakMenuState();
}

function openPeakMenu(detail = {}) {
  peakMenuState.open = true;
  peakMenuState.spectrumId = detail.spectrumId ?? null;
  peakMenuState.peakIndex = detail.peakIndex ?? null;
  peakMenuState.peakNumber = detail.peakNumber ?? null;
  peakMenuState.x = detail.x ?? null;
  peakMenuState.y = detail.y ?? null;
  peakMenuState.prominence = detail.prominence ?? null;
  peakMenuState.clientX = detail.clientX ?? 0;
  peakMenuState.clientY = detail.clientY ?? 0;
}

function formatPeakMenuMeta() {
  if (!peakMenuState.open) {
    return "ピークをクリックするとここに情報を表示します。";
  }

  return [
    `#${peakMenuState.peakNumber}`,
    `x = ${Number(peakMenuState.x).toFixed(4)}`,
    `y = ${Number(peakMenuState.y).toFixed(4)}`,
    `prominence = ${Number(peakMenuState.prominence).toFixed(4)}`,
  ].join("<br>");
}

function renderPeakMenu() {
  const menu = document.getElementById("peakMenu");
  const meta = document.getElementById("peakMenuMeta");
  const normalizeBtn = document.getElementById("normalizePeakBtn");
  if (!menu || !meta || !normalizeBtn) return;

  meta.innerHTML = formatPeakMenuMeta();
  normalizeBtn.disabled = !peakMenuState.open;

  if (!peakMenuState.open) {
    menu.hidden = true;
    menu.style.left = "";
    menu.style.top = "";
    return;
  }

  menu.hidden = false;
  const stage = menu.parentElement;
  const stageRect = stage?.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 240;
  const menuHeight = menu.offsetHeight || 140;
  const leftBase = peakMenuState.clientX - (stageRect?.left ?? 0) + 12;
  const topBase = peakMenuState.clientY - (stageRect?.top ?? 0) + 12;
  const safeLeft = Math.max(12, Math.min(leftBase, Math.max(12, (stageRect?.width ?? menuWidth + 24) - menuWidth - 12)));
  const safeTop = Math.max(12, Math.min(topBase, Math.max(12, (stageRect?.height ?? menuHeight + 24) - menuHeight - 12)));

  menu.style.left = `${safeLeft}px`;
  menu.style.top = `${safeTop}px`;
}

function renderPeakList() {
  const container = document.getElementById("peakList");
  if (!container) return;

  const spectrum = getSelectedSpectrum();
  if (!spectrum) {
    container.className = "peak-list empty";
    container.textContent = "ピークを表示するにはスペクトルを選択してください。";
    return;
  }

  const peaks = spectrum.detectedPeaks ?? [];
  if (!peaks.length) {
    container.className = "peak-list empty";
    container.textContent = "ピークはまだ検出されていません。";
    return;
  }

  container.className = "peak-list";
  container.innerHTML = peaks.map((peak, index) => `
    <div class="peak-item">
      <strong>#${index + 1}</strong>
      <span>x = ${Number(peak.x).toFixed(4)}</span>
      <span>y = ${Number(peak.y).toFixed(4)}</span>
      <span>prominence = ${Number(peak.prominence).toFixed(4)}</span>
    </div>
  `).join("");
}

function renderLabelControls() {
  const xPresetInput = document.getElementById("xLabelPresetInput");
  const yPresetInput = document.getElementById("yLabelPresetInput");
  const xLabelInput = document.getElementById("xLabelInput");
  const yLabelInput = document.getElementById("yLabelInput");
  const hasMeasurementTime = hasMeasurementTimeSpectra(state.spectra);

  if (xPresetInput) xPresetInput.value = state.ui.xLabelPreset;
  if (yPresetInput) yPresetInput.value = hasMeasurementTime ? "cps" : state.ui.yLabelPreset;
  if (xLabelInput) xLabelInput.value = state.ui.xLabel;
  if (yLabelInput) yLabelInput.value = state.ui.yLabel;
  if (xLabelInput) xLabelInput.disabled = state.ui.xLabelPreset !== "custom";
  if (yLabelInput) yLabelInput.disabled = hasMeasurementTime || state.ui.yLabelPreset !== "custom";
  if (yPresetInput) yPresetInput.disabled = hasMeasurementTime;
}


function formatRange(range) {
  return Array.isArray(range) && range.length === 2
    ? `${Number(range[0]).toFixed(2)} - ${Number(range[1]).toFixed(2)}`
    : '未設定';
}

function renderBackgroundControls() {
  const spectrum = getSelectedSpectrum();
  const constantRangeText = document.getElementById('constantRangeText');
  const constantValueInput = document.getElementById('constantBackgroundValueInput');
  const linearTargetText = document.getElementById('linearTargetRangeText');
  const linearFitText = document.getElementById('linearFitRangesText');
  const linearSelectionMode = document.getElementById('linearSelectionModeText');
  const applyConstantBtn = document.getElementById('applyConstantBackgroundBtn');
  const startLinearBtn = document.getElementById('startLinearBackgroundBtn');
  const clearLinearBtn = document.getElementById('clearLinearSelectionBtn');
  const clearBackgroundBtn = document.getElementById('clearBackgroundBtn');

  if (!spectrum) {
    if (constantRangeText) constantRangeText.textContent = 'スペクトルを選択してください。';
    if (linearTargetText) linearTargetText.textContent = 'スペクトルを選択してください。';
    if (linearFitText) linearFitText.textContent = 'スペクトルを選択してください。';
    [applyConstantBtn, startLinearBtn, clearLinearBtn, clearBackgroundBtn].forEach((btn) => { if (btn) btn.disabled = true; });
    return;
  }

  ensureSpectrumProcessingState(spectrum);
  const selectedRange = state.ui.plotViewport.selectedXRange;
  const background = spectrum.backgroundCorrection;
  if (constantRangeText) constantRangeText.textContent = `現在の x 範囲: ${formatRange(selectedRange)}`;
  if (constantValueInput && document.activeElement !== constantValueInput) {
    constantValueInput.value = String(background.constant?.value ?? 0);
  }
  if (linearTargetText) linearTargetText.textContent = `線形補正対象: ${formatRange(background.linear?.targetRange)}`;
  if (linearFitText) {
    const fitRanges = background.linear?.fitRanges?.length
      ? background.linear.fitRanges.map((range) => formatRange(range)).join(', ')
      : 'まだ選択されていません';
    linearFitText.textContent = `近似に使う区間: ${fitRanges}`;
  }
  if (linearSelectionMode) {
    linearSelectionMode.textContent = state.ui.backgroundSelection?.enabled
      ? 'ドラッグ操作中: 左→右で追加、右→左で除外'
      : '開始後にグラフ上でドラッグして近似区間を編集';
  }

  if (applyConstantBtn) applyConstantBtn.disabled = !Array.isArray(selectedRange);
  if (startLinearBtn) startLinearBtn.disabled = !Array.isArray(selectedRange);
  if (clearLinearBtn) clearLinearBtn.disabled = !(background.linear?.fitRanges?.length);
  if (clearBackgroundBtn) clearBackgroundBtn.disabled = background.mode === 'none';
}

async function handleBackgroundRangeSelection({ range, mode }) {
  const spectrum = getSelectedSpectrum();
  if (!spectrum) return;
  try {
    updateLinearBackgroundSelection(spectrum, range, mode);
    renderAll();
    await renderPlot();
    setStatus(mode === 'include' ? '線形近似に使う区間を追加しました。' : '線形近似に使わない区間を除外しました。');
  } catch (error) {
    setStatus(error.message);
  }
}

function renderCosmicRayControls() {
  const spectrum = getSelectedSpectrum();
  const enabledInput = document.getElementById("cosmicRayModeInput");
  const halfWidthInput = document.getElementById("cosmicRayHalfWidthInput");
  const selectionText = document.getElementById("cosmicRaySelectionText");
  const removeBtn = document.getElementById("removeCosmicRayBtn");
  const undoBtn = document.getElementById("undoCosmicRayBtn");
  const clearBtn = document.getElementById("clearCosmicRaySelectionBtn");

  if (enabledInput) enabledInput.checked = Boolean(state.ui.cosmicRayRemoval?.enabled);
  if (halfWidthInput) halfWidthInput.value = String(state.ui.cosmicRayRemoval?.halfWidth ?? 1);

  if (!spectrum) {
    if (selectionText) selectionText.textContent = "スペクトルを選択してください。";
    if (removeBtn) removeBtn.disabled = true;
    if (undoBtn) undoBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  const index = spectrum.selectedRemovalPointIndex;
  if (Number.isInteger(index)) {
    const x = spectrum.xProcessed[index];
    const y = spectrum.yProcessed[index];
    if (selectionText) selectionText.textContent = `選択中: index ${index}, x = ${Number(x).toFixed(4)}, y = ${Number(y).toFixed(4)}`;
  } else if (selectionText) {
    selectionText.textContent = "まだ点は選択されていません。";
  }

  if (removeBtn) removeBtn.disabled = !Number.isInteger(index);
  if (undoBtn) undoBtn.disabled = !(spectrum.cosmicRayHistory?.length);
  if (clearBtn) clearBtn.disabled = !Number.isInteger(index);
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


function renderWorkspaceSummary() {
  const summary = document.getElementById("workspaceSummary");
  const traceSummary = document.getElementById("traceListSummary");
  const peakSummary = document.getElementById("peakListSummary");
  const selected = getSelectedSpectrum();
  const selectedRange = state.ui.plotViewport.selectedXRange;

  if (traceSummary) {
    traceSummary.textContent = state.spectra.length
      ? `${state.spectra.length} loaded / ${state.spectra.filter((spectrum) => spectrum.visible).length} visible`
      : '0 loaded';
  }

  if (peakSummary) {
    peakSummary.textContent = selected
      ? `${selected.detectedPeaks?.length ?? 0} peaks in ${selected.name}`
      : '選択スペクトルなし';
  }

  if (!summary) return;
  if (!state.spectra.length) {
    summary.textContent = 'スペクトルを読み込むと、ここに現在の作業状況が表示されます。';
    return;
  }

  const parts = [
    `読込: ${state.spectra.length} 本`,
    `表示: ${state.spectra.filter((spectrum) => spectrum.visible).length} 本`,
    selected ? `選択中: ${selected.name}` : '選択中: なし',
    `x 範囲: ${formatRange(selectedRange)}`,
  ];

  if (selected?.detectedPeaks?.length) {
    parts.push(`検出ピーク: ${selected.detectedPeaks.length}`);
  }

  summary.textContent = parts.join(' / ');
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
      <article class="trace-item ${state.selectedSpectrumId === s.id ? "is-selected" : ""}" data-trace-id="${s.id}">
        <div class="trace-head">
          <div class="trace-title-group">
            <div class="trace-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
            <div class="trace-meta">
              <span class="badge">${s.metadata?.pointCount ?? 0} pts</span>
              ${s.measurementTimeSeconds ? `<span class="badge badge-soft">${Number(s.measurementTimeSeconds).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')} s</span>` : ""}
            </div>
          </div>
          <button class="trace-select-btn" type="button">${state.selectedSpectrumId === s.id ? "Selected" : "Focus"}</button>
        </div>
        <div class="trace-row trace-row-main">
          <label class="checkbox-row trace-visibility-toggle"><input type="checkbox" class="trace-visible" ${s.visible ? "checked" : ""} /><span>Visible on plot</span></label>
          <button class="trace-remove-btn trace-remove-btn-inline" type="button">Remove</button>
        </div>
        <label class="trace-field trace-rename-field">
          <span class="trace-field-label">Display name</span>
          <input type="text" class="trace-rename" value="${escapeHtml(s.name)}" />
        </label>
        <div class="trace-controls trace-controls-extended">
          <label class="trace-field trace-field-wide">
            <span class="trace-field-label">Color</span>
            <div class="trace-color-row">
              <input type="color" class="trace-color-picker" value="${escapeHtml(fallbackColor)}" />
              <input type="text" class="trace-color-text" value="${escapeHtml(fallbackColor)}" placeholder="#2563eb" />
            </div>
          </label>
          <label class="trace-field">
            <span class="trace-field-label">Line style</span>
            <select class="trace-line-style">${styleOptions}</select>
          </label>
          <label class="trace-field">
            <span class="trace-field-label">Line width</span>
            <input type="number" class="trace-width" min="1" step="0.5" value="${Number(s.lineWidth) || 2}" />
          </label>
          <label class="trace-field">
            <span class="trace-field-label">Offset</span>
            <input type="number" class="trace-offset" step="0.1" value="${Number(s.offset) || 0}" />
          </label>
          <label class="trace-field trace-field-wide">
            <span class="trace-field-label">Measurement time (s)</span>
            <input type="number" class="trace-measurement-time" min="0" step="0.001" placeholder="counts only" value="${s.measurementTimeSeconds ?? ""}" />
          </label>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll(".trace-item").forEach((item) => {
    const id = item.dataset.traceId;
    if (!id) return;

    item.querySelector(".trace-select-btn")?.addEventListener("click", async () => {
      selectSpectrum(id);
      closePeakMenu();
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
        if (colorText) colorText.value = spectrum?.color || fallback;
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
      closePeakMenu();
      syncAutoYLabel();
      renderAll();
      await renderPlot();
      setStatus("スペクトルを削除しました。");
    });
  });
}

export function renderAll() {
  syncAutoYLabel();
  document.body.classList.toggle("dark", state.ui.theme === "dark");
  const themeSelect = document.getElementById("themeSelect");
  const offsetStepInput = document.getElementById("offsetStepInput");
  const plotHeightInput = document.getElementById("plotHeightInput");
  const axisTitleFontSizeInput = document.getElementById("axisTitleFontSizeInput");
  const axisTickFontSizeInput = document.getElementById("axisTickFontSizeInput");

  if (themeSelect) themeSelect.value = state.ui.theme;
  if (offsetStepInput) offsetStepInput.value = String(state.ui.offsetStep);
  if (plotHeightInput) plotHeightInput.value = String(state.ui.plotHeight);
  if (axisTitleFontSizeInput) axisTitleFontSizeInput.value = String(state.ui.axisTitleFontSize);
  if (axisTickFontSizeInput) axisTickFontSizeInput.value = String(state.ui.axisTickFontSize);

  renderLabelControls();
  renderWorkspaceSummary();
  renderTraceList();
  renderPeakMenu();
  renderPeakList();
  renderCosmicRayControls();
  renderBackgroundControls();
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
  closePeakMenu();
  renderAll();
  await renderPlot();
  setStatus("プロジェクトを読み込みました。");
}

function bindFileDropTarget(dropzone, fileInput, onDropFiles) {
  if (!dropzone || !fileInput) return;

  let dragDepth = 0;
  const isFileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const setDragActive = (active) => dropzone.classList.toggle("drag-active", active);

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
      fileInput.value = "";
    }
  });
}

function bindSpectrumDropzones() {
  const fileInput = document.getElementById("fileInput");
  const dropzones = [document.getElementById("fileDropzone"), document.getElementById("plotDropzone")].filter(Boolean);
  if (!fileInput || !dropzones.length) return;

  dropzones.forEach((dropzone) => {
    bindFileDropTarget(dropzone, fileInput, async (files) => {
      await handleSpectrumFiles(files);
    });
  });
}


function bindRightPanelAccordions() {
  document.querySelectorAll('[data-accordion]').forEach((section, index) => {
    const toggle = section.querySelector('.accordion-toggle');
    const content = section.querySelector('.accordion-content');
    if (!toggle || !content) return;

    const contentId = content.id || `accordion-content-${index + 1}`;
    content.id = contentId;
    toggle.setAttribute('aria-controls', contentId);

    const isOpen = section.hasAttribute('default-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    content.hidden = !isOpen;

    toggle.addEventListener('click', () => {
      const nextOpen = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(nextOpen));
      content.hidden = !nextOpen;
    });
  });
}

function bindPeakMenu() {
  const normalizeBtn = document.getElementById("normalizePeakBtn");
  const closeBtn = document.getElementById("closePeakMenuBtn");
  const menu = document.getElementById("peakMenu");
  const plot = document.getElementById("plot");

  normalizeBtn?.addEventListener("click", async () => {
    const target = state.spectra.find((entry) => entry.id === peakMenuState.spectrumId) ?? getSelectedSpectrum();
    const peakIndex = peakMenuState.peakIndex;
    if (!target || !Number.isInteger(peakIndex)) return;

    try {
      normalizeByPeakIndex(target, peakIndex);
      closePeakMenu();
      renderAll();
      await renderPlot();
      setStatus("選択ピークを 1 に正規化しました。");
    } catch (error) {
      setStatus(error.message);
    }
  });

  closeBtn?.addEventListener("click", () => {
    closePeakMenu();
    renderPeakMenu();
  });

  plot?.addEventListener("peak-marker-click", (event) => {
    openPeakMenu(event.detail ?? {});
    renderPeakMenu();
  });

  plot?.addEventListener("peak-marker-clear", () => {
    closePeakMenu();
    renderPeakMenu();
  });

  document.addEventListener("click", (event) => {
    if (!peakMenuState.open) return;
    if (menu?.contains(event.target) || plot?.contains(event.target)) return;
    closePeakMenu();
    renderPeakMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !peakMenuState.open) return;
    closePeakMenu();
    renderPeakMenu();
  });
}

async function handlePlotPointSelection(eventData) {
  if (!state.ui.cosmicRayRemoval?.enabled) return;

  const point = eventData?.points?.[0];
  const spectrumId = point?.data?.meta?.spectrumId;
  const pointIndex = point?.pointIndex;
  if (!spectrumId || !Number.isInteger(pointIndex)) return;

  const spectrum = state.spectra.find((entry) => entry.id === spectrumId);
  if (!spectrum) return;

  try {
    selectSpectrum(spectrumId);
    selectRemovalPoint(spectrum, pointIndex);
    closePeakMenu();
    renderAll();
    await renderPlot();
    setStatus(`除去対象点を選択しました (index ${pointIndex})。`);
  } catch (error) {
    setStatus(error.message);
  }
}

export function bindUi() {
  setPlotPointSelectionHandler(handlePlotPointSelection);
  setPlotBackgroundRangeSelectionHandler(handleBackgroundRangeSelection);
  bindPeakMenu();
  bindSpectrumDropzones();
  bindRightPanelAccordions();

  document.getElementById("fileInput")?.addEventListener("change", async (event) => {
    if (event.target.files?.length) {
      await handleSpectrumFiles(event.target.files);
      event.target.value = "";
    }
  });

  document.getElementById("projectInput")?.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    await handleProjectFile(file);
    event.target.value = "";
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

  document.getElementById("applyViewBtn")?.addEventListener("click", async () => {
    const xPreset = document.getElementById("xLabelPresetInput")?.value ?? state.ui.xLabelPreset;
    const yPreset = document.getElementById("yLabelPresetInput")?.value ?? state.ui.yLabelPreset;
    state.ui.xLabelPreset = xPreset;
    state.ui.yLabelPreset = hasMeasurementTimeSpectra(state.spectra) ? "cps" : yPreset;
    state.ui.xLabel = xPreset === "custom"
      ? (document.getElementById("xLabelInput")?.value.trim() || state.ui.xLabel)
      : resolveLabelFromPreset(X_LABEL_PRESETS, xPreset, state.ui.xLabel);
    state.ui.yLabel = state.ui.yLabelPreset === "custom"
      ? (document.getElementById("yLabelInput")?.value.trim() || state.ui.yLabel)
      : resolveLabelFromPreset(Y_LABEL_PRESETS, state.ui.yLabelPreset, state.ui.yLabel);
    syncAutoYLabel();
    state.ui.theme = document.getElementById("themeSelect")?.value || "light";
    state.ui.offsetStep = Number(document.getElementById("offsetStepInput")?.value) || 0;
    state.ui.plotHeight = Number(document.getElementById("plotHeightInput")?.value) || 560;
    state.ui.axisTitleFontSize = Number(document.getElementById("axisTitleFontSizeInput")?.value) || 30;
    state.ui.axisTickFontSize = Number(document.getElementById("axisTickFontSizeInput")?.value) || 18;
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

    const minProminence = Number(document.getElementById("prominenceInput")?.value) || 0;
    const minDistance = Number(document.getElementById("distanceInput")?.value) || 5;
    spectrum.detectedPeaks = detectPeaks(spectrum.xProcessed, spectrum.yProcessed, { minProminence, minDistance });
    closePeakMenu();
    renderAll();
    await renderPlot();
    setStatus(`${spectrum.detectedPeaks.length} peak(s) detected. マーカーをクリックすると操作できます。`);
  });

  document.getElementById("resetNormalizationBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    resetProcessed(spectrum);
    closePeakMenu();
    renderAll();
    await renderPlot();
    setStatus("選択スペクトルの正規化をリセットしました。");
  });
  document.getElementById("applyConstantBackgroundBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    const range = state.ui.plotViewport.selectedXRange;
    const value = Number(document.getElementById("constantBackgroundValueInput")?.value);
    try {
      setConstantBackground(spectrum, range, value);
      closePeakMenu();
      renderAll();
      await renderPlot();
      setStatus("指定範囲に定数バックグラウンドを適用しました。");
    } catch (error) {
      setStatus(error.message);
    }
  });

  document.getElementById("startLinearBackgroundBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    const range = state.ui.plotViewport.selectedXRange;
    try {
      configureLinearBackground(spectrum, range);
      state.ui.backgroundSelection.enabled = true;
      state.ui.backgroundSelection.startX = null;
      state.ui.backgroundSelection.currentX = null;
      closePeakMenu();
      renderAll();
      await renderPlot();
      setStatus("線形バックグラウンド対象範囲を設定しました。グラフ上をドラッグして近似区間を追加/除外してください。");
    } catch (error) {
      setStatus(error.message);
    }
  });

  document.getElementById("stopLinearBackgroundBtn")?.addEventListener("click", async () => {
    state.ui.backgroundSelection.enabled = false;
    state.ui.backgroundSelection.startX = null;
    state.ui.backgroundSelection.currentX = null;
    renderAll();
    await renderPlot();
    setStatus("線形バックグラウンド区間のドラッグ選択を終了しました。");
  });

  document.getElementById("clearLinearSelectionBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    try {
      clearLinearBackgroundSelection(spectrum);
      renderAll();
      await renderPlot();
      setStatus("線形近似に使う区間をクリアしました。");
    } catch (error) {
      setStatus(error.message);
    }
  });

  document.getElementById("clearBackgroundBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    clearBackgroundCorrection(spectrum);
    state.ui.backgroundSelection.enabled = false;
    state.ui.backgroundSelection.startX = null;
    state.ui.backgroundSelection.currentX = null;
    renderAll();
    await renderPlot();
    setStatus("バックグラウンド補正を解除しました。");
  });


  document.getElementById("cosmicRayModeInput")?.addEventListener("change", (event) => {
    state.ui.cosmicRayRemoval.enabled = event.target.checked;
    renderCosmicRayControls();
    setStatus(event.target.checked
      ? "点選択モードを有効にしました。グラフ上の対象点をクリックしてください。"
      : "点選択モードを無効にしました。");
  });

  document.getElementById("cosmicRayHalfWidthInput")?.addEventListener("change", (event) => {
    state.ui.cosmicRayRemoval.halfWidth = Math.max(0, Math.floor(Number(event.target.value) || 0));
    renderCosmicRayControls();
  });

  document.getElementById("removeCosmicRayBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    try {
      const result = removeSelectedSpike(spectrum, state.ui.cosmicRayRemoval.halfWidth);
      renderAll();
      await renderPlot();
      setStatus(`宇宙線由来の鋭い線を補間除去しました (index ${result.start} - ${result.end})。`);
    } catch (error) {
      setStatus(error.message);
    }
  });

  document.getElementById("undoCosmicRayBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    try {
      const result = undoLastSpikeRemoval(spectrum);
      renderAll();
      await renderPlot();
      setStatus(`直前の宇宙線除去を元に戻しました (index ${result.start} - ${result.end})。`);
    } catch (error) {
      setStatus(error.message);
    }
  });

  document.getElementById("clearCosmicRaySelectionBtn")?.addEventListener("click", async () => {
    const spectrum = getSelectedSpectrum();
    if (!spectrum) return;
    clearRemovalPoint(spectrum);
    renderAll();
    await renderPlot();
    setStatus("除去対象点の選択をクリアしました。");
  });

  document.getElementById("exportPngBtn")?.addEventListener("click", async () => {
    await exportPlotPng();
    setStatus("PNG を書き出しました。");
  });

  document.getElementById("saveProjectBtn")?.addEventListener("click", () => {
    saveProjectJson();
    setStatus("プロジェクト JSON を保存しました。");
  });

  window.addEventListener("resize", async () => {
    await renderPlot();
  });
}
