const CONFIG = {
  MODEL_URL: "https://teachablemachine.withgoogle.com/models/nhq2UTl2O/",
  PREDICT_INTERVAL_MS: 300,
  LOW_CONFIDENCE_THRESHOLD: 0.6,
  MIN_FOCUS_BOX_SIZE: 48,
  MAX_FILE_SIZE_MB: 8,
  TOAST_DURATION_MS: 3200,
  MAX_HISTORY: 8,
  THEME_STORAGE_KEY: "mataku-theme",
};

const colorData = {
  "Merah":  { hex: "#e63946", icon: "🔴", tips: "Mungkin tampak coklat gelap pada buta warna merah-hijau." },
  "Orange": { hex: "#fb5607", icon: "🟠", tips: "Bisa tampak mirip coklat atau kekuningan." },
  "Kuning": { hex: "#ffbe0b", icon: "🟡", tips: "Bisa tampak lebih pucat pada beberapa tipe buta warna." },
  "Hijau":  { hex: "#2d6a4f", icon: "🟢", tips: "Warna yang sering membingungkan penderita deuteranopia." },
  "Biru":   { hex: "#74b9ff", icon: "🔵", tips: "Terdeteksi normal oleh penderita buta warna merah-hijau." },
  "Ungu":   { hex: "#8338ec", icon: "🟣", tips: "Masih bisa dibedakan oleh buta warna merah-hijau." },
};
const DEFAULT_COLOR_INFO = { hex: "#5b8aff", icon: "🎨", tips: "" };

/* 1. DOM REFERENCES */
const el = {
  camWrap: document.getElementById("cam-wrap"),
  video: document.getElementById("video"),
  canvas: document.getElementById("canvas-output"),
  placeholder: document.getElementById("placeholder"),
  focusBox: document.getElementById("focus-box"),
  focusLabel: document.getElementById("fb-label"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  resultArea: document.getElementById("result-area"),
  colorSwatch: document.getElementById("color-swatch"),
  resultName: document.getElementById("result-name"),
  resultSub: document.getElementById("result-sub"),
  confBadge: document.getElementById("conf-badge"),
  confFill: document.getElementById("conf-fill"),
  btnCam: document.getElementById("btn-cam"),
  btnIcon: document.getElementById("btn-icon"),
  btnLabel: document.getElementById("btn-label"),
  fileInput: document.getElementById("file-input"),
  btnRemove: document.getElementById("btn-remove"),
  toast: document.getElementById("toast"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  btnSwitchCam: document.getElementById("btn-switch-cam"),
  modelLoadingOverlay: document.getElementById("model-loading-overlay"),
  btnSaveResult: document.getElementById("btn-save-result"),
  btnCapture: document.getElementById("btn-capture"),
  historyArea: document.getElementById("history-area"),
  historyList: document.getElementById("history-list"),
  btnClearHistory: document.getElementById("btn-clear-history"),
};

const ctx = el.canvas.getContext("2d", { willReadFrequently: true });

/* 2. STATE */
const state = {
  model: null,
  modelLoading: false,
  modelReady: false,
  stream: null,
  camMode: false,
  previewMode: false,
  predictTimer: null,
  facingMode: "environment",
  uploadedImage: null,
  box: { x: 60, y: 60, w: 160, h: 120 },
  drag: null,
  history: [],
  lastHistoryName: null,
  frozen: false, // <--- BARU: flag untuk freeze frame
};

/* 3. UTIL: TOAST & STATUS */
let toastTimer = null;
function showToast(message, type = "info") {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  el.toast.dataset.type = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), CONFIG.TOAST_DURATION_MS);
}

function setStatus(text, mode = "idle") {
  el.statusText.textContent = text;
  el.statusDot.classList.remove("active", "error", "loading");
  if (mode === "active") el.statusDot.classList.add("active");
  if (mode === "error") el.statusDot.classList.add("error");
  if (mode === "loading") el.statusDot.classList.add("loading");
}

