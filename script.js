// const MODEL_URL = "https://teachablemachine.withgoogle.com/models/nhq2UTl2O/";
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/nhq2UTl2O/";

const colorData = {
  "Merah":      { hex: "#e63946", icon: "🔴", tips: "Mungkin tampak coklat gelap pada buta warna merah-hijau." },
  "Orange":     { hex: "#fb5607", icon: "🟠", tips: "Bisa tampak mirip coklat atau kekuningan." },
  "Kuning":     { hex: "#ffbe0b", icon: "🟡", tips: "Bisa tampak lebih pucat pada beberapa tipe buta warna." },
  "Hijau":  { hex: "#2d6a4f", icon: "🟢", tips: "Warna yang sering membingungkan penderita deuteranopia." },
  "Biru":  { hex: "#74b9ff", icon: "🔵", tips: "Terdeteksi normal oleh penderita buta warna merah-hijau." },
  "Ungu":       { hex: "#8338ec", icon: "🟣", tips: "Masih bisa dibedakan oleh buta warna merah-hijau." },
};

let model      = null;
let isRunning  = false;
let isPredicting = false;
let uploadedImg  = null;

let box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
const MIN_BOX = 0.08;
let drag = null;

const video       = document.getElementById("video");
const canvas      = document.getElementById("canvas-output");
const camWrap     = document.getElementById("cam-wrap");
const focusBoxEl  = document.getElementById("focus-box");
const fbLabel     = document.getElementById("fb-label");
const focusHint   = document.getElementById("focus-hint");
const statusDot   = document.getElementById("status-dot");
const statusText  = document.getElementById("status-text");
const resultArea  = document.getElementById("result-area");
const resultName  = document.getElementById("result-name");
const resultSub   = document.getElementById("result-sub");
const colorSwatch = document.getElementById("color-swatch");
const confFill    = document.getElementById("conf-fill");
const confBadge   = document.getElementById("conf-badge");
const btnCam      = document.getElementById("btn-cam");
const btnIcon     = document.getElementById("btn-icon");
const btnLabel    = document.getElementById("btn-label");
const fileInput   = document.getElementById("file-input");
const btnClear    = document.getElementById("btn-clear");
const toast       = document.getElementById("toast");

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

async function loadModel() {
  if (model) return;
  try {
    statusText.textContent = "Memuat model AI...";
    model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
    statusDot.classList.add("active");
    statusText.textContent = "Model siap ✓";
    showToast("✅ Model AI berhasil dimuat!");
  } catch (e) {
    statusText.textContent = "⚠️ Demo mode";
    model = null;
  }
}

function renderFocusBox(hex) {
  focusBoxEl.style.left   = (box.x * 100) + "%";
  focusBoxEl.style.top    = (box.y * 100) + "%";
  focusBoxEl.style.width  = (box.w * 100) + "%";
  focusBoxEl.style.height = (box.h * 100) + "%";
  if (hex) {
    focusBoxEl.style.borderColor = hex;
    document.querySelectorAll(".fb-handle").forEach(h => h.style.borderColor = hex);
  }
}

function drawImageToCanvas(img) {
  const wrapW = camWrap.clientWidth;
  const wrapH = camWrap.clientHeight;
  canvas.width  = wrapW;
  canvas.height = wrapH;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, wrapW, wrapH);
  // object-fit: cover — gambar memenuhi seluruh area
  const imgRatio  = img.width / img.height;
  const wrapRatio = wrapW / wrapH;
  let drawW, drawH, drawX, drawY;
  if (imgRatio > wrapRatio) {
    drawH = wrapH; drawW = wrapH * imgRatio;
    drawX = (wrapW - drawW) / 2; drawY = 0;
  } else {
    drawW = wrapW; drawH = wrapW / imgRatio;
    drawX = 0; drawY = (wrapH - drawH) / 2;
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  // Simpan offset untuk cropFocus yang akurat
  canvas._drawX = drawX; canvas._drawY = drawY;
  canvas._drawW = drawW; canvas._drawH = drawH;
}

