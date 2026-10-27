import {
  PRESETS,
  PREVIEW_MAX,
  EXPORT_MAX,
  decodeImage,
  renderRotated,
  renderScan,
  makeThumbnail,
  canvasToBlob,
  suggestCorners,
  detectCorners,
  rotateCorners,
  fullCorners,
} from "./scanner.js";
import { buildPdf } from "./pdf.js";
import { createZip } from "./zip.js";
import { saveSession, loadSession, clearSession } from "./db.js";
import {
  initI18n,
  getLang,
  setLang,
  onLangChange,
  t,
} from "./i18n.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const modeLabel = (mode) =>
  t(`preset.${PRESETS[mode] ? mode : "clean"}.name`);

/* New imports reuse the last enhance look that was applied. */
const LOOK_STORAGE_KEY = "paperglass.look";
const LOOK_RANGES = {
  brightness: [-50, 50],
  contrast: [-50, 50],
  cleanup: [0, 100],
};

function readRememberedLook() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY) || "null");
  } catch (error) {
    saved = null;
  }

  const mode = saved && PRESETS[saved.mode] ? saved.mode : "clean";
  const readValue = (key) => {
    const [min, max] = LOOK_RANGES[key];
    const value = saved ? Number(saved[key]) : NaN;
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : PRESETS[mode][key];
  };

  return {
    mode,
    brightness: readValue("brightness"),
    contrast: readValue("contrast"),
    cleanup: readValue("cleanup"),
  };
}

let lookTimer = null;

function rememberLook(page) {
  if (!page) return;
  clearTimeout(lookTimer);
  lookTimer = null;
  try {
    localStorage.setItem(
      LOOK_STORAGE_KEY,
      JSON.stringify({
        mode: page.mode,
        brightness: page.brightness,
        contrast: page.contrast,
        cleanup: page.cleanup,
      })
    );
  } catch (error) {
    /* Storage blocked: new imports keep using their preset defaults. */
  }
}

function scheduleRememberLook(page) {
  clearTimeout(lookTimer);
  lookTimer = setTimeout(() => rememberLook(page), 250);
}

const QUALITY = {
  high: 0.94,
  balanced: 0.85,
  compact: 0.72,
};

