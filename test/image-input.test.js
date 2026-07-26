import test from "node:test";
import assert from "node:assert/strict";
import {
  clipboardScreenshotFile,
  MAX_LOCAL_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_BYTES,
  optimizeScreenshotFile,
  planScreenshotOptimization,
  readScreenshotDimensionsFromHeader,
  SCREENSHOT_ACCEPT,
  validateScreenshotFile
} from "../src/image-input.js";

test("accepts only the image formats supported by the server", () => {
  assert.equal(SCREENSHOT_ACCEPT, "image/png,image/jpeg,image/webp");
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.deepEqual(validateScreenshotFile({ type, size: 1_000 }), { ok: true, error: "" });
  }
  assert.match(validateScreenshotFile({ type: "image/heic", size: 1_000 }).error, /HEIC/);
  assert.match(validateScreenshotFile({ type: "image/gif", size: 1_000 }).error, /PNG/);
});

test("accepts local source images up to 40 MB, but rejects empty and excessive files before decode", () => {
  assert.equal(validateScreenshotFile(null).ok, false);
  assert.equal(validateScreenshotFile({ type: "image/png", size: 0 }).ok, false);
  assert.equal(validateScreenshotFile({ type: "image/png", size: MAX_SCREENSHOT_BYTES + 1 }).ok, true);
  assert.equal(validateScreenshotFile({ type: "image/png", size: MAX_LOCAL_SCREENSHOT_BYTES + 1 }).ok, false);
});

test("reads PNG, JPEG, and WebP dimensions without a full image decode", async () => {
  assert.deepEqual(await readScreenshotDimensionsFromHeader(imageFile(pngHeader(1200, 2400))), { width: 1200, height: 2400 });
  assert.deepEqual(await readScreenshotDimensionsFromHeader(imageFile(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x20, 0x00, 0x30]), "image/jpeg")), { width: 48, height: 32 });
  assert.deepEqual(await readScreenshotDimensionsFromHeader(imageFile(webpVp8xHeader(2000, 3000), "image/webp")), { width: 2000, height: 3000 });
});

test("preserves files already within every server safety limit without decoding or recompression", async () => {
  let decoded = false;
  const file = imageFile(pngHeader(1200, 2400), "image/png", "safe.png");
  const result = await optimizeScreenshotFile(file, {
    createImageBitmapImpl: async () => {
      decoded = true;
      return { width: 1200, height: 2400, close() {} };
    },
    canvasFactory: () => { throw new Error("canvas must not be used"); }
  });
  assert.equal(decoded, false);
  assert.equal(result.file, file);
  assert.equal(result.optimized, false);
});

test("plans dimension-heavy screenshots below the OCR-friendly client target", () => {
  const plan = planScreenshotOptimization({ size: 1_000_000, width: 4_000, height: 12_000 });
  assert.equal(plan.needsOptimization, true);
  assert.ok(plan.width * plan.height <= 16_000_000);
  assert.ok(Math.max(plan.width, plan.height) <= 8_192);
});

test("encodes an oversized screenshot locally with bounded quality fallback", async () => {
  const file = imageFile(pngHeader(3_000, 8_000), "image/png", "iphone-full.png", MAX_SCREENSHOT_BYTES + 1);
  const progress = [];
  let encoded = 0;
  let decodeOptions;
  const result = await optimizeScreenshotFile(file, {
    createImageBitmapImpl: async (_file, options) => {
      decodeOptions = options;
      return { width: options.resizeWidth, height: options.resizeHeight, close() {} };
    },
    canvasFactory: () => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob(callback, _type, quality) {
        encoded += 1;
        callback(new Blob([Buffer.alloc(quality >= 0.9 ? 7 * 1024 * 1024 : 5 * 1024 * 1024)], { type: "image/jpeg" }));
      }
    }),
    FileImpl: class TestFile extends Blob {
      constructor(chunks, name, options) { super(chunks, options); this.name = name; }
    },
    onProgress: (value) => progress.push(value.phase)
  });
  assert.equal(result.optimized, true);
  assert.equal(result.file.type, "image/jpeg");
  assert.match(result.file.name, /iphone-full-optimized\.jpg$/);
  assert.ok(result.outputBytes <= 6 * 1024 * 1024);
  assert.equal(encoded, 2);
  assert.deepEqual(decodeOptions, { imageOrientation: "from-image", resizeWidth: 2_449, resizeHeight: 6_531, resizeQuality: "high" });
  assert.deepEqual(progress.slice(0, 2), ["decoding", "encoding"]);
  assert.equal(progress.at(-1), "complete");
});