/* 4. MODEL LOADING */
async function loadModel() {
  if (state.modelReady || state.modelLoading) return state.model;

  if (!window.tf || !window.tmImage) {
    setStatus("Gagal memuat library TensorFlow/Teachable Machine", "error");
    showToast("Library model gagal dimuat. Cek koneksi internet kamu.", "error");
    return null;
  }

  if (CONFIG.MODEL_URL.includes("REPLACE_ME")) {
    setStatus("Model belum dikonfigurasi", "error");
    showToast("MODEL_URL belum diisi di script.js — lihat komentar di bagian atas file.", "error");
    return null;
  }

  state.modelLoading = true;
  setStatus("Memuat model AI…", "loading");
  el.modelLoadingOverlay.style.display = "flex";

  try {
    const modelURL = CONFIG.MODEL_URL + "model.json";
    const metadataURL = CONFIG.MODEL_URL + "metadata.json";
    state.model = await window.tmImage.load(modelURL, metadataURL);
    state.modelReady = true;
    setStatus("Model siap digunakan", "idle");
    return state.model;
  } catch (err) {
    console.error("Gagal load model:", err);
    setStatus("Gagal memuat model", "error");
    showToast("Model tidak bisa dimuat. Cek MODEL_URL atau koneksi internet.", "error");
    return null;
  } finally {
    state.modelLoading = false;
    el.modelLoadingOverlay.style.display = "none";
  }
}

/* 5. KAMERA */
function isSecureContextOk() {
  return window.isSecureContext || location.hostname === "localhost";
}

function isGetUserMediaSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function startCamera() {
  if (!isSecureContextOk()) {
    showToast("Kamera butuh koneksi HTTPS. Akses lewat HTTPS atau localhost.", "error");
    setStatus("Koneksi tidak aman (HTTP)", "error");
    return;
  }
  if (!isGetUserMediaSupported()) {
    showToast("Browser kamu tidak mendukung akses kamera.", "error");
    setStatus("Kamera tidak didukung browser ini", "error");
    return;
  }

  setBtnBusy(true, "Mengaktifkan…");

  const model = await loadModel();
  if (!model) {
    setBtnBusy(false);
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode },
      audio: false,
    });
    el.video.srcObject = state.stream;
    await el.video.play();

    // Reset frozen state
    state.frozen = false;
    el.btnCapture.textContent = "📸";
    el.btnCapture.title = "Ambil foto";

    exitPreviewMode();
    el.camWrap.classList.add("active-cam");
    state.camMode = true;

    resizeCanvasToVideo();
    placeDefaultFocusBox();

    setStatus("Kamera aktif — arahkan ke objek", "active");
    setBtnState("camera-on");
    startPredictLoop();
  } catch (err) {
    console.error("Gagal akses kamera:", err);
    if (err.name === "NotAllowedError") {
      showToast("Izin kamera ditolak. Aktifkan izin kamera di setting browser.", "error");
      setStatus("Izin kamera ditolak", "error");
    } else if (err.name === "NotFoundError") {
      showToast("Tidak ada kamera yang terdeteksi di perangkat ini.", "error");
      setStatus("Kamera tidak ditemukan", "error");
    } else {
      showToast("Gagal mengaktifkan kamera. Coba lagi.", "error");
      setStatus("Gagal mengaktifkan kamera", "error");
    }
  } finally {
    setBtnBusy(false);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  stopPredictLoop();
  el.camWrap.classList.remove("active-cam");
  state.camMode = false;

  // Reset frozen
  state.frozen = false;
  el.btnCapture.textContent = "📸";
  el.btnCapture.title = "Ambil foto";

  setStatus("Kamera dimatikan", "idle");
  setBtnState("camera-off");
  el.resultArea.style.display = "none";
  el.focusLabel.style.display = "none";
  el.focusBox.style.borderColor = "";
  state.lastHistoryName = null;
}

async function switchFacingMode() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  if (state.camMode) {
    stopCamera();
    await startCamera();
    showToast(state.facingMode === "user" ? "Kamera depan aktif" : "Kamera belakang aktif");
  }
}

