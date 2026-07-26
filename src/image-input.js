export const SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/webp";
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOT_PIXELS = 20_000_000;
export const MAX_SCREENSHOT_DIMENSION = 10_000;
export const MAX_LOCAL_SCREENSHOT_BYTES = 40 * 1024 * 1024;
export const TARGET_OPTIMIZED_BYTES = 6 * 1024 * 1024;
export const TARGET_OPTIMIZED_PIXELS = 16_000_000;
export const TARGET_OPTIMIZED_DIMENSION = 8_192;

const HEADER_READ_BYTES = 512 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const QUALITY_STEPS = [0.92, 0.86, 0.8, 0.74];
const MAX_RESIZE_PASSES = 3;

export function validateScreenshotFile(file, { maxBytes = MAX_LOCAL_SCREENSHOT_BYTES } = {}) {
  if (!file) return { ok: false, error: "请选择截图文件。", code: "MISSING" };
  if (!IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    return { ok: false, error: "请使用 PNG、JPEG 或 WebP 截图；HEIC/HEIF 请先在系统中转换或重新截图。", code: "TYPE" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
    return { ok: false, error: `请使用 ${Math.floor(maxBytes / 1024 / 1024)}MB 以内的截图。`, code: "SIZE" };
  }
  return { ok: true, error: "" };
}

export function planScreenshotOptimization({ size, width, height } = {}) {
  if (![size, width, height].every(Number.isFinite) || size <= 0 || width <= 0 || height <= 0) throw new Error("INVALID_IMAGE_DIMENSIONS");
  const pixels = width * height;
  const withinServerBounds = size <= MAX_SCREENSHOT_BYTES
    && pixels <= MAX_SCREENSHOT_PIXELS
    && Math.max(width, height) <= MAX_SCREENSHOT_DIMENSION;
  if (withinServerBounds) return { needsOptimization: false, width, height, targetBytes: TARGET_OPTIMIZED_BYTES, qualities: [] };

  const scale = Math.min(1, Math.sqrt(TARGET_OPTIMIZED_PIXELS / pixels), TARGET_OPTIMIZED_DIMENSION / Math.max(width, height));
  return {
    needsOptimization: true,
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    targetBytes: TARGET_OPTIMIZED_BYTES,
    qualities: QUALITY_STEPS,
    maxResizePasses: MAX_RESIZE_PASSES
  };
}

export async function readScreenshotDimensionsFromHeader(file, { signal } = {}) {
  throwIfAborted(signal);
  try {
    const length = Math.min(Number(file?.size) || 0, HEADER_READ_BYTES);
    if (!length || typeof file?.slice !== "function") return null;
    const bytes = new Uint8Array(await file.slice(0, length).arrayBuffer());
    throwIfAborted(signal);
    return readPngDimensions(bytes) || readJpegDimensions(bytes) || readWebpDimensions(bytes);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

export async function optimizeScreenshotFile(file, {
  createImageBitmapImpl = globalThis.createImageBitmap,
  canvasFactory = defaultCanvasFactory,
  FileImpl = globalThis.File,
  onProgress = () => {},
  signal
} = {}) {
  const validation = validateScreenshotFile(file);
  if (!validation.ok) throw imageInputError(validation.code, validation.error);
  if (signal?.aborted) {
    source?.close?.();
    throwIfAborted(signal);
  }

  const headerDimensions = await readScreenshotDimensionsFromHeader(file, { signal });
  const headerPlan = headerDimensions ? planScreenshotOptimization({ size: file.size, ...headerDimensions }) : null;
  if (headerPlan && !headerPlan.needsOptimization) {
    return { file, optimized: false, originalBytes: file.size, outputBytes: file.size, ...headerDimensions };
  }

  onProgress({ phase: "decoding" });
  const decoded = await decodeImageFile(file, { createImageBitmapImpl, resize: headerPlan?.needsOptimization ? headerPlan : null, signal });
  try {
    throwIfAborted(signal);
    const plan = headerPlan || planScreenshotOptimization({ size: file.size, width: decoded.width, height: decoded.height });
    let width = plan.width;
    let height = plan.height;
    let attempt = 0;
    for (let resizePass = 0; resizePass <= plan.maxResizePasses; resizePass += 1) {
      throwIfAborted(signal);
      const canvas = canvasFactory(width, height);
      try {
        const context = canvas?.getContext?.("2d", { alpha: false });
        if (!context?.drawImage) throw imageInputError("DECODE", "The device could not prepare this image.");
        context.fillStyle = "#ffffff";
        context.fillRect?.(0, 0, width, height);
        context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height, 0, 0, width, height);

        for (const quality of plan.qualities) {
          throwIfAborted(signal);
          attempt += 1;
          onProgress({ phase: "encoding", attempt, quality, width, height });
          const blob = await canvasToJpegBlob(canvas, quality);
          throwIfAborted(signal);
          if (blob.size <= plan.targetBytes) {
            const output = createOutputFile(blob, file, FileImpl);
            onProgress({ phase: "complete", originalBytes: file.size, outputBytes: output.size, width, height });
            return { file: output, optimized: true, originalBytes: file.size, outputBytes: output.size, width, height };
          }
        }
      } finally {
        releaseCanvas(canvas);
      }
      width = Math.max(1, Math.floor(width * 0.85));
      height = Math.max(1, Math.floor(height * 0.85));
    }
    throw imageInputError("TOO_LARGE", "The device could not make this image small enough.");
  } finally {
    decoded.close?.();
  }
}

export function clipboardScreenshotFile(clipboardData) {
  for (const item of Array.from(clipboardData?.items || [])) {
    if (item?.kind !== "file") continue;
    const file = item.getAsFile?.();
    if (file && IMAGE_TYPES.has(String(file.type || "").toLowerCase())) return file;
  }
  return null;
}

async function decodeImageFile(file, { createImageBitmapImpl, resize, signal }) {
  if (typeof createImageBitmapImpl !== "function") throw imageInputError("DECODE", "The device could not decode this image.");
  throwIfAborted(signal);
  const options = {
    imageOrientation: "from-image",
    ...(resize ? { resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: "high" } : {})
  };
  let source;
  try {
    source = await createImageBitmapImpl(file, options);
  } catch (error) {
    if (!isTypeError(error)) throw imageInputError("DECODE", "The device could not decode this image.");
    try {
      source = await createImageBitmapImpl(file);
    } catch {
      throw imageInputError("DECODE", "The device could not decode this image.");
    }
  }
  if (signal?.aborted) {
    source?.close?.();
    throwIfAborted(signal);
  }
  if (!Number.isFinite(source?.width) || !Number.isFinite(source?.height) || source.width <= 0 || source.height <= 0) {
    source?.close?.();
    throw imageInputError("DECODE", "The device could not decode this image.");
  }
  return { source, width: source.width, height: source.height, close: () => source.close?.() };
}

function readPngDimensions(bytes) {
  if (bytes.length < 24 || !matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return null;
  return dimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20));
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 1; continue; }
    const length = readUint16BE(bytes, offset + 1);
    if (!length || offset + 1 + length > bytes.length) return null;
    if (isJpegSof(marker)) return dimensions(readUint16BE(bytes, offset + 6), readUint16BE(bytes, offset + 4));
    offset += 1 + length;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 16 || !matches(bytes, [82, 73, 70, 70]) || !matches(bytes, [87, 69, 66, 80], 8)) return null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = readUint32LE(bytes, offset + 4);
    const payload = offset + 8;
    if (kind === "VP8X" && payload + 10 <= bytes.length) return dimensions(readUint24LE(bytes, payload + 4) + 1, readUint24LE(bytes, payload + 7) + 1);
    if (kind === "VP8 " && payload + 10 <= bytes.length && matches(bytes, [0x9d, 0x01, 0x2a], payload + 3)) return dimensions(readUint16LE(bytes, payload + 6) & 0x3fff, readUint16LE(bytes, payload + 8) & 0x3fff);
    if (kind === "VP8L" && payload + 5 <= bytes.length && bytes[payload] === 0x2f) {
      const value = readUint32LE(bytes, payload + 1);
      return dimensions(1 + (value & 0x3fff), 1 + ((value >> 14) & 0x3fff));
    }
    offset = payload + length + (length % 2);
  }
  return null;
}

