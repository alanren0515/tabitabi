export const SCREENSHOT_ACCEPT = "image/png,image/jpeg,image/webp";
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export function validateScreenshotFile(file, { maxBytes = MAX_SCREENSHOT_BYTES } = {}) {
  if (!file) return { ok: false, error: "请选择截图文件。" };
  if (!["image/png", "image/jpeg", "image/webp"].includes(String(file.type || "").toLowerCase())) {
    return { ok: false, error: "请使用 PNG、JPEG 或 WebP 截图；HEIC/HEIF 请先在系统中转换或重新截图。" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
    return { ok: false, error: `请使用 ${Math.floor(maxBytes / 1024 / 1024)}MB 以内的截图。` };
  }
  return { ok: true, error: "" };
}

export function clipboardScreenshotFile(clipboardData) {
  for (const item of Array.from(clipboardData?.items || [])) {
    if (item?.kind !== "file") continue;
    const file = item.getAsFile?.();
    if (file && ["image/png", "image/jpeg", "image/webp"].includes(String(file.type || "").toLowerCase())) return file;
  }
  return null;
}