function resizeCanvasToVideo() {
  const rect = el.camWrap.getBoundingClientRect();
  el.canvas.width = rect.width;
  el.canvas.height = rect.height;
}

/* 6. MODE PREVIEW (UPLOAD FOTO) */
function handleFileUpload(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("File yang dipilih bukan gambar.", "error");
    return;
  }
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > CONFIG.MAX_FILE_SIZE_MB) {
    showToast(`Ukuran file maksimal ${CONFIG.MAX_FILE_SIZE_MB}MB.`, "error");
    return;
  }

  if (window.createImageBitmap) {
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then(async (bitmap) => {
        state.uploadedImage = bitmap;
        stopCamera();
        const model = await loadModel();
        if (!model) return;
        enterPreviewMode();
      })
      .catch(() => loadImageLegacyWay(file));
  } else {
    loadImageLegacyWay(file);
  }
}

function loadImageLegacyWay(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      state.uploadedImage = img;
      stopCamera();
      const model = await loadModel();
      if (!model) return;
      enterPreviewMode();
    };
    img.onerror = () => showToast("Gagal membuka file gambar. Coba file lain.", "error");
    img.src = e.target.result;
  };
  reader.onerror = () => showToast("Gagal membaca file.", "error");
  reader.readAsDataURL(file);
}

function enterPreviewMode() {
  el.camWrap.classList.add("preview-mode");
  state.previewMode = true;
  resizeCanvasToVideo();
  drawUploadedImage();
  placeDefaultFocusBox();
  setStatus("Foto dimuat — geser kotak ke area warna", "active");
  setBtnState("preview");
  el.btnRemove.style.display = "flex";
  startPredictLoop();
}

function exitPreviewMode() {
  el.camWrap.classList.remove("preview-mode");
  state.previewMode = false;
  state.uploadedImage = null;
  el.btnRemove.style.display = "none";
  el.focusLabel.style.display = "none";
  el.focusBox.style.borderColor = "";
  state.lastHistoryName = null;
}