test("fails clearly when the browser cannot decode an image", async () => {
  const file = imageFile(pngHeader(3_000, 8_000), "image/png", "failed.png", 9 * 1024 * 1024);
  await assert.rejects(
    optimizeScreenshotFile(file, { createImageBitmapImpl: async () => { throw new Error("decode failed"); } }),
    (error) => error.code === "DECODE"
  );
});

test("retries decode without options only when a browser rejects the options dictionary", async () => {
  const file = imageFile(pngHeader(3_000, 8_000), "image/png", "legacy.png", 9 * 1024 * 1024);
  let calls = 0;
  await optimizeScreenshotFile(file, {
    createImageBitmapImpl: async (_file, options) => {
      calls += 1;
      if (options) throw new TypeError("unsupported options");
      return { width: 3_000, height: 8_000, close() {} };
    },
    canvasFactory: jpegCanvas(5 * 1024 * 1024),
    FileImpl: TestFile
  });
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(optimizeScreenshotFile(file, {
    createImageBitmapImpl: async () => { calls += 1; throw new Error("corrupt image"); }
  }), (error) => error.code === "DECODE");
  assert.equal(calls, 1);
});

test("cancels an optimization and releases decoded bitmap and canvas memory", async () => {
  const file = imageFile(pngHeader(3_000, 8_000), "image/png", "cancel.png", 9 * 1024 * 1024);
  const controller = new AbortController();
  let bitmapClosed = false;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback) { setTimeout(() => callback(new Blob([Buffer.alloc(5 * 1024 * 1024)], { type: "image/jpeg" })), 0); }
  };
  await assert.rejects(optimizeScreenshotFile(file, {
    signal: controller.signal,
    createImageBitmapImpl: async (_file, options) => ({ width: options.resizeWidth, height: options.resizeHeight, close() { bitmapClosed = true; } }),
    canvasFactory: () => canvas,
    FileImpl: TestFile,
    onProgress: ({ phase }) => { if (phase === "encoding") controller.abort(); }
  }), (error) => error.name === "AbortError");
  assert.equal(bitmapClosed, true);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test("closes a bitmap when cancellation happens during decoding", async () => {
  const file = imageFile(pngHeader(3_000, 8_000), "image/png", "cancel-during-decode.png", 9 * 1024 * 1024);
  const controller = new AbortController();
  let bitmapClosed = false;
  await assert.rejects(optimizeScreenshotFile(file, {
    signal: controller.signal,
    createImageBitmapImpl: async (_file, options) => {
      controller.abort();
      return { width: options.resizeWidth, height: options.resizeHeight, close() { bitmapClosed = true; } };
    }
  }), (error) => error.name === "AbortError");
  assert.equal(bitmapClosed, true);
});

test("finds a supported pasted image without accepting unsupported clipboard files", () => {
  const png = { type: "image/png", size: 10 };
  const clipboard = { items: [
    { kind: "file", getAsFile: () => ({ type: "image/heic", size: 10 }) },
    { kind: "string", getAsFile: () => null },
    { kind: "file", getAsFile: () => png }
  ] };
  assert.equal(clipboardScreenshotFile(clipboard), png);
  assert.equal(clipboardScreenshotFile({ items: [] }), null);
});

class TestFile extends Blob {
  constructor(chunks, name, options) { super(chunks, options); this.name = name; }
}

function imageFile(header, type = "image/png", name = "image.png", size = header.length) {
  const file = new Blob([header, Buffer.alloc(Math.max(0, size - header.length))], { type });
  file.name = name;
  return file;
}

function pngHeader(width, height) {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function webpVp8xHeader(width, height) {
  const header = Buffer.alloc(30);
  header.write("RIFF", 0); header.write("WEBP", 8); header.write("VP8X", 12); header.writeUInt32LE(10, 16);
  header.writeUIntLE(width - 1, 24, 3); header.writeUIntLE(height - 1, 27, 3);
  return header;
}

function jpegCanvas(size) {
  return () => ({
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback) { callback(new Blob([Buffer.alloc(size)], { type: "image/jpeg" })); }
  });
}
