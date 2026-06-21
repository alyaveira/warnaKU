/* ==========================================================================
   MATAKU — script.js
   ==========================================================================
   ISI FILE INI SEBELUMNYA KOSONG. Semua logika di bawah dibangun dari nol:
   - load model Teachable Machine
   - aktivasi & switch kamera
   - drag & resize focus box (mouse + touch)
   - upload foto
   - loop prediksi warna pada area focus box
   - state UI (loading, error, hasil, confidence rendah)

   ⚠️ WAJIB DIISI SEBELUM DIPAKAI:
   Ganti MODEL_URL di bawah dengan URL model Teachable Machine kamu sendiri.
   Dapatkan dari https://teachablemachine.withgoogle.com/ setelah training,
   klik "Export Model" → "Upload (shareable link)" → copy link-nya.
   ========================================================================== */

const CONFIG = {
  // TODO: ganti dengan link model Teachable Machine kamu sendiri
  MODEL_URL: "https://teachablemachine.withgoogle.com/models/nhq2UTl2O/",
  PREDICT_INTERVAL_MS: 300,     // jeda antar prediksi, biar tidak membebani CPU
  LOW_CONFIDENCE_THRESHOLD: 0.6, // di bawah ini dianggap "kurang yakin"
  MIN_FOCUS_BOX_SIZE: 48,        // ukuran minimum focus box (px)
  MAX_FILE_SIZE_MB: 8,
  TOAST_DURATION_MS: 3200,
};

/* --------------------------------------------------------------------------
   1. DOM REFERENCES
   -------------------------------------------------------------------------- */
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
};

const ctx = el.canvas.getContext("2d", { willReadFrequently: true });

/* --------------------------------------------------------------------------
   2. STATE
   -------------------------------------------------------------------------- */
const state = {
  model: null,
  modelLoading: false,
  modelReady: false,
  stream: null,
  camMode: false,      // true = kamera live aktif
  previewMode: false,  // true = sedang menampilkan foto upload statis
  predictTimer: null,
  facingMode: "environment", // default kamera belakang, lebih masuk akal untuk scan objek
  uploadedImage: null,
  box: { x: 60, y: 60, w: 160, h: 120 },
  drag: null, // { mode: 'move'|'resize', dir, startX, startY, startBox }
};

/* --------------------------------------------------------------------------
   3. UTIL: TOAST & STATUS
   -------------------------------------------------------------------------- */
let toastTimer = null;
function showToast(message, type = "info") {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  el.toast.dataset.type = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), CONFIG.TOAST_DURATION_MS);
}

function setStatus(text, mode = "idle") {
  // mode: idle | loading | active | error
  el.statusText.textContent = text;
  el.statusDot.classList.remove("active", "error", "loading");
  if (mode === "active") el.statusDot.classList.add("active");
  if (mode === "error") el.statusDot.classList.add("error");
  if (mode === "loading") el.statusDot.classList.add("loading");
}

/* --------------------------------------------------------------------------
   4. MODEL LOADING
   -------------------------------------------------------------------------- */
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
  }
}

/* --------------------------------------------------------------------------
   5. KAMERA
   -------------------------------------------------------------------------- */
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
  setStatus("Kamera dimatikan", "idle");
  setBtnState("camera-off");
  el.resultArea.style.display = "none";
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

/* --------------------------------------------------------------------------
   6. MODE PREVIEW (UPLOAD FOTO)
   -------------------------------------------------------------------------- */
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
}

function drawUploadedImage() {
  if (!state.uploadedImage) return;
  const img = state.uploadedImage;
  const cw = el.canvas.width;
  const ch = el.canvas.height;
  // object-fit: cover behaviour, biar konsisten dengan tampilan video
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

/* --------------------------------------------------------------------------
   7. FOCUS BOX — DRAG & RESIZE (mouse + touch)
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   8. PREDIKSI WARNA
   -------------------------------------------------------------------------- */
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

  // Render frame video terbaru ke canvas (kalau mode kamera live)
  if (state.camMode) {
    ctx.drawImage(el.video, 0, 0, el.canvas.width, el.canvas.height);
  } else if (state.previewMode) {
    drawUploadedImage();
  }

  // Ambil hanya area di dalam focus box untuk diprediksi
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
  const confidence = top.probability;

  el.resultArea.style.display = "block";
  el.resultArea.setAttribute("aria-live", "polite");
  el.resultName.textContent = top.className;
  el.confBadge.textContent = `${Math.round(confidence * 100)}%`;
  el.confFill.style.transform = `scaleX(${confidence})`;

  if (confidence < CONFIG.LOW_CONFIDENCE_THRESHOLD) {
    el.resultSub.textContent = "Keyakinan rendah — coba arahkan kotak fokus lebih dekat ke warna objek.";
    el.confBadge.style.color = "var(--accent2)";
  } else {
    el.resultSub.textContent = "Hasil deteksi warna pada area kotak fokus.";
    el.confBadge.style.color = "var(--green-ok)";
  }
}

/* --------------------------------------------------------------------------
   9. TOMBOL & STATE UI
   -------------------------------------------------------------------------- */
let btnBusy = false;
function setBtnBusy(isBusy, label) {
  btnBusy = isBusy;
  el.btnCam.disabled = isBusy;
  el.btnCam.style.opacity = isBusy ? "0.7" : "1";
  el.btnCam.style.cursor = isBusy ? "not-allowed" : "pointer";
  if (isBusy && label) el.btnLabel.textContent = label;
}

function setBtnState(mode) {
  // mode: 'camera-off' | 'camera-on' | 'preview'
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

/* --------------------------------------------------------------------------
   10. EVENT LISTENERS UTAMA
   -------------------------------------------------------------------------- */
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
  e.target.value = ""; // reset agar file yang sama bisa dipilih ulang
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

// Guard: kalau tab di-hide (user pindah app), hentikan prediksi sementara
// biar tidak buang resource & baterai HP.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPredictLoop();
  } else if (state.camMode || state.previewMode) {
    startPredictLoop();
  }
});

// Bersihkan stream kamera saat halaman ditutup/refresh
window.addEventListener("beforeunload", () => {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
});

setStatus("Model belum dimuat", "idle");