function drawUploadedImage() {
  if (!state.uploadedImage) return;
  const img = state.uploadedImage;
  const cw = el.canvas.width;
  const ch = el.canvas.height;
  const imgRatio = img.width / img.height;
  const canvasRatio = cw / ch;
  let drawW, drawH, dx, dy;
  if (imgRatio > canvasRatio) {
    drawH = ch;
    drawW = ch * imgRatio;
    dx = (cw - drawW) / 2;
    dy = 0;
  } else {
    drawW = cw;
    drawH = cw / imgRatio;
    dx = 0;
    dy = (ch - drawH) / 2;
  }
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

/* 7. FOCUS BOX — DRAG & RESIZE */
function placeDefaultFocusBox() {
  const rect = el.camWrap.getBoundingClientRect();
  const w = Math.min(160, rect.width * 0.4);
  const h = Math.min(120, rect.height * 0.4);
  state.box = {
    x: (rect.width - w) / 2,
    y: (rect.height - h) / 2,
    w,
    h,
  };
  renderFocusBox();
}

function renderFocusBox() {
  const { x, y, w, h } = state.box;
  el.focusBox.style.left = `${x}px`;
  el.focusBox.style.top = `${y}px`;
  el.focusBox.style.width = `${w}px`;
  el.focusBox.style.height = `${h}px`;
}

function clampBox(box, bounds) {
  let { x, y, w, h } = box;
  w = Math.max(CONFIG.MIN_FOCUS_BOX_SIZE, w);
  h = Math.max(CONFIG.MIN_FOCUS_BOX_SIZE, h);
  x = Math.max(0, Math.min(x, bounds.width - w));
  y = Math.max(0, Math.min(y, bounds.height - h));
  w = Math.min(w, bounds.width - x);
  h = Math.min(h, bounds.height - y);
  return { x, y, w, h };
}

function getPointerPos(evt) {
  const point = evt.touches ? evt.touches[0] : evt;
  return { x: point.clientX, y: point.clientY };
}

function onDragStart(evt, mode, dir) {
  if (!state.camMode && !state.previewMode) return;
  evt.preventDefault();
  const pos = getPointerPos(evt);
  state.drag = {
    mode,
    dir,
    startX: pos.x,
    startY: pos.y,
    startBox: { ...state.box },
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("touchmove", onDragMove, { passive: false });
  window.addEventListener("mouseup", onDragEnd);
  window.addEventListener("touchend", onDragEnd);
}

function onDragMove(evt) {
  if (!state.drag) return;
  evt.preventDefault();
  const pos = getPointerPos(evt);
  const dx = pos.x - state.drag.startX;
  const dy = pos.y - state.drag.startY;
  const bounds = el.camWrap.getBoundingClientRect();
  let box = { ...state.drag.startBox };

  if (state.drag.mode === "move") {
    box.x += dx;
    box.y += dy;
  } else {
    const dir = state.drag.dir;
    if (dir.includes("e")) box.w += dx;
    if (dir.includes("s")) box.h += dy;
    if (dir.includes("w")) { box.x += dx; box.w -= dx; }
    if (dir.includes("n")) { box.y += dy; box.h -= dy; }
  }

  state.box = clampBox(box, bounds);
  renderFocusBox();
}

function onDragEnd() {
  state.drag = null;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("touchmove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  window.removeEventListener("touchend", onDragEnd);
}

function setupFocusBoxHandlers() {
  el.focusBox.addEventListener("mousedown", (e) => {
    if (e.target === el.focusBox) onDragStart(e, "move");
  });
  el.focusBox.addEventListener("touchstart", (e) => {
    if (e.target === el.focusBox) onDragStart(e, "move");
  }, { passive: false });

  document.querySelectorAll(".fb-handle").forEach((handle) => {
    const dir = handle.dataset.dir;
    handle.addEventListener("mousedown", (e) => onDragStart(e, "resize", dir));
    handle.addEventListener("touchstart", (e) => onDragStart(e, "resize", dir), { passive: false });
  });
}

window.addEventListener("resize", () => {
  if (state.camMode || state.previewMode) {
    resizeCanvasToVideo();
    if (state.previewMode) drawUploadedImage();
  }
});

/* 8. PREDIKSI WARNA */
function startPredictLoop() {
  stopPredictLoop();
  state.predictTimer = setInterval(runPrediction, CONFIG.PREDICT_INTERVAL_MS);
}

function stopPredictLoop() {
  if (state.predictTimer) {
    clearInterval(state.predictTimer);
    state.predictTimer = null;
  }
}

async function runPrediction() {
  if (!state.modelReady || !state.model) return;
  if (!state.camMode && !state.previewMode) return;

  // Gambar frame ke canvas: jika kamera hidup dan tidak frozen, ambil dari video.
  // Jika frozen, biarkan canvas tetap (tidak digambar ulang).
  if (state.camMode && !state.frozen) {
    ctx.drawImage(el.video, 0, 0, el.canvas.width, el.canvas.height);
  } else if (state.previewMode) {
    drawUploadedImage();
  }
  // Jika frozen, canvas tetap berisi frame beku, jangan digambar ulang.

  const { x, y, w, h } = state.box;
  let cropCanvas;
  try {
    cropCanvas = document.createElement("canvas");
    cropCanvas.width = w;
    cropCanvas.height = h;
    cropCanvas.getContext("2d").drawImage(el.canvas, x, y, w, h, 0, 0, w, h);
  } catch (err) {
    console.error("Gagal crop area fokus:", err);
    return;
  }

  try {
    const predictions = await state.model.predict(cropCanvas);
    predictions.sort((a, b) => b.probability - a.probability);
    showPrediction(predictions[0]);
  } catch (err) {
    console.error("Gagal melakukan prediksi:", err);
  }
}

function showPrediction(top) {
  if (!top) return;
  const name = top.className;
  const confidence = top.probability;
  const info = colorData[name] || DEFAULT_COLOR_INFO;
  const pct = Math.round(confidence * 100);

  el.resultArea.style.display = "block";
  el.resultArea.setAttribute("aria-live", "polite");
  el.resultName.textContent = `${info.icon} ${name}`;
  el.resultName.style.color = info.hex;
  el.colorSwatch.style.background = info.hex;
  el.colorSwatch.style.boxShadow = `0 0 16px ${info.hex}33`;
  el.confBadge.textContent = `${pct}%`;
  el.confFill.style.transform = `scaleX(${confidence})`;

  if (confidence < CONFIG.LOW_CONFIDENCE_THRESHOLD) {
    el.resultSub.innerHTML = `Keyakinan rendah — coba dekatkan kotak fokus ke warna objek.<br>${info.tips}`;
    el.confBadge.style.color = "var(--accent2)";
  } else {
    el.resultSub.innerHTML = `Penglihatan mata normal: <strong>${name}</strong>.<br>${info.tips}`;
    el.confBadge.style.color = "var(--green-ok)";
  }

  el.focusBox.style.borderColor = info.hex;
  document.querySelectorAll(".fb-handle").forEach((h) => (h.style.borderColor = info.hex));
  el.focusLabel.style.display = "block";
  el.focusLabel.style.background = info.hex + "ee";
  el.focusLabel.textContent = `${info.icon} ${name}  ${pct}%`;

  addToHistory(name, info, confidence);
}

/* RIWAYAT DETEKSI */
function addToHistory(name, info, confidence) {
  if (state.lastHistoryName === name) return;
  state.lastHistoryName = name;

  state.history.unshift({
    name,
    hex: info.hex,
    icon: info.icon,
    confidence,
    time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
  });
  state.history = state.history.slice(0, CONFIG.MAX_HISTORY);
  renderHistory();
}

function renderHistory() {
  if (state.history.length === 0) {
    el.historyArea.style.display = "none";
    return;
  }
  el.historyArea.style.display = "block";
  el.historyList.innerHTML = "";
  state.history.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "history-chip";
    chip.innerHTML = `
      <div class="history-swatch" style="background:${item.hex}"></div>
      <div class="history-label">${item.icon} ${item.name}</div>
      <div class="history-label">${item.time}</div>
    `;
    el.historyList.appendChild(chip);
  });
}

function clearHistory() {
  state.history = [];
  state.lastHistoryName = null;
  renderHistory();
  showToast("Riwayat deteksi dibersihkan.");
}

/* 9. TOMBOL & STATE UI */
let btnBusy = false;
function setBtnBusy(isBusy, label) {
  btnBusy = isBusy;
  el.btnCam.disabled = isBusy;
  el.btnCam.style.opacity = isBusy ? "0.7" : "1";
  el.btnCam.style.cursor = isBusy ? "not-allowed" : "pointer";
  if (isBusy && label) el.btnLabel.textContent = label;
}

function setBtnState(mode) {
  if (mode === "camera-on") {
    el.btnIcon.textContent = "⏹️";
    el.btnLabel.textContent = "Matikan Kamera";
    el.btnCam.classList.add("danger");
  } else if (mode === "preview") {
    el.btnIcon.textContent = "📷";
    el.btnLabel.textContent = "Kembali ke Kamera";
    el.btnCam.classList.remove("danger");
  } else {
    el.btnIcon.textContent = "📷";
    el.btnLabel.textContent = "Aktifkan Kamera";
    el.btnCam.classList.remove("danger");
  }
}

/* 10. EVENT LISTENERS UTAMA */
el.btnCam.addEventListener("click", () => {
  if (btnBusy) return;
  if (state.previewMode) {
    exitPreviewMode();
    setBtnState("camera-off");
    setStatus("Pilih mode kamera atau unggah foto lain", "idle");
    el.resultArea.style.display = "none";
    return;
  }
  if (state.camMode) {
    stopCamera();
  } else {
    startCamera();
  }
});

el.fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  handleFileUpload(file);
  e.target.value = "";
});