function cropFocus(src) {
  const isVideo = src instanceof HTMLVideoElement;
  if (isVideo) {
    const sw = src.videoWidth;
    const sh = src.videoHeight;
    const cx = Math.round(box.x * sw);
    const cy = Math.round(box.y * sh);
    const cw = Math.max(1, Math.round(box.w * sw));
    const ch = Math.max(1, Math.round(box.h * sh));
    const off = document.createElement("canvas");
    off.width = cw; off.height = ch;
    off.getContext("2d").drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
    return off;
  }
  // Untuk gambar: crop berdasarkan area yang terlihat di canvas (cover)
  const dX = canvas._drawX || 0;
  const dY = canvas._drawY || 0;
  const dW = canvas._drawW || canvas.width;
  const dH = canvas._drawH || canvas.height;
  // Konversi box (relatif wrap) ke koordinat dalam gambar asli
  const scaleX = src.naturalWidth  / dW;
  const scaleY = src.naturalHeight / dH;
  const px = (box.x * canvas.width  - dX) * scaleX;
  const py = (box.y * canvas.height - dY) * scaleY;
  const pw = box.w * canvas.width  * scaleX;
  const ph = box.h * canvas.height * scaleY;
  const cx = Math.max(0, Math.round(px));
  const cy = Math.max(0, Math.round(py));
  const cw = Math.max(1, Math.min(Math.round(pw), src.naturalWidth  - cx));
  const ch = Math.max(1, Math.min(Math.round(ph), src.naturalHeight - cy));
  const off = document.createElement("canvas");
  off.width = cw; off.height = ch;
  off.getContext("2d").drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
  return off;
}

async function predict(src) {
  if (isPredicting) return;
  isPredicting = true;
  try {
    const cropped = cropFocus(src);
    let name, confidence;
    if (!model) {
      const keys = Object.keys(colorData);
      name = keys[Math.floor(Math.random() * keys.length)];
      confidence = 0.65 + Math.random() * 0.3;
    } else {
      const preds = await model.predict(cropped);
      const top   = preds.reduce((a, b) => a.probability > b.probability ? a : b);
      name = top.className; confidence = top.probability;
    }
    const info = colorData[name] || { hex: "#5b8aff", icon: "🎨", tips: "" };
    renderFocusBox(info.hex);
    fbLabel.style.display    = "block";
    fbLabel.style.background = info.hex + "ee";
    fbLabel.textContent      = `${info.icon} ${name}  ${Math.round(confidence * 100)}%`;
    updateResult(name, confidence, info);
  } finally {
    isPredicting = false;
  }
}

function updateResult(name, confidence, info) {
  const pct = Math.round(confidence * 100);
  resultArea.style.display     = "block";
  resultName.textContent       = `${info.icon} ${name}`;
  resultName.style.color       = info.hex;
  resultSub.innerHTML          = `Penglihatan di mata normal adalah <strong>${name}</strong>.<br>${info.tips}`;
  colorSwatch.style.background = info.hex;
  colorSwatch.style.boxShadow  = `0 0 16px ${info.hex}33`;
  confFill.style.width         = pct + "%";
  confBadge.textContent        = pct + "%";
}

function getPct(e) {
  const rect = camWrap.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left)  / rect.width,
    y: (src.clientY - rect.top)   / rect.height,
  };
}

focusBoxEl.addEventListener("mousedown", (e) => {
  if (e.target.classList.contains("fb-handle")) return;
  e.preventDefault();
  const p = getPct(e);
  drag = { type: "move", sx: p.x, sy: p.y, ox: box.x, oy: box.y };
});
focusBoxEl.addEventListener("touchstart", (e) => {
  if (e.target.classList.contains("fb-handle")) return;
  e.preventDefault();
  const p = getPct(e);
  drag = { type: "move", sx: p.x, sy: p.y, ox: box.x, oy: box.y };
}, { passive: false });

document.querySelectorAll(".fb-handle").forEach(handle => {
  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = handle.dataset.dir;
    const p = getPct(e);
    drag = {
      type: "resize", dir,
      sx: p.x, sy: p.y,
      ox: box.x, oy: box.y, ow: box.w, oh: box.h
    };
  };
  handle.addEventListener("mousedown", startResize);
  handle.addEventListener("touchstart", startResize, { passive: false });
});