function dimensions(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

function matches(bytes, values, offset = 0) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function readUint16BE(bytes, offset) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function readUint16LE(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readUint24LE(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }
function readUint32BE(bytes, offset) { return bytes[offset] * 2 ** 24 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; }
function readUint32LE(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 2 ** 8 + bytes[offset + 2] * 2 ** 16 + bytes[offset + 3] * 2 ** 24; }
function isJpegSof(marker) { return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker); }

function defaultCanvasFactory(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas?.toBlob !== "function") return reject(imageInputError("DECODE", "The device could not encode this image."));
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(imageInputError("DECODE", "The device could not encode this image.")), "image/jpeg", quality);
  });
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  try { canvas.width = 0; canvas.height = 0; } catch { /* Best effort on browser canvas implementations. */ }
}

function createOutputFile(blob, original, FileImpl) {
  if (typeof FileImpl !== "function") throw imageInputError("DECODE", "The device could not create this image.");
  const stem = String(original?.name || "screenshot").replace(/\.[^.]+$/, "") || "screenshot";
  return new FileImpl([blob], `${stem}-optimized.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("The image preparation was cancelled.");
  error.name = "AbortError";
  error.code = "ABORTED";
  throw error;
}

function isAbortError(error) { return error?.name === "AbortError" || error?.code === "ABORTED"; }
function isTypeError(error) { return error instanceof TypeError || error?.name === "TypeError"; }

function imageInputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