el.btnRemove.addEventListener("click", () => {
  stopPredictLoop();
  exitPreviewMode();
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  setBtnState("camera-off");
  setStatus("Foto dihapus — pilih mode kamera atau unggah foto lain", "idle");
  el.resultArea.style.display = "none";
  showToast("Foto berhasil dihapus.");
});

setupFocusBoxHandlers();

el.btnSwitchCam.addEventListener("click", () => {
  if (btnBusy) return;
  switchFacingMode();
});

el.btnClearHistory.addEventListener("click", clearHistory);

el.btnSaveResult.addEventListener("click", saveResultAsImage);

/* 11. CAPTURE SNAPSHOT — FREEZE / RESUME (tanpa download) */
function captureSnapshot() {
  if (btnBusy) return;
  if (!state.camMode && !state.previewMode) {
    showToast("Aktifkan kamera atau unggah foto terlebih dahulu.", "error");
    return;
  }
  if (state.previewMode) {
    showToast("Mode foto tidak perlu di-freeze.", "info");
    return;
  }

  if (!state.frozen) {
    // FREEZE: ambil frame video saat ini ke canvas
    ctx.drawImage(el.video, 0, 0, el.canvas.width, el.canvas.height);
    el.video.pause();
    state.frozen = true;
    el.btnCapture.textContent = "▶️";
    el.btnCapture.title = "Lanjutkan live";
    showToast("📸 Frame dibekukan! Geser kotak fokus untuk deteksi warna.");
  } else {
    // RESUME: lanjutkan live
    el.video.play();
    state.frozen = false;
    el.btnCapture.textContent = "📸";
    el.btnCapture.title = "Ambil foto";
    showToast("▶️ Live kembali.");
  }
}