const pad2 = (value) => String(value).padStart(2, "0");
const nextFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // rAF can be suspended in background tabs; the timer keeps long imports
    // and exports moving even when the page is not visible.
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeName(value, fallback = "paperglass-scan") {
  const clean = String(value || "")
    .replace(/[\\/:*?"<>|%]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 90);
  return clean || fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileBaseName(name) {
  return sanitizeName(String(name || "scan").replace(/\.[^.]+$/, ""), "scan");
}

function createId() {
  if (window.crypto && crypto.randomUUID) return `p_${crypto.randomUUID()}`;
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function currentDateName() {
  const date = new Date();
  return `paperglass-${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

const state = {
  pages: [],
  activeId: null,
  cropMode: false,
  selectionMode: false,
  selectedIds: new Set(),
  draggingId: null,
  dragCorner: null,
  cornerBackup: null,
  saveTimer: null,
  previewTimer: null,
  previewToken: 0,
  exportFormat: "pdf",
  imageFormat: "jpeg",
  paperSize: "a4",
  restoreFocus: null,
  confirmCallback: null,
  cameraStream: null,
  dirty: false,
  restoring: false,
  saveWarned: false,
};

let refs = {};

/* ------------------------------------------------------------------ */
/* Installable app (PWA)                                              */
/* ------------------------------------------------------------------ */

let deferredInstallPrompt = null;
let installOffered = false;

async function promptInstall() {
  const prompt = deferredInstallPrompt;
  if (!prompt) return;
  deferredInstallPrompt = null;
  try {
    prompt.prompt();
    await prompt.userChoice;
  } catch (error) {
    console.warn("Paperglass: install prompt failed", error);
  }
}

function offerInstall() {
  if (!deferredInstallPrompt || installOffered || !refs.toasts) return;
  installOffered = true;
  toast(t("install.prompt"), {
    action: t("install.action"),
    duration: 15000,
    onAction: promptInstall,
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.warn("Paperglass: service worker registration failed", error);
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  offerInstall();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (refs.toasts) toast(t("install.done"));
});

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  initI18n();
  refs = {
    topbarMeta: $("#topbarMeta"),
    docMeta: $("#docMeta"),
    langToggle: $("#langToggle"),
    langLabel: $("#langLabel"),
    themeToggle: $("#themeToggle"),
    headerAdd: $("#headerAdd"),
    exportBtn: $("#exportBtn"),
    workspace: $("#workspace"),
    sidebar: $("#sidebar"),
    sidebarToggle: $("#sidebarToggle"),
    sidebarBackdrop: $("#sidebarBackdrop"),
    pageList: $("#pageList"),
    sidebarAdd: $("#sidebarAdd"),
    sidebarSelect: $("#sidebarSelect"),
    selectionBar: $("#selectionBar"),
    selectionCount: $("#selectionCount"),
    selectAllBtn: $("#selectAllBtn"),
    deleteSelectedBtn: $("#deleteSelectedBtn"),
    cancelSelectBtn: $("#cancelSelectBtn"),
    mobileTools: $("#mobileTools"),
    mobileAdd: $("#mobileAdd"),
    mobileSelect: $("#mobileSelect"),
    mobileClear: $("#mobileClear"),
    pageCount: $("#pageCount"),
    saveState: $("#saveState"),
    saveStateText: $("#saveStateText"),
    clearAll: $("#clearAll"),
    stage: $("#stage"),
    emptyState: $("#emptyState"),
    dropzone: $("#dropzone"),
    choosePhotos: $("#choosePhotos"),
    openCamera: $("#openCamera"),
    editor: $("#editor"),
    fileIndex: $("#fileIndex"),
    fileName: $("#fileName"),
    fileDims: $("#fileDims"),
    rotateLeft: $("#rotateLeft"),
    rotateRight: $("#rotateRight"),
    cropBtn: $("#cropBtn"),
    openInspector: $("#openInspector"),
    closeInspector: $("#closeInspector"),
    inspector: $("#inspector"),
    inspectorScrim: $("#inspectorScrim"),
    quickDownload: $("#quickDownload"),
    canvasArea: $("#canvasArea"),
    canvasSlot: $("#canvasSlot"),
    paperHolder: $("#paperHolder"),
    previewCanvas: $("#previewCanvas"),
    cropSvg: $("#cropSvg"),
    cropDim: $("#cropDim"),
    cropPoly: $("#cropPoly"),
    cropHandles: $("#cropHandles"),
    renderVeil: $("#renderVeil"),
    stageHint: $("#stageHint"),
    cropActions: $("#cropActions"),
    autoCrop: $("#autoCrop"),
    resetCrop: $("#resetCrop"),
    doneCrop: $("#doneCrop"),
    resetAdjustments: $("#resetAdjustments"),
    presetGrid: $("#presetGrid"),
    brightness: $("#brightness"),
    brightnessOut: $("#brightnessOut"),
    contrast: $("#contrast"),
    contrastOut: $("#contrastOut"),
    cleanup: $("#cleanup"),
    cleanupOut: $("#cleanupOut"),
    moveUpBtn: $("#moveUpBtn"),
    moveDownBtn: $("#moveDownBtn"),
    deletePageBtn: $("#deletePageBtn"),
    deleteCurrentBtn: $("#deleteCurrentBtn"),
    applyAll: $("#applyAll"),
    fileInput: $("#fileInput"),
    cameraInput: $("#cameraInput"),
    dropOverlay: $("#dropOverlay"),
    exportModal: $("#exportModal"),
    exportFormat: $("#exportFormat"),
    pdfOptions: $("#pdfOptions"),
    imageOptions: $("#imageOptions"),
    paperSize: $("#paperSize"),
    pdfQuality: $("#pdfQuality"),
    exportName: $("#exportName"),
    pdfSummaryText: $("#pdfSummaryText"),
    imageFormat: $("#imageFormat"),
    imageQuality: $("#imageQuality"),
    imageName: $("#imageName"),
    imageExt: $("#imageExt"),
    imageSummaryText: $("#imageSummaryText"),
    imageSummaryNote: $("#imageSummaryNote"),
    exportConfirm: $("#exportConfirm"),
    exportSubtitle: $("#exportSubtitle"),
    confirmModal: $("#confirmModal"),
    confirmTitle: $("#confirmTitle"),
    confirmMessage: $("#confirmMessage"),
    confirmAction: $("#confirmAction"),
    cameraModal: $("#cameraModal"),
    cameraVideo: $("#cameraVideo"),
    cameraError: $("#cameraError"),
    captureBtn: $("#captureBtn"),
    cameraFallback: $("#cameraFallback"),
    busy: $("#busy"),
    busyTitle: $("#busyTitle"),
    busyDetail: $("#busyDetail"),
    busyProgress: $("#busyProgress"),
    toasts: $("#toasts"),
  };

  bindEvents();
  registerServiceWorker();
  initTheme();
  updateLocaleButton();
  offerInstall();
  onLangChange(() => {
    initTheme();
    updateLocaleButton();
    setSaveState(refs.saveState.dataset.state || "saved");
    updateExportUI();
    renderAll();
  });
  updateRangeFill(refs.brightness);
  updateRangeFill(refs.contrast);
  updateRangeFill(refs.cleanup);

  const restored = await restoreSession();
  renderAll();

  if (!restored) {
    setSaveState("saved");
  }

  const observer = new ResizeObserver(() => {
    fitCanvas();
    updateCropOverlay();
  });
  observer.observe(refs.canvasSlot);
}

function openSidebar() {
  if (!refs.sidebar) return;
  refs.sidebar.classList.add("is-open");
  refs.sidebarBackdrop?.removeAttribute("hidden");
  refs.sidebarToggle?.setAttribute("aria-expanded", "true");
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  if (!refs.sidebar) return;
  refs.sidebar.classList.remove("is-open");
  refs.sidebarBackdrop?.setAttribute("hidden", "");
  refs.sidebarToggle?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sidebar-open");
}

function toggleSidebar() {
  if (!refs.sidebar) return;
  if (refs.sidebar.classList.contains("is-open")) closeSidebar();
  else openSidebar();
}

function initTheme() {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  updateThemeMeta(theme);
}

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0d1211" : "#f3f1ec");
  const dark = theme === "dark";
  refs.themeToggle.title = t(dark ? "theme.toLightTitle" : "theme.toDarkTitle");
  refs.themeToggle.setAttribute("aria-label", t(dark ? "theme.toLight" : "theme.toDark"));
}

function updateLocaleButton() {
  if (!refs.langToggle) return;
  refs.langToggle.setAttribute("aria-label", t("lang.switchTo"));
  refs.langToggle.title = t("lang.switchTo");
  if (refs.langLabel) refs.langLabel.textContent = t("lang.other");
}

function toggleLocale() {
  setLang(getLang() === "ar" ? "en" : "ar");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("paperglass.theme", next);
  } catch (error) {
    /* private mode */
  }
  updateThemeMeta(next);
}

/* ------------------------------------------------------------------ */
/* Pages                                                              */
/* ------------------------------------------------------------------ */

function activePage() {
  return state.pages.find((page) => page.id === state.activeId) || null;
}

function metaFor(page) {
  return `${formatBytes(page.size)} · ${modeLabel(page.mode)}`;
}

function renderAll() {
  const hasPages = state.pages.length > 0;
  if (!hasPages) {
    state.selectionMode = false;
    state.selectedIds.clear();
  }
  refs.workspace.classList.toggle("is-empty", !hasPages);
  refs.workspace.classList.toggle("is-selecting", hasPages && state.selectionMode);
  refs.emptyState.hidden = hasPages;
  refs.editor.hidden = !hasPages;
  refs.exportBtn.disabled = !hasPages;
  refs.mobileTools.hidden = state.selectionMode;
  updateSelectionUI();

  if (!hasPages) {
    state.activeId = null;
    state.cropMode = false;
    refs.pageList.innerHTML = "";
    refs.pageCount.textContent = t("pages.none");
    refs.docMeta.textContent = t("topbar.ready");
    refs.stageHint.textContent = t("editor.tipEmpty");
    return;
  }

  if (!state.pages.some((page) => page.id === state.activeId)) {
    state.activeId = state.pages[0].id;
  }

  const totalBytes = state.pages.reduce((sum, page) => sum + (page.size || 0), 0);
  refs.pageCount.textContent = t("pages.count", { count: state.pages.length });
  refs.docMeta.textContent = t("page.summary", {
    count: state.pages.length,
    size: formatBytes(totalBytes),
  });

  renderPageList();
  const page = activePage();
  syncInspector(page);
  updateEditorMeta(page);
  updateCropUI();
  renderPreview();
}

function renderPageList() {
  const selecting = state.selectionMode;
  refs.pageList.innerHTML = state.pages
    .map((page, index) => {
      const active = page.id === state.activeId;
      const selected = selecting && state.selectedIds.has(page.id);
      return `
        <article class="page-card${active ? " is-active" : ""}${
          selected ? " is-selected" : ""
        }" draggable="${selecting ? "false" : "true"}" data-id="${page.id}" tabindex="0" ${
          selecting ? `role="checkbox" aria-checked="${selected}"` : ""
        } ${active ? 'aria-current="true"' : ""}>
          <div class="thumb-wrap">
            <img src="${page.thumb || ""}" alt="" draggable="false" />
            <span class="page-index">${pad2(index + 1)}</span>
            <span class="select-check" aria-hidden="true">
              <svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>
            </span>
          </div>
          <div class="page-info">
            <p class="page-name" title="${escapeHtml(page.name)}">${escapeHtml(page.name)}</p>
            <p class="page-meta">${metaFor(page)}</p>
          </div>
          <button class="icon-btn page-more" type="button" data-action="menu" aria-label="${escapeHtml(
            t("a11y.pageOptions")
          )}" aria-expanded="false">
            <svg class="icon" aria-hidden="true"><use href="#i-more"/></svg>
          </button>
          <div class="card-menu" hidden>
            <button type="button" data-menu-action="up" ${index === 0 ? "disabled" : ""}>
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-up"/></svg>
              ${escapeHtml(t("page.moveUp"))}
            </button>
            <button type="button" data-menu-action="down" ${
              index === state.pages.length - 1 ? "disabled" : ""
            }>
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-down"/></svg>
              ${escapeHtml(t("page.moveDown"))}
            </button>
            <div class="menu-sep"></div>
            <button type="button" data-menu-action="crop">
              <svg class="icon" aria-hidden="true"><use href="#i-crop"/></svg>
              ${escapeHtml(t("editor.adjustEdges"))}
            </button>
            <button type="button" data-menu-action="download">
              <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>
              ${escapeHtml(t("a11y.downloadPage"))}
            </button>
            <div class="menu-sep"></div>
            <button type="button" class="danger" data-menu-action="delete">
              <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>
              ${escapeHtml(t("a11y.deletePage"))}
            </button>
          </div>
        </article>`;
    })
    .join("");

  if (!state.selectionMode) {
    const activeCard = refs.pageList.querySelector(".page-card.is-active");
    if (activeCard) activeCard.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function updateSelectionUI() {
  const active = state.selectionMode && state.pages.length > 0;
  refs.selectionBar.hidden = !active;
  refs.mobileTools.hidden = active;
  if (!active) return;

  const count = state.selectedIds.size;
  const total = state.pages.length;
  const allSelected = total > 0 && count === total;
  refs.selectionCount.textContent = count
    ? t("selection.count", { count })
    : t("selection.none");
  refs.deleteSelectedBtn.disabled = count === 0;
  refs.selectAllBtn.textContent = t(
    allSelected ? "selection.clearAll" : "selection.selectAll"
  );
  refs.selectAllBtn.setAttribute("aria-pressed", String(allSelected));
}

function enterSelectionMode() {
  if (!state.pages.length) return;
  state.selectionMode = true;
  state.selectedIds.clear();
  state.cropMode = false;
  closeCardMenus();
  renderAll();
}

function exitSelectionMode() {
  if (!state.selectionMode) return;
  state.selectionMode = false;
  state.selectedIds.clear();
  renderAll();
}

function togglePageSelection(id) {
  if (!state.pages.some((page) => page.id === id)) return;
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);

  const card = refs.pageList.querySelector(`.page-card[data-id="${id}"]`);
  if (card) {
    const selected = state.selectedIds.has(id);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-checked", String(selected));
  }
  updateSelectionUI();
}

function toggleSelectAllPages() {
  const allSelected =
    state.pages.length > 0 && state.selectedIds.size === state.pages.length;
  state.selectedIds.clear();
  if (!allSelected) {
    state.pages.forEach((page) => state.selectedIds.add(page.id));
  }
  renderPageList();
  updateSelectionUI();
}

function deleteSelectedPages() {
  if (!state.selectedIds.size) return;

  const removed = state.pages
    .map((page, index) => ({ page, index }))
    .filter((item) => state.selectedIds.has(item.page.id));
  if (!removed.length) return;

  const removingActive =
    state.activeId && state.selectedIds.has(state.activeId);
  state.pages = state.pages.filter(
    (page) => !state.selectedIds.has(page.id)
  );
  if (removingActive) {
    state.activeId = state.pages.length ? state.pages[0].id : null;
    state.cropMode = false;
  }

  state.selectionMode = false;
  state.selectedIds.clear();
  renderAll();
  scheduleSave();

  toast(t("toast.pagesRemoved", { count: removed.length }), {
    action: t("toast.undo"),
    duration: 6000,
    onAction: () => {
      removed
        .slice()
        .sort((a, b) => a.index - b.index)
        .forEach((item) => {
          state.pages.splice(
            Math.min(item.index, state.pages.length),
            0,
            item.page
          );
        });
      state.activeId = removed[0].page.id;
      renderAll();
      scheduleSave();
      toast(t("toast.pagesRestored"));
    },
  });
}

function selectPage(id) {
  if (!id || id === state.activeId) {
    closeCardMenus();
    return;
  }
  state.activeId = id;
  state.cropMode = false;
  closeCardMenus();
  renderPageList();
  const page = activePage();
  syncInspector(page);
  updateEditorMeta(page);
  updateCropUI();
  renderPreview();
  scheduleSave();
}

function movePage(id, direction) {
  const index = state.pages.findIndex((page) => page.id === id);
  if (index < 0) return;
  const target = index + direction;
  if (target < 0 || target >= state.pages.length) return;
  const [page] = state.pages.splice(index, 1);
  state.pages.splice(target, 0, page);
  renderPageList();
  syncInspector(activePage());
  updateEditorMeta(activePage());
  scheduleSave();
}

function reorderPage(sourceId, targetId) {
  const from = state.pages.findIndex((page) => page.id === sourceId);
  let to = state.pages.findIndex((page) => page.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [page] = state.pages.splice(from, 1);
  if (from < to) to -= 1;
  state.pages.splice(to, 0, page);
  renderPageList();
  syncInspector(activePage());
  updateEditorMeta(activePage());
  scheduleSave();
}

function deletePage(id) {
  const index = state.pages.findIndex((page) => page.id === id);
  if (index < 0) return;
  const [page] = state.pages.splice(index, 1);
  state.selectedIds.delete(id);

  if (state.activeId === id) {
    const next = state.pages[Math.min(index, state.pages.length - 1)];
    state.activeId = next ? next.id : null;
    state.cropMode = false;
  }

  renderAll();
  scheduleSave();

  toast(t("toast.pageRemoved"), {
    action: t("toast.undo"),
    duration: 6000,
    onAction: () => {
      state.pages.splice(Math.min(index, state.pages.length), 0, page);
      state.activeId = page.id;
      renderAll();
      scheduleSave();
      toast(t("toast.pageRestored"));
    },
  });
}

function updateEditorMeta(page) {
  if (!page) return;
  const index = state.pages.findIndex((item) => item.id === page.id);
  refs.fileIndex.textContent = pad2(index + 1);
  refs.fileName.textContent = page.name;
  refs.fileName.title = page.name;
  refs.fileDims.textContent = `${page.width} × ${page.height} px · ${formatBytes(page.size)}`;
}

function updateActiveCard() {
  const page = activePage();
  if (!page) return;
  const card = refs.pageList.querySelector(`.page-card[data-id="${page.id}"]`);
  if (!card) return;
  const image = card.querySelector(".thumb-wrap img");
  if (image && page.thumb) image.src = page.thumb;
  const meta = card.querySelector(".page-meta");
  if (meta) meta.textContent = metaFor(page);
  updateEditorMeta(page);
}

/* ------------------------------------------------------------------ */
/* Preview                                                            */
/* ------------------------------------------------------------------ */

function renderPreview() {
  const page = activePage();
  if (!page) return;
  const token = ++state.previewToken;

  if (state.cropMode) {
    const rotated = renderRotated(page.bitmap, page.rotation || 0, PREVIEW_MAX);
    if (token !== state.previewToken) return;
    paintPreview(rotated);
    updateCropOverlay();
    return;
  }

  let rendered;
  try {
    rendered = renderScan(page.bitmap, page, PREVIEW_MAX);
  } catch (error) {
    console.error("Paperglass: render failed", error);
    toast(t("toast.renderFailed"), { type: "error" });
    return;
  }
  if (token !== state.previewToken) return;

  paintPreview(rendered);
  page.thumb = makeThumbnail(rendered, 132);
  updateActiveCard();
  fitCanvas();
}

function paintPreview(source) {
  const canvas = refs.previewCanvas;
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  fitCanvas();
}

function fitCanvas() {
  const canvas = refs.previewCanvas;
  if (!canvas.width || !canvas.height) return;
  const slot = refs.canvasSlot;
  const availableWidth = slot.clientWidth;
  const availableHeight = slot.clientHeight;
  if (!availableWidth || !availableHeight) return;

  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
  const width = Math.max(24, Math.floor(canvas.width * scale));
  const height = Math.max(24, Math.floor(canvas.height * scale));
  refs.paperHolder.style.width = `${width}px`;
  refs.paperHolder.style.height = `${height}px`;
}

function schedulePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => {
    renderPreview();
    updateActiveCard();
  }, 100);
}

/* ------------------------------------------------------------------ */
/* Crop overlay                                                       */
/* ------------------------------------------------------------------ */

function updateCropUI() {
  const page = activePage();
  const cropping = Boolean(page && state.cropMode);
  refs.editor.classList.toggle("is-cropping", cropping);
  refs.cropBtn.classList.toggle("is-active", cropping);
  refs.cropBtn.setAttribute("aria-pressed", String(cropping));
  refs.cropActions.hidden = !cropping;
  if (refs.deleteCurrentBtn) refs.deleteCurrentBtn.hidden = cropping;
  refs.paperHolder.style.touchAction = cropping ? "none" : "";
  refs.stageHint.textContent = cropping ? t("editor.tipCrop") : t("editor.tipIdle");
  refs.cropBtn.querySelector(".crop-label").textContent = cropping
    ? t("editor.finishCrop")
    : t("editor.adjustEdges");

  if (cropping) {
    updateCropOverlay();
  }
}

function updateCropOverlay() {
  const page = activePage();
  if (!page || !state.cropMode) return;
  const corners = page.corners;
  const points = corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");

  refs.cropPoly.setAttribute("points", points);

  const outer = "M 0 0 H 100 V 100 H 0 Z";
  const inner = corners
    .map((point, index) => {
      const x = point.x * 100;
      const y = point.y * 100;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  refs.cropDim.setAttribute("d", `${outer} ${inner} Z`);

  const handles = $$(".crop-handle", refs.cropHandles);
  corners.forEach((point, index) => {
    const handle = handles[index];
    if (!handle) return;
    handle.style.left = `${(point.x * 100).toFixed(3)}%`;
    handle.style.top = `${(point.y * 100).toFixed(3)}%`;
  });
}

function setCropMode(enabled) {
  const page = activePage();
  if (!page) return;
  state.cropMode = enabled;
  if (!enabled) {
    updateCropUI();
    renderPreview();
    scheduleSave();
  } else {
    updateCropUI();
    renderPreview();
  }
}

function resetCrop() {
  const page = activePage();
  if (!page) return;
  page.corners = fullCorners(0.012);
  updateCropOverlay();
  scheduleSave();
}

function autoCrop() {
  const page = activePage();
  if (!page) return;
  const result = detectCorners(page.bitmap, page.rotation || 0);
  if (result) {
    page.corners = result;
    updateCropOverlay();
    scheduleSave();
    toast(t("crop.edgesDetected"));
  } else {
    toast(t("crop.notFound"), { type: "error" });
  }
}

function rotatePage(direction) {
  const page = activePage();
  if (!page) return;
  state.previewToken += 1;
  page.rotation = ((page.rotation || 0) + (direction > 0 ? 90 : 270)) % 360;
  page.corners = rotateCorners(page.corners, direction);
  updateCropUI();
  renderPreview();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* Import                                                             */
/* ------------------------------------------------------------------ */

function isImageFile(file) {
  return (
    (file.type && file.type.startsWith("image/")) ||
    /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || "")
  );
}

async function addFiles(fileList) {
  const files = [...fileList].filter(isImageFile);
  if (!files.length) {
    toast(t("import.chooseImage"), { type: "error" });
    return;
  }

  const startedEmpty = state.pages.length === 0;
  let added = 0;
  let undetected = 0;
  const failed = [];

  state.selectionMode = false;
  state.selectedIds.clear();

  showBusy(
    t("import.reading"),
    t("import.progress", { index: 0, count: files.length }),
    0
  );
  await nextFrame();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    setBusy(
      t("import.scanning", { index: index + 1, count: files.length }),
      file.name.length > 42 ? `${file.name.slice(0, 39)}…` : file.name,
      (index / files.length) * 100
    );
    await nextFrame();

    try {
      const bitmap = await decodeImage(file);
      const { corners, detected } = suggestCorners(bitmap, 0);
      if (!detected) undetected += 1;

      const page = {
        id: createId(),
        name: file.name || `scan-${state.pages.length + 1}.jpg`,
        size: file.size,
        blob: file,
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        rotation: 0,
        corners,
        ...readRememberedLook(),
        thumb: "",
        createdAt: Date.now(),
      };

      const preview = renderScan(bitmap, page, 300);
      page.thumb = makeThumbnail(preview, 132);
      state.pages.push(page);
      state.activeId = page.id;
      added += 1;
    } catch (error) {
      console.warn("Paperglass: could not read", file.name, error);
      failed.push(file.name);
    }

    setBusy(
      t("import.scanning", { index: index + 1, count: files.length }),
      file.name.length > 42 ? `${file.name.slice(0, 39)}…` : file.name,
      ((index + 1) / files.length) * 100
    );
  }

  if (startedEmpty) state.cropMode = false;
  hideBusy();
  renderAll();
  scheduleSave();

  if (added) {
    toast(
      t("import.added", { count: added }),
      added > 1 && undetected ? { duration: 5000 } : undefined
    );
  }

  if (undetected) {
    setTimeout(() => {
      toast(t("import.undetected", { count: undetected }), {
        type: "error",
        duration: 6000,
      });
    }, added ? 350 : 0);
  }

  if (failed.length) {
    setTimeout(() => {
      toast(t("import.failed", { count: failed.length }), {
        type: "error",
        duration: 6500,
      });
    }, added || undetected ? 800 : 0);
  }
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function scheduleSave() {
  state.dirty = true;
  setSaveState("saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => persist(), 650);
}

async function persist() {
  if (state.restoring) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;

  if (!state.pages.length) {
    await clearSession();
    state.dirty = false;
    setSaveState("saved");
    return;
  }

  const snapshot = {
    v: 1,
    savedAt: Date.now(),
    activeId: state.activeId,
    pages: state.pages.map((page) => ({
      id: page.id,
      name: page.name,
      size: page.size,
      blob: page.blob,
      width: page.width,
      height: page.height,
      rotation: page.rotation,
      corners: page.corners.map((point) => ({ x: point.x, y: point.y })),
      mode: page.mode,
      brightness: page.brightness,
      contrast: page.contrast,
      cleanup: page.cleanup,
      createdAt: page.createdAt,
    })),
  };

  const ok = await saveSession(snapshot);
  state.dirty = false;
  setSaveState(ok ? "saved" : "error");

  if (!ok && !state.saveWarned) {
    state.saveWarned = true;
    toast(t("save.unavailable"), {
      type: "error",
      duration: 6000,
    });
  }
}

async function restoreSession() {
  state.restoring = true;
  const data = await loadSession();

  if (!data || !Array.isArray(data.pages) || !data.pages.length) {
    state.restoring = false;
    return false;
  }

  showBusy(
    t("restore.title"),
    t("pages.count", { count: data.pages.length }),
    0
  );
  await nextFrame();

  for (let index = 0; index < data.pages.length; index += 1) {
    const saved = data.pages[index];
    setBusy(
      t("restore.page", { index: index + 1, count: data.pages.length }),
      saved.name || "",
      (index / data.pages.length) * 100
    );
    try {
      if (!saved.blob) continue;
      const bitmap = await decodeImage(saved.blob);
      const page = {
        id: saved.id || createId(),
        name: saved.name || `scan-${index + 1}.jpg`,
        size: saved.size || saved.blob.size || 0,
        blob: saved.blob,
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        rotation: saved.rotation || 0,
        corners:
          Array.isArray(saved.corners) && saved.corners.length === 4
            ? saved.corners
            : fullCorners(0.02),
        mode: saved.mode in PRESETS ? saved.mode : "clean",
        brightness: Number.isFinite(saved.brightness) ? saved.brightness : PRESETS.clean.brightness,
        contrast: Number.isFinite(saved.contrast) ? saved.contrast : PRESETS.clean.contrast,
        cleanup: Number.isFinite(saved.cleanup) ? saved.cleanup : PRESETS.clean.cleanup,
        thumb: "",
        createdAt: saved.createdAt || Date.now(),
      };
      page.thumb = makeThumbnail(renderScan(bitmap, page, 280), 132);
      state.pages.push(page);
    } catch (error) {
      console.warn("Paperglass: could not restore page", error);
    }
    await nextFrame();
  }

  hideBusy();
  state.restoring = false;

  if (!state.pages.length) return false;
  state.activeId =
    data.activeId && state.pages.some((page) => page.id === data.activeId)
      ? data.activeId
      : state.pages[0].id;
  setSaveState("saved");
  return true;
}

function setSaveState(kind) {
  refs.saveState.dataset.state = kind;
  refs.saveState.classList.toggle("is-saving", kind === "saving");
  if (kind === "saving") refs.saveStateText.textContent = t("save.saving");
  else if (kind === "error") refs.saveStateText.textContent = t("save.error");
  else refs.saveStateText.textContent = t("save.saved");
}

/* ------------------------------------------------------------------ */
/* Toasts + busy                                                      */
/* ------------------------------------------------------------------ */

function toast(message, options = {}) {
  const { type = "info", action, onAction, duration = 3600 } = options;
  const existing = $$(".toast", refs.toasts);
  if (existing.length >= 3) existing[0].remove();

  const element = document.createElement("div");
  element.className = `toast${type === "error" ? " is-error" : ""}`;
  element.innerHTML = `
    <span class="toast-icon"><svg class="icon" aria-hidden="true"><use href="#${
      type === "error" ? "i-alert" : "i-check"
    }"/></svg></span>
    <span></span>
    ${action ? '<button type="button"></button>' : ""}`;

  element.querySelectorAll("span")[1].textContent = message;

  let timer = null;
  const remove = () => {
    if (!element.isConnected) return;
    clearTimeout(timer);
    element.classList.add("is-leaving");
    setTimeout(() => element.remove(), 240);
  };

  if (action) {
    const button = element.querySelector("button");
    button.textContent = action;
    button.addEventListener("click", () => {
      remove();
      if (onAction) onAction();
    });
  }

  refs.toasts.appendChild(element);
  timer = setTimeout(remove, duration);
  element.addEventListener("mouseenter", () => clearTimeout(timer));
  element.addEventListener("mouseleave", () => {
    timer = setTimeout(remove, 1600);
  });
}

function showBusy(title = t("busy.working"), detail = "", progress = null) {
  refs.busyTitle.textContent = title;
  refs.busyDetail.textContent = detail;
  refs.busy.hidden = false;
  setBusyProgress(progress);
}

function setBusy(title, detail, progress = null) {
  refs.busyTitle.textContent = title;
  if (detail !== undefined) refs.busyDetail.textContent = detail;
  setBusyProgress(progress);
}

function setBusyProgress(progress) {
  const bar = refs.busyProgress;
  const fill = bar.firstElementChild;
  if (progress === null || progress === undefined) {
    bar.hidden = true;
    fill.style.width = "0%";
  } else {
    bar.hidden = false;
    fill.style.width = `${clamp(progress, 0, 100)}%`;
  }
}

function hideBusy() {
  refs.busy.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function openExportModal() {
  if (!state.pages.length) return;
  if (!refs.exportName.value) refs.exportName.value = currentDateName();
  if (!refs.imageName.value) refs.imageName.value = refs.exportName.value;
  updateExportUI();
  openModal(refs.exportModal);
}

function setExportFormat(format) {
  state.exportFormat = format;
  $$("#exportFormat button").forEach((button) => {
    const active = button.dataset.format === format;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  refs.pdfOptions.hidden = format !== "pdf";
  refs.imageOptions.hidden = format !== "images";
  updateExportUI();
}

function updateExportUI() {
  const count = state.pages.length;
  refs.exportSubtitle.textContent = t("export.subtitle", { count });
  refs.pdfSummaryText.textContent = t("export.pdfSummary", {
    count,
    paper: state.paperSize === "letter" ? "Letter" : "A4",
  });

  const nameField = state.exportFormat === "pdf" ? refs.exportName : refs.imageName;
  if (!nameField.value) nameField.value = currentDateName();

  const ext = state.imageFormat === "png" ? "png" : "jpg";
  refs.imageExt.textContent = `.${ext}`;
  refs.imageSummaryText.textContent = t("export.imageSummary", {
    count,
    ext: ext.toUpperCase(),
  });
  refs.imageSummaryNote.textContent =
    count > 1 ? t("export.zipNote") : t("export.singleNote");

  const label =
    state.exportFormat === "pdf"
      ? t("export.downloadPdf")
      : count > 1
        ? t("export.downloadZip")
        : t("export.downloadImage");
  refs.exportConfirm.querySelector("span").textContent = label;
}

async function runExport() {
  if (!state.pages.length) return;

  const pages = [...state.pages];
  const format = state.exportFormat;

  try {
    if (format === "pdf") {
      const base = sanitizeName(refs.exportName.value);
      const quality = QUALITY[refs.pdfQuality.value] || QUALITY.balanced;
      showBusy(
        t("export.buildingPdf"),
        t("export.renderingPage", { index: 1, count: pages.length }),
        0
      );
      await nextFrame();

      const images = [];
      for (let index = 0; index < pages.length; index += 1) {
        setBusy(
          t("export.buildingPdf"),
          t("export.renderingPage", { index: index + 1, count: pages.length }),
          (index / pages.length) * 100
        );
        await nextFrame();
        const canvas = renderScan(pages[index].bitmap, pages[index], EXPORT_MAX);
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        images.push({ bytes, width: canvas.width, height: canvas.height });
      }

      setBusy(t("export.buildingPdf"), t("export.writingDoc"), 96);
      await nextFrame();
      const pdf = buildPdf(images, { paper: state.paperSize });
      triggerDownload(pdf, `${base}.pdf`);
      hideBusy();
      closeModal(refs.exportModal);
      toast(t("export.pdfReady", { count: pages.length }));
    } else {
      const base = sanitizeName(refs.imageName.value);
      const type = state.imageFormat === "png" ? "image/png" : "image/jpeg";
      const ext = state.imageFormat === "png" ? "png" : "jpg";
      const quality = type === "image/png" ? undefined : QUALITY[refs.imageQuality.value] || QUALITY.balanced;
      const files = [];

      showBusy(
        t("export.exportingImages"),
        t("export.renderingPage", { index: 1, count: pages.length }),
        0
      );
      await nextFrame();

      for (let index = 0; index < pages.length; index += 1) {
        setBusy(
          t("export.exportingImages"),
          t("export.renderingPage", { index: index + 1, count: pages.length }),
          (index / pages.length) * 100
        );
        await nextFrame();
        const canvas = renderScan(pages[index].bitmap, pages[index], EXPORT_MAX);
        const blob = await canvasToBlob(canvas, type, quality);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const suffix = pages.length > 1 ? `-${pad2(index + 1)}` : "";
        files.push({ name: `${base}${suffix}.${ext}`, bytes });
      }

      if (files.length === 1) {
        const blob = new Blob([files[0].bytes], { type });
        triggerDownload(blob, files[0].name);
        toast(t("export.imageDownloaded"));
      } else {
        setBusy(t("export.exportingImages"), t("export.packingZip"), 96);
        await wait(80);
        const zip = createZip(files);
        triggerDownload(zip, `${base}.zip`);
        toast(t("export.zipReady", { count: files.length }));
      }

      hideBusy();
      closeModal(refs.exportModal);
    }
  } catch (error) {
    console.error("Paperglass: export failed", error);
    hideBusy();
    toast(t("export.failed"), {
      type: "error",
      duration: 6000,
    });
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadSinglePage(page) {
  if (!page) return;
  showBusy(t("export.preparingImage"), page.name, null);
  return (async () => {
    await nextFrame();
    try {
      const canvas = renderScan(page.bitmap, page, EXPORT_MAX);
      const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      const index = state.pages.findIndex((item) => item.id === page.id);
      triggerDownload(
        blob,
        `${fileBaseName(page.name)}${state.pages.length > 1 ? `-page-${pad2(index + 1)}` : ""}.jpg`
      );
      toast(t("export.imageDownloaded"));
    } catch (error) {
      console.error(error);
      toast(t("export.failedPage"), { type: "error" });
    } finally {
      hideBusy();
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Enhance controls                                                   */
/* ------------------------------------------------------------------ */

function updateRangeFill(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}

function syncInspector(page) {
  if (!page) return;
  const mode = PRESETS[page.mode] ? page.mode : "clean";

  $$(".preset", refs.presetGrid).forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });

  const brightness = Number.isFinite(page.brightness) ? page.brightness : 0;
  const contrast = Number.isFinite(page.contrast) ? page.contrast : 10;
  const cleanup = Number.isFinite(page.cleanup) ? page.cleanup : 60;

  refs.brightness.value = brightness;
  refs.contrast.value = contrast;
  refs.cleanup.value = cleanup;
  refs.brightnessOut.textContent = brightness;
  refs.contrastOut.textContent = contrast;
  refs.cleanupOut.textContent = cleanup;

  [refs.brightness, refs.contrast, refs.cleanup].forEach((input) => {
    updateRangeFill(input);
    input.disabled = mode === "original";
  });
  refs.inspector.classList.toggle("is-disabled", mode === "original");

  const index = state.pages.findIndex((item) => item.id === page.id);
  refs.moveUpBtn.disabled = index <= 0;
  refs.moveDownBtn.disabled = index < 0 || index >= state.pages.length - 1;
  refs.deletePageBtn.disabled = state.pages.length === 0;
}

function applyPreset(mode) {
  const page = activePage();
  if (!page || !PRESETS[mode]) return;
  Object.assign(page, PRESETS[mode]);
  rememberLook(page);
  syncInspector(page);
  renderPreview();
  updateActiveCard();
  scheduleSave();
}

function resetAdjustments() {
  const page = activePage();
  if (!page) return;
  Object.assign(page, PRESETS[page.mode] || PRESETS.clean);
  rememberLook(page);
  syncInspector(page);
  renderPreview();
  updateActiveCard();
  scheduleSave();
  toast(t("adjust.resetToast"));
}

async function applyLookToAll() {
  const source = activePage();
  if (!source) return;
  if (state.pages.length < 2) {
    toast(t("apply.needTwo"));
    return;
  }

  showBusy(
    t("apply.busy"),
    t("import.progress", { index: 1, count: state.pages.length }),
    0
  );
  await nextFrame();

  for (let index = 0; index < state.pages.length; index += 1) {
    const page = state.pages[index];
    page.mode = source.mode;
    page.brightness = source.brightness;
    page.contrast = source.contrast;
    page.cleanup = source.cleanup;
    setBusy(
      t("apply.busy"),
      t("apply.page", { index: index + 1, count: state.pages.length }),
      (index / state.pages.length) * 100
    );
    await nextFrame();
    page.thumb = makeThumbnail(renderScan(page.bitmap, page, 280), 132);
  }

  hideBusy();
  renderAll();
  scheduleSave();
  rememberLook(source);
  toast(t("apply.done", { count: state.pages.length }));
}

/* ------------------------------------------------------------------ */
/* Modals                                                             */
/* ------------------------------------------------------------------ */

function openModal(element) {
  state.restoreFocus = document.activeElement;
  element.hidden = false;
  requestAnimationFrame(() => {
    const target = element.querySelector(
      "input:not([type=hidden]):not([disabled]), select, .btn-primary, button:not([data-close])"
    );
    if (target) target.focus();
  });
}

function closeModal(element) {
  if (!element || element.hidden) return;
  element.hidden = true;
  if (state.restoreFocus && typeof state.restoreFocus.focus === "function") {
    state.restoreFocus.focus();
  }
  state.restoreFocus = null;
}

function closeById(name) {
  if (name === "export") closeModal(refs.exportModal);
  else if (name === "confirm") {
    state.confirmCallback = null;
    closeModal(refs.confirmModal);
  } else if (name === "camera") closeCameraModal();
}

function openConfirm({
  title,
  message,
  actionLabel = t("actions.delete"),
  danger = true,
  onConfirm,
}) {
  refs.confirmTitle.textContent = title;
  refs.confirmMessage.textContent = message;
  refs.confirmAction.textContent = actionLabel;
  refs.confirmAction.classList.toggle("btn-danger", danger);
  refs.confirmAction.classList.toggle("btn-primary", !danger);
  state.confirmCallback = onConfirm;
  openModal(refs.confirmModal);
}

function clearAllPages() {
  if (!state.pages.length) return;
  openConfirm({
    title: t("confirm.clearTitle"),
    message: t("confirm.clearMessage", { count: state.pages.length }),
    actionLabel: t("confirm.clearAll"),
    onConfirm: async () => {
      closeInspectorPanel();
      state.selectionMode = false;
      state.selectedIds.clear();
      state.pages = [];
      state.activeId = null;
      state.cropMode = false;
      await clearSession();
      renderAll();
      setSaveState("saved");
      toast(t("toast.sessionCleared"));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Camera                                                             */
/* ------------------------------------------------------------------ */

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    refs.cameraInput.click();
    return;
  }

  openModal(refs.cameraModal);
  refs.cameraError.hidden = true;
  refs.captureBtn.disabled = true;

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
    refs.cameraVideo.srcObject = state.cameraStream;
    await refs.cameraVideo.play().catch(() => {});
    refs.captureBtn.disabled = false;
  } catch (error) {
    console.warn("Paperglass: camera unavailable", error);
    refs.cameraError.hidden = false;
    refs.cameraError.textContent = t("camera.unavailable");
    refs.captureBtn.disabled = true;
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }
  if (refs.cameraVideo) refs.cameraVideo.srcObject = null;
}

function closeCameraModal() {
  stopCamera();
  closeModal(refs.cameraModal);
}

async function capturePhoto() {
  const video = refs.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    closeCameraModal();
    refs.cameraInput.click();
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  closeCameraModal();

  if (blob) {
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    addFiles([file]);
  } else {
    toast(t("camera.captureFailed"), { type: "error" });
  }
}

/* ------------------------------------------------------------------ */
/* Page menus + crop drag                                              */
/* ------------------------------------------------------------------ */

function closeCardMenus() {
  $$(".card-menu", refs.pageList).forEach((menu) => {
    menu.hidden = true;
    const card = menu.closest(".page-card");
    const button = card && card.querySelector('[data-action="menu"]');
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

function toggleCardMenu(button) {
  const card = button.closest(".page-card");
  if (!card) return;
  const menu = card.querySelector(".card-menu");
  if (!menu) return;

  const wasOpen = !menu.hidden;
  closeCardMenus();
  if (wasOpen) return;

  const rect = button.getBoundingClientRect();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");

  const menuRect = menu.getBoundingClientRect();
  const rtl = document.documentElement.dir === "rtl";
  let left = rtl ? rect.left : rect.right - menuRect.width;
  left = Math.min(
    Math.max(10, left),
    Math.max(10, window.innerWidth - menuRect.width - 10)
  );
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 10) {
    top = rect.top - menuRect.height - 6;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(10, top)}px`;
}

