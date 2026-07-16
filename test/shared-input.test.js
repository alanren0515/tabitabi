import test from "node:test";
import assert from "node:assert/strict";
import { parseShareTarget, urlWithoutShareTarget } from "../src/shared-input.js";

test("accepts an explicit PWA share target without auto-submitting it", () => {
  const shared = parseShareTarget("?share=1&title=Tokyo%20pasta&text=Looks%20good&url=https%3A%2F%2Fwww.tiktok.com%2Ft%2Fdemo");
  assert.equal(shared.accepted, true);
  assert.equal(shared.value, "Tokyo pasta\nLooks good\nhttps://www.tiktok.com/t/demo");
});

test("ignores ordinary query parameters and normalizes bounded shared text", () => {
  assert.deepEqual(parseShareTarget("?text=should-not-import"), { accepted: false, value: "" });
  const shared = parseShareTarget(`?share=1&text=${encodeURIComponent(`  Demo\u0000  ${"x".repeat(11_000)}`)}`);
  assert.equal(shared.accepted, true);
  assert.equal(shared.value.length, 10_000);
  assert.doesNotMatch(shared.value, /\u0000/);
});

test("does not repeat a URL already included in shared caption text", () => {
  const shared = parseShareTarget("?share=1&text=Try%20this%20https%3A%2F%2Fexample.com%2Fr&url=https%3A%2F%2Fexample.com%2Fr");
  assert.equal(shared.value, "Try this https://example.com/r");
});

test("removes share payload fields from the visible URL while preserving unrelated state", () => {
  assert.equal(
    urlWithoutShareTarget("https://example.com/?share=1&title=Demo&campaign=summer#top"),
    "/?campaign=summer#top"
  );
});