el.btnCapture.addEventListener("click", () => {
  if (btnBusy) return;
  captureSnapshot();
});

el.themeToggle.addEventListener("click", toggleTheme);
initTheme();

// Guard: hentikan prediksi saat tab di-hide
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPredictLoop();
  } else if (state.camMode || state.previewMode) {
    startPredictLoop();
  }
});

// Bersihkan stream saat halaman ditutup
window.addEventListener("beforeunload", () => {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
});

/* 12. DARK MODE */
function initTheme() {
  const saved = localStorage.getItem(CONFIG.THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el.themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem(CONFIG.THEME_STORAGE_KEY, theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

/* 13. SIMPAN HASIL DETEKSI SEBAGAI GAMBAR (tetap menggunakan tombol 💾) */
function saveResultAsImage() {
  const name = el.resultName.textContent.trim();
  if (!name || name === "—") {
    showToast("Belum ada hasil deteksi untuk disimpan.", "error");
    return;
  }

  const out = document.createElement("canvas");
  out.width = 480;
  out.height = 220;
  const octx = out.getContext("2d");

  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, out.width, out.height);

  const hex = el.colorSwatch.style.background || "#5b8aff";
  octx.fillStyle = hex;
  if (octx.roundRect) {
    octx.beginPath();
    octx.roundRect(24, 24, 100, 100, 16);
    octx.fill();
  } else {
    octx.fillRect(24, 24, 100, 100);
  }

  octx.fillStyle = "#1a1d2e";
  octx.font = "700 26px sans-serif";
  octx.fillText(name, 144, 60);

  octx.fillStyle = "#7c85a8";
  octx.font = "400 16px sans-serif";
  wrapText(octx, el.resultSub.textContent.trim(), 144, 92, 320, 22);

  octx.fillStyle = "#4a7aff";
  octx.font = "700 20px sans-serif";
  octx.fillText(el.confBadge.textContent.trim(), 144, 180);

  octx.fillStyle = "#bcc4e0";
  octx.font = "400 13px sans-serif";
  octx.fillText("Mataku — Deteksi Warna", 24, 205);

  const link = document.createElement("a");
  link.download = `mataku-hasil-${Date.now()}.png`;
  link.href = out.toDataURL("image/png");
  link.click();
  showToast("Hasil deteksi berhasil diunduh.");
}

function wrapText(c, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + " ";
    if (c.measureText(testLine).width > maxWidth && i > 0) {
      c.fillText(line, x, curY);
      line = words[i] + " ";
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  c.fillText(line, x, curY);
}

setStatus("Model belum dimuat", "idle");