function handleCardAction(action, id) {
  const page = state.pages.find((item) => item.id === id);
  if (!page) return;

  if (action === "up") movePage(id, -1);
  else if (action === "down") movePage(id, 1);
  else if (action === "delete") deletePage(id);
  else if (action === "download") downloadSinglePage(page);
  else if (action === "crop") {
    selectPage(id);
    window.setTimeout(() => setCropMode(true), 0);
  }
}

function quadArea(corners) {
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function quadIsConvex(corners) {
  let sign = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const c = corners[(i + 2) % corners.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const current = Math.sign(cross);
    if (!sign) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

function startCornerDrag(event) {
  if (!state.cropMode) return;
  const handle = event.currentTarget;
  const index = Number(handle.dataset.corner);
  const page = activePage();
  if (!page) return;

  event.preventDefault();
  state.dragCorner = index;
  state.cornerBackup = page.corners.map((point) => ({ ...point }));
  handle.classList.add("is-dragging");
  try {
    handle.setPointerCapture(event.pointerId);
  } catch (error) {
    /* ignore */
  }
}

function moveCorner(event) {
  if (state.dragCorner === null) return;
  const page = activePage();
  if (!page) return;
  const rect = refs.paperHolder.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = clamp((event.clientX - rect.left) / rect.width, 0.002, 0.998);
  const y = clamp((event.clientY - rect.top) / rect.height, 0.002, 0.998);
  page.corners[state.dragCorner] = { x, y };
  updateCropOverlay();
}

function endCornerDrag(event) {
  if (state.dragCorner === null) return;
  const page = activePage();
  if (page) {
    const corners = page.corners;
    if (quadArea(corners) < 0.015 || !quadIsConvex(corners)) {
      page.corners = state.cornerBackup || fullCorners(0.02);
      toast(t("crop.crossed"), { duration: 2200 });
    }
    updateCropOverlay();
    scheduleSave();
  }
  state.dragCorner = null;
  state.cornerBackup = null;
  if (event) {
    try {
      event.target.releasePointerCapture?.(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  }
  $$(".crop-handle", refs.cropHandles).forEach((handle) =>
    handle.classList.remove("is-dragging")
  );
}

/* ------------------------------------------------------------------ */
/* Inspector drawer                                                   */
/* ------------------------------------------------------------------ */

function openInspectorPanel() {
  refs.inspector.classList.add("is-open");
  refs.inspectorScrim.hidden = false;
}

function closeInspectorPanel() {
  refs.inspector.classList.remove("is-open");
  refs.inspectorScrim.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  // Theme + language
  refs.themeToggle.addEventListener("click", toggleTheme);
  refs.langToggle.addEventListener("click", toggleLocale);

  // Import
  refs.headerAdd.addEventListener("click", () => refs.fileInput.click());
  refs.sidebarAdd.addEventListener("click", () => refs.fileInput.click());
  refs.choosePhotos.addEventListener("click", (event) => {
    event.stopPropagation();
    refs.fileInput.click();
  });
  refs.openCamera.addEventListener("click", (event) => {
    event.stopPropagation();
    openCamera();
  });
  refs.dropzone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    refs.fileInput.click();
  });
  refs.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      refs.fileInput.click();
    }
  });

  refs.fileInput.addEventListener("change", () => {
    // Copy the FileList before clearing the input: resetting `value` empties
    // the live FileList, which previously made picker imports a no-op.
    const files = [...refs.fileInput.files];
    refs.fileInput.value = "";
    if (files.length) addFiles(files);
  });
  refs.cameraInput.addEventListener("change", () => {
    const files = [...refs.cameraInput.files];
    refs.cameraInput.value = "";
    if (files.length) addFiles(files);
  });

  // Drag and drop files anywhere
  let dragDepth = 0;
  const hasFiles = (event) =>
    event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    refs.dropOverlay.hidden = false;
    document.body.classList.add("is-dragging-over");
  });
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      refs.dropOverlay.hidden = true;
      document.body.classList.remove("is-dragging-over");
    }
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    refs.dropOverlay.hidden = true;
    document.body.classList.remove("is-dragging-over");
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  });

  // Sidebar
  refs.sidebarSelect.addEventListener("click", () => {
    enterSelectionMode();
    closeSidebar();
  });
  refs.sidebarToggle?.addEventListener("click", toggleSidebar);
  refs.sidebarBackdrop?.addEventListener("click", closeSidebar);
  refs.mobileAdd.addEventListener("click", () => {
    refs.fileInput.click();
    closeSidebar();
  });
  refs.mobileSelect.addEventListener("click", () => {
    enterSelectionMode();
    closeSidebar();
  });
  refs.mobileClear.addEventListener("click", clearAllPages);
  refs.selectAllBtn.addEventListener("click", toggleSelectAllPages);
  refs.deleteSelectedBtn.addEventListener("click", deleteSelectedPages);
  refs.cancelSelectBtn.addEventListener("click", exitSelectionMode);
  refs.clearAll.addEventListener("click", clearAllPages);
  refs.pageList.addEventListener("click", (event) => {
    const card = event.target.closest(".page-card");
    if (!card) return;

    if (state.selectionMode) {
      event.preventDefault();
      togglePageSelection(card.dataset.id);
      return;
    }

    if (window.innerWidth <= 900) {
      closeSidebar();
    }

    const actionButton = event.target.closest("[data-menu-action]");
    if (actionButton) {
      event.stopPropagation();
      const action = actionButton.dataset.menuAction;
      closeCardMenus();
      handleCardAction(action, card.dataset.id);
      return;
    }

    const menuButton = event.target.closest('[data-action="menu"]');
    if (menuButton) {
      event.stopPropagation();
      toggleCardMenu(menuButton);
      return;
    }

    if (event.target.closest(".card-menu")) return;
    selectPage(card.dataset.id);
  });

  refs.pageList.addEventListener("keydown", (event) => {
    const card = event.target.closest(".page-card");
    if (!card || event.target !== card) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (state.selectionMode) togglePageSelection(card.dataset.id);
    else selectPage(card.dataset.id);
  });

  refs.pageList.addEventListener("scroll", closeCardMenus, { passive: true });
  window.addEventListener("resize", () => {
    closeCardMenus();
    if (window.innerWidth > 900) {
      closeSidebar();
    }
    fitCanvas();
    updateCropOverlay();
  });

  // Reordering
  refs.pageList.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".page-card");
    if (!card) return;
    state.draggingId = card.dataset.id;
    closeCardMenus();
    card.classList.add("is-dragging");
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.draggingId);
    } catch (error) {
      /* ignore */
    }
  });
  refs.pageList.addEventListener("dragover", (event) => {
    if (!state.draggingId) return;
    const card = event.target.closest(".page-card");
    if (!card) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    $$(".page-card", refs.pageList).forEach((item) =>
      item.classList.toggle(
        "is-drop-target",
        item === card && card.dataset.id !== state.draggingId
      )
    );
  });
  refs.pageList.addEventListener("drop", (event) => {
    if (!state.draggingId) return;
    const card = event.target.closest(".page-card");
    if (!card) return;
    event.preventDefault();
    reorderPage(state.draggingId, card.dataset.id);
    state.draggingId = null;
    $$(".page-card", refs.pageList).forEach((item) => {
      item.classList.remove("is-dragging", "is-drop-target");
    });
  });
  refs.pageList.addEventListener("dragend", () => {
    state.draggingId = null;
    $$(".page-card", refs.pageList).forEach((item) => {
      item.classList.remove("is-dragging", "is-drop-target");
    });
  });

  // Editor actions
  refs.rotateLeft.addEventListener("click", () => rotatePage(-1));
  refs.rotateRight.addEventListener("click", () => rotatePage(1));
  refs.cropBtn.addEventListener("click", () => setCropMode(!state.cropMode));
  refs.doneCrop.addEventListener("click", () => setCropMode(false));
  refs.resetCrop.addEventListener("click", resetCrop);
  refs.autoCrop.addEventListener("click", autoCrop);
  refs.quickDownload.addEventListener("click", () => downloadSinglePage(activePage()));
  refs.openInspector.addEventListener("click", openInspectorPanel);
  refs.closeInspector.addEventListener("click", closeInspectorPanel);
  refs.inspectorScrim.addEventListener("click", closeInspectorPanel);

  // Crop handles
  $$(".crop-handle", refs.cropHandles).forEach((handle) => {
    handle.addEventListener("pointerdown", startCornerDrag);
  });
  window.addEventListener("pointermove", moveCorner);
  window.addEventListener("pointerup", endCornerDrag);
  window.addEventListener("pointercancel", endCornerDrag);

  // Inspector
  refs.presetGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) applyPreset(button.dataset.mode);
  });
  refs.resetAdjustments.addEventListener("click", resetAdjustments);
  refs.applyAll.addEventListener("click", applyLookToAll);
  refs.moveUpBtn.addEventListener("click", () => {
    const page = activePage();
    if (page) movePage(page.id, -1);
  });
  refs.moveDownBtn.addEventListener("click", () => {
    const page = activePage();
    if (page) movePage(page.id, 1);
  });
  refs.deletePageBtn.addEventListener("click", () => {
    const page = activePage();
    if (page) deletePage(page.id);
  });
  refs.deleteCurrentBtn.addEventListener("click", () => {
    const page = activePage();
    if (page) deletePage(page.id);
  });

  const sliders = [
    [refs.brightness, "brightness", refs.brightnessOut],
    [refs.contrast, "contrast", refs.contrastOut],
    [refs.cleanup, "cleanup", refs.cleanupOut],
  ];
  sliders.forEach(([input, property, output]) => {
    input.addEventListener("input", () => {
      const page = activePage();
      if (!page) return;
      page[property] = Number(input.value);
      output.textContent = input.value;
      updateRangeFill(input);
      schedulePreview();
      scheduleSave();
      scheduleRememberLook(page);
    });
    input.addEventListener("change", () => {
      const page = activePage();
      if (page) rememberLook(page);
    });
  });

  // Export
  refs.exportBtn.addEventListener("click", openExportModal);
  refs.exportConfirm.addEventListener("click", runExport);
  refs.exportFormat.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-format]");
    if (button) setExportFormat(button.dataset.format);
  });
  refs.paperSize.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-size]");
    if (!button) return;
    state.paperSize = button.dataset.size;
    $$("button", refs.paperSize).forEach((item) =>
      item.classList.toggle("is-active", item === button)
    );
    updateExportUI();
  });
  refs.imageFormat.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-image]");
    if (!button) return;
    state.imageFormat = button.dataset.image;
    $$("button", refs.imageFormat).forEach((item) =>
      item.classList.toggle("is-active", item === button)
    );
    updateExportUI();
  });
  refs.imageName.addEventListener("input", () => {
    if (!refs.exportName.value) refs.exportName.value = refs.imageName.value;
  });

  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeById(button.dataset.close));
  });

  refs.confirmAction.addEventListener("click", async () => {
    const callback = state.confirmCallback;
    state.confirmCallback = null;
    closeModal(refs.confirmModal);
    if (callback) await callback();
  });

  // Camera
  refs.captureBtn.addEventListener("click", capturePhoto);
  refs.cameraFallback.addEventListener("click", () => {
    closeCameraModal();
    refs.cameraInput.click();
  });

  // Keyboard
  document.addEventListener("keydown", handleShortcuts);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".card-menu") && !event.target.closest('[data-action="menu"]')) {
      closeCardMenus();
    }
  });

  // Flush autosave when the tab goes away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.dirty) {
      clearTimeout(state.saveTimer);
      persist();
    }
  });
  window.addEventListener("pagehide", () => {
    if (state.dirty) {
      clearTimeout(state.saveTimer);
      persist();
    }
  });
}

