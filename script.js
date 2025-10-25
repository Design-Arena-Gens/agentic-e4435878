const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const selectButton = document.querySelector("#select-button");
const convertButton = document.querySelector("#convert-button");
const downloadButton = document.querySelector("#download-button");
const formatSelect = document.querySelector("#format-select");
const previewSection = document.querySelector("#preview");
const previewImage = document.querySelector("#preview-image");
const previewName = document.querySelector("#preview-name");
const previewSize = document.querySelector("#preview-size");
const progressHolder = document.querySelector("#progress");
const progressBar = document.querySelector("#progress-bar");
const toastContainer = document.querySelector("#toast-container");
const yearEl = document.querySelector("#year");

const SUPPORTED_FORMATS = ["jpg", "jpeg", "png", "webp", "bmp", "ico", "heic"];
const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  heic: "image/heic",
};

let currentFile = null;
let currentPreviewURL = null;
let convertedBlob = null;
let convertedFileName = "";
const conversionCounts = new Map();
let progressInterval = null;

yearEl.textContent = String(new Date().getFullYear());

selectButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    handleNewFile(file);
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  const file = event.dataTransfer.files?.[0];
  if (file) {
    handleNewFile(file);
  }
});

formatSelect.addEventListener("change", () => {
  convertedBlob = null;
  convertedFileName = "";
  downloadButton.disabled = true;
});

convertButton.addEventListener("click", async () => {
  if (!currentFile) return;
  const targetFormat = formatSelect.value;
  startProgress();
  try {
    const resultBlob = await convertImage(currentFile, targetFormat);
    const finalBlob = ensureMimeType(resultBlob, MIME_TYPES[targetFormat]);
    const fileName = computeUniqueName(targetFormat);
    convertedBlob = finalBlob;
    convertedFileName = fileName;
    endProgress(true);
    downloadButton.disabled = false;
    notify("success", "✅ Your image has been converted successfully!");
  } catch (error) {
    console.error(error);
    convertedBlob = null;
    convertedFileName = "";
    endProgress(false);
    notify("error", "❌ Invalid format or corrupt file.");
  }
});

downloadButton.addEventListener("click", () => {
  if (!convertedBlob || !convertedFileName) return;
  const link = document.createElement("a");
  const url = URL.createObjectURL(convertedBlob);
  link.href = url;
  link.download = convertedFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

function handleNewFile(file) {
  const ext = getFileExtension(file);
  if (!SUPPORTED_FORMATS.includes(ext)) {
    notify("error", "❌ Invalid format or corrupt file.");
    resetState();
    return;
  }
  currentFile = file;
  convertedBlob = null;
  convertedFileName = "";
  downloadButton.disabled = true;
  updatePreview(file);
  updateFormatSelect(ext);
  convertButton.disabled = false;
}

function updatePreview(file) {
  if (currentPreviewURL) {
    URL.revokeObjectURL(currentPreviewURL);
  }
  const url = URL.createObjectURL(file);
  previewImage.src = url;
  previewImage.onload = () => URL.revokeObjectURL(url);
  currentPreviewURL = url;
  previewName.textContent = file.name;
  previewSize.textContent = formatFileSize(file.size);
  previewSection.hidden = false;
}

function updateFormatSelect(currentExt) {
  [...formatSelect.options].forEach((option) => {
    option.disabled = normalizeFormat(option.value) === normalizeFormat(currentExt);
  });
  if (normalizeFormat(formatSelect.value) === normalizeFormat(currentExt)) {
    const newOption = [...formatSelect.options].find((opt) => !opt.disabled);
    if (newOption) {
      formatSelect.value = newOption.value;
    }
  }
}

function resetState() {
  currentFile = null;
  convertedBlob = null;
  convertedFileName = "";
  convertButton.disabled = true;
  downloadButton.disabled = true;
  previewSection.hidden = true;
}

function startProgress() {
  if (progressInterval) clearInterval(progressInterval);
  progressHolder.hidden = false;
  progressBar.style.width = "0%";
  let value = 0;
  progressInterval = setInterval(() => {
    value = Math.min(value + Math.random() * 20, 85);
    progressBar.style.width = `${value}%`;
  }, 180);
}

function endProgress(success) {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressHolder.hidden = true;
    progressBar.style.width = "0%";
  }, success ? 600 : 1000);
}

async function convertImage(file, targetFormat) {
  const sourceFormat = getFileExtension(file);
  if (normalizeFormat(sourceFormat) === normalizeFormat(targetFormat)) {
    throw new Error("Same format");
  }

  if (normalizeFormat(sourceFormat) === "heic") {
    return await convertHeicToTarget(file, targetFormat);
  }

  const canvas = await decodeToCanvas(file);

  if (targetFormat === "heic") {
    const mimeType = MIME_TYPES[targetFormat];
    const blob = await canvasToBlob(canvas, mimeType);
    if (!blob) throw new Error("HEIC conversion failed");
    return blob;
  }

  if (targetFormat === "bmp") {
    return canvasToBMP(canvas);
  }

  if (targetFormat === "ico") {
    return await canvasToICO(canvas);
  }

  const mimeType = MIME_TYPES[targetFormat] || "image/png";
  const blob = await canvasToBlob(canvas, mimeType, targetFormat === "jpg" || targetFormat === "jpeg" ? 0.92 : 1);
  if (!blob) {
    throw new Error("Conversion failed");
  }
  return blob;
}

