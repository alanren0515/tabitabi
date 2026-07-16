import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("declares an installable text/link share target with real PNG icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.share_target.action, "/?share=1");
  assert.equal(manifest.share_target.method, "GET");
  assert.deepEqual(manifest.share_target.params, { title: "title", text: "text", url: "url" });

  for (const [src, expectedSize] of [["../assets/icon-192.png", 192], ["../assets/icon-512.png", 512]]) {
    const image = await readFile(new URL(src, import.meta.url));
    assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(image.readUInt32BE(16), expectedSize);
    assert.equal(image.readUInt32BE(20), expectedSize);
  }
});