function handleShortcuts(event) {
  if (event.key === "Escape") {
    if (!refs.cameraModal.hidden) {
      closeCameraModal();
      return;
    }
    if (!refs.confirmModal.hidden) {
      state.confirmCallback = null;
      closeModal(refs.confirmModal);
      return;
    }
    if (!refs.exportModal.hidden) {
      closeModal(refs.exportModal);
      return;
    }
    if (refs.inspector.classList.contains("is-open")) {
      closeInspectorPanel();
      return;
    }
    if (refs.sidebar?.classList.contains("is-open")) {
      closeSidebar();
      return;
    }
    if (state.cropMode) {
      setCropMode(false);
      return;
    }
    if (state.selectionMode) {
      exitSelectionMode();
      return;
    }
    closeCardMenus();
    return;
  }

  const tag = event.target && event.target.tagName;
  const typing =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (event.target && event.target.isContentEditable);
  if (typing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key.toLowerCase();
  if (key === "t") {
    toggleTheme();
  } else if (key === "o") {
    event.preventDefault();
    refs.fileInput.click();
  } else if (key === "e") {
    if (!refs.exportBtn.disabled) {
      event.preventDefault();
      openExportModal();
    }
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    if (!state.pages.length || state.cropMode) return;
    if (!refs.exportModal.hidden || !refs.confirmModal.hidden || !refs.cameraModal.hidden) return;
    const index = state.pages.findIndex((page) => page.id === state.activeId);
    const forwardKey = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const next = clamp(
      index + (event.key === forwardKey ? 1 : -1),
      0,
      state.pages.length - 1
    );
    if (next !== index) {
      event.preventDefault();
      selectPage(state.pages[next].id);
    }
  }
}

/* Expose a tiny debug surface (useful for testing and tinkering). */
window.Paperglass = {
  state,
  addFiles,
  renderScan,
  detectCorners,
  get activePage() {
    return activePage();
  },
};

init();