async function decodeToCanvas(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  } catch (error) {
    return await decodeWithImageElement(file);
  }
}

async function decodeWithImageElement(file) {
  const dataUrl = await fileToDataURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function canvasToBlob(canvas, mimeType, quality = 1) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("toBlob failed"));
      }
    }, mimeType, quality);
  });
}

async function convertHeicToTarget(file, targetFormat) {
  try {
    const canvas = await decodeToCanvas(file);
    if (targetFormat === "bmp") {
      return canvasToBMP(canvas);
    }
    if (targetFormat === "ico") {
      return await canvasToICO(canvas);
    }
    const mimeType = MIME_TYPES[targetFormat] || "image/png";
    return await canvasToBlob(canvas, mimeType, targetFormat === "jpg" || targetFormat === "jpeg" ? 0.92 : 1);
  } catch (error) {
    throw new Error("HEIC conversion failed");
  }
}

function canvasToBMP(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixelData = imageData.data;
  const dataSize = width * height * 4;
  const fileSize = 54 + dataSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // BMP Header
  view.setUint8(0, 0x42); // B
  view.setUint8(1, 0x4d); // M
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 54, true);

  // DIB Header
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // top-down bitmap
  view.setUint16(26, 1, true); // color planes
  view.setUint16(28, 32, true); // bits per pixel
  view.setUint32(30, 0, true); // compression (BI_RGB)
  view.setUint32(34, dataSize, true); // image size
  view.setInt32(38, 2835, true); // horizontal resolution (72 DPI)
  view.setInt32(42, 2835, true); // vertical resolution
  view.setUint32(46, 0, true); // colors in palette
  view.setUint32(50, 0, true); // important colors

  const dataOffset = 54;
  const bytes = new Uint8Array(buffer, dataOffset);
  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    const a = pixelData[i + 3];
    const idx = i;
    bytes[idx] = b;
    bytes[idx + 1] = g;
    bytes[idx + 2] = r;
    bytes[idx + 3] = a;
  }

  return new Blob([buffer], { type: "image/bmp" });
}

async function canvasToICO(canvas) {
  const MAX_SIZE = 256;
  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = MAX_SIZE;
  iconCanvas.height = MAX_SIZE;
  const ctx = iconCanvas.getContext("2d");
  ctx.clearRect(0, 0, MAX_SIZE, MAX_SIZE);

  const scale = Math.min(MAX_SIZE / canvas.width, MAX_SIZE / canvas.height, 1);
  const targetWidth = Math.round(canvas.width * scale);
  const targetHeight = Math.round(canvas.height * scale);
  const offsetX = Math.floor((MAX_SIZE - targetWidth) / 2);
  const offsetY = Math.floor((MAX_SIZE - targetHeight) / 2);

  ctx.drawImage(canvas, offsetX, offsetY, targetWidth, targetHeight);

  const pngBlob = await canvasToBlob(iconCanvas, "image/png");
  const pngBuffer = await pngBlob.arrayBuffer();
  const pngBytes = new Uint8Array(pngBuffer);
  const icoSize = 6 + 16 + pngBytes.length;
  const buffer = new ArrayBuffer(icoSize);
  const view = new DataView(buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // Reserved
  view.setUint16(2, 1, true); // ICO type
  view.setUint16(4, 1, true); // Image count

  // ICONDIRENTRY
  view.setUint8(6, MAX_SIZE === 256 ? 0 : MAX_SIZE); // Width
  view.setUint8(7, MAX_SIZE === 256 ? 0 : MAX_SIZE); // Height
  view.setUint8(8, 0); // Color palette
  view.setUint8(9, 0); // Reserved
  view.setUint16(10, 1, true); // Planes
  view.setUint16(12, 32, true); // Bit count
  view.setUint32(14, pngBytes.length, true); // Size in bytes
  view.setUint32(18, 22, true); // Offset to image data

  new Uint8Array(buffer, 22).set(pngBytes);

  return new Blob([buffer], { type: "image/x-icon" });
}

function ensureMimeType(blob, mimeType) {
  if (blob.type === mimeType || !mimeType) {
    return blob;
  }
  return blob.slice(0, blob.size, mimeType);
}

function computeUniqueName(format) {
  const normalized = normalizeFormat(format);
  const count = (conversionCounts.get(normalized) ?? 0) + 1;
  conversionCounts.set(normalized, count);
  const extension = format === "jpeg" ? "jpeg" : normalized;
  return `converted_${count}.${extension}`;
}

function getFileExtension(file) {
  if (file.type) {
    const match = file.type.split("/")[1];
    if (match) {
      if (SUPPORTED_FORMATS.includes(match)) return match;
    }
  }
  const nameMatch = file.name.split(".").pop();
  if (!nameMatch) return "";
  const normalized = nameMatch.toLowerCase();
  if (normalized === "jpeg") return "jpg";
  return normalized;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function notify(type, message) {
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.textContent = type === "success" ? "✅" : "⚠️";
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(icon);
  toast.appendChild(text);
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

function normalizeFormat(format) {
  return format === "jpeg" ? "jpg" : format;
}
