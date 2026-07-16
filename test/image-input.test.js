import test from "node:test";
import assert from "node:assert/strict";
import { clipboardScreenshotFile, MAX_SCREENSHOT_BYTES, SCREENSHOT_ACCEPT, validateScreenshotFile } from "../src/image-input.js";

test("accepts only the image formats supported by the server", () => {
  assert.equal(SCREENSHOT_ACCEPT, "image/png,image/jpeg,image/webp");
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.deepEqual(validateScreenshotFile({ type, size: 1_000 }), { ok: true, error: "" });
  }
  assert.match(validateScreenshotFile({ type: "image/heic", size: 1_000 }).error, /HEIC/);
  assert.match(validateScreenshotFile({ type: "image/gif", size: 1_000 }).error, /PNG/);
});

test("rejects empty and oversized screenshots before upload", () => {
  assert.equal(validateScreenshotFile(null).ok, false);
  assert.equal(validateScreenshotFile({ type: "image/png", size: 0 }).ok, false);
  assert.equal(validateScreenshotFile({ type: "image/png", size: MAX_SCREENSHOT_BYTES + 1 }).ok, false);
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