function onMove(e) {
  if (!drag) return;
  e.preventDefault();
  const p  = getPct(e);
  const dx = p.x - drag.sx;
  const dy = p.y - drag.sy;
  if (drag.type === "move") {
    box.x = Math.max(0, Math.min(1 - box.w, drag.ox + dx));
    box.y = Math.max(0, Math.min(1 - box.h, drag.oy + dy));
  } else {
    const dir = drag.dir;
    let nx = drag.ox, ny = drag.oy, nw = drag.ow, nh = drag.oh;

    // Horizontal
    if (dir === "e" || dir === "ne" || dir === "se") {
      nw = Math.max(MIN_BOX, Math.min(1 - drag.ox, drag.ow + dx));
    }
    if (dir === "w" || dir === "nw" || dir === "sw") {
      const newW = Math.max(MIN_BOX, Math.min(drag.ow + drag.ox, drag.ow - dx));
      nx = drag.ox + (drag.ow - newW);
      nw = newW;
    }
    // Vertical
    if (dir === "s" || dir === "se" || dir === "sw") {
      nh = Math.max(MIN_BOX, Math.min(1 - drag.oy, drag.oh + dy));
    }
    if (dir === "n" || dir === "nw" || dir === "ne") {
      const newH = Math.max(MIN_BOX, Math.min(drag.oh + drag.oy, drag.oh - dy));
      ny = drag.oy + (drag.oh - newH);
      nh = newH;
    }

    box.x = nx; box.y = ny; box.w = nw; box.h = nh;
  }
  renderFocusBox();
}

function onUp() {
  if (drag && uploadedImg) predict(uploadedImg);
  drag = null;
}

document.addEventListener("mousemove",  onMove);
document.addEventListener("mouseup",    onUp);
document.addEventListener("touchmove",  onMove, { passive: false });
document.addEventListener("touchend",   onUp);

btnCam.addEventListener("click", () => isRunning ? capturePhoto() : startCamera());

async function startCamera() {
  await loadModel();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      uploadedImg = null;
      isRunning   = true;
      camWrap.classList.remove("preview-mode");
      camWrap.classList.add("active-cam");
      btnCam.classList.add("danger");
      btnIcon.textContent        = "📸";
      btnLabel.textContent       = "Ambil Foto";
      statusDot.classList.add("active");
      statusText.textContent     = "Kamera aktif — arahkan kotak ke objek lalu tekan Ambil Foto";
      focusHint.style.display    = "block";
      renderFocusBox();
    };
  } catch (e) {
    showToast("❌ Gagal mengakses kamera. Cek izin browser.");
  }
}

function stopCamera() {
  isRunning = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  camWrap.classList.remove("active-cam");
  btnCam.classList.remove("danger");
  btnIcon.textContent     = "📷";
  btnLabel.textContent    = "Aktifkan Kamera";
  statusDot.classList.remove("active");
  statusText.textContent  = "Kamera dimatikan";
  fbLabel.style.display   = "none";
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) return;
  const off = document.createElement("canvas");
  off.width  = video.videoWidth;
  off.height = video.videoHeight;
  off.getContext("2d").drawImage(video, 0, 0, off.width, off.height);

  const img = new Image();
  img.onload = () => {
    stopCamera();
    uploadedImg = img;
    camWrap.classList.add("preview-mode");
    focusHint.style.display = "block";
    btnClear.style.display  = "flex";
    drawImageToCanvas(img);
    renderFocusBox();
    predict(img);
    showToast("📸 Foto diambil & dianalisis!");
  };
  img.src = off.toDataURL("image/png");
}

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadModel();
  const img = new Image();
  img.onload = () => {
    if (isRunning) stopCamera();
    uploadedImg = img;
    camWrap.classList.add("preview-mode");
    focusHint.style.display = "block";
    btnClear.style.display  = "flex";
    drawImageToCanvas(img);
    renderFocusBox();
    predict(img);
    showToast("🖼️ Gambar dianalisis!");
  };
  img.src = URL.createObjectURL(file);
  fileInput.value = "";
});

function clearImage() {
  uploadedImg = null;
  camWrap.classList.remove("preview-mode");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resultArea.style.display  = "none";
  focusHint.style.display   = "none";
  fbLabel.style.display     = "none";
  btnClear.style.display    = "none";
  statusText.textContent    = "Gambar dihapus — siap untuk deteksi baru";
  renderFocusBox();
  showToast("🗑️ Gambar dihapus!");
}

btnClear.addEventListener("click", clearImage);

window.addEventListener("load", loadModel);