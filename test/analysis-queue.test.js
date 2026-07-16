import test from "node:test";
import assert from "node:assert/strict";
import { addPendingRestaurants, normalizePendingAnalyses, parseBatchRestaurantLines, pendingAnalysisToTextExtraction, removePendingAnalysis, restaurantClueKey } from "../src/analysis-queue.js";

test("queues the other screenshot restaurants without persisting screenshot or engagement data", () => {
  const queued = addPendingRestaurants([], [
    { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区", screenshot: "must not persist" },
    { name: "AFURI", branch: "原宿", area: "原宿", likes: 1000 }
  ], { excludeRestaurant: { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区" }, sourcePlatform: "tiktok", now: "2026-07-13T00:00:00.000Z" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].clues.name, "AFURI");
  assert.equal(queued[0].sourcePlatform, "tiktok");
  assert.equal("screenshot" in queued[0].clues, false);
  assert.equal("likes" in queued[0].clues, false);
});

test("preserves a station-only restaurant clue through the pending queue", () => {
  const queued = addPendingRestaurants([], [{ name: "ホームズパスタ", nearest_station: "上野駅" }], { sourcePlatform: "instagram" });
  assert.equal(queued[0].clues.nearest_station, "上野駅");
  const extraction = pendingAnalysisToTextExtraction(queued[0]);
  assert.match(extraction.searchQuery, /上野駅/);
  assert.match(restaurantClueKey(queued[0].clues), /上野駅/);
});

test("deduplicates pending restaurants and converts one into editable text clues", () => {
  const first = addPendingRestaurants([], [{ name: "AFURI", branch: "原宿", area: "原宿" }], { now: "2026-07-13T00:00:00.000Z" });
  const again = addPendingRestaurants(first, [{ name: "ＡＦＵＲＩ", branch: "原宿", area: "原宿" }], { now: "2026-07-14T00:00:00.000Z" });
  assert.equal(again.length, 1);
  const extraction = pendingAnalysisToTextExtraction(again[0], 4);
  assert.equal(extraction.clues.name, "ＡＦＵＲＩ");
  assert.equal(extraction.plan.partySize, 4);
  assert.equal(extraction.kind, "pending_analysis");
});

test("normalizes, bounds, and removes local pending analyses", () => {
  const normalized = normalizePendingAnalyses([
    { id: "one", clues: { name: "店A", address: "a" }, sourcePlatform: "invalid", addedAt: "invalid" },
    { id: "duplicate", clues: { name: "店A", address: "a" } },
    { id: "missing", clues: { area: "東京" } }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].sourcePlatform, "unknown");
  assert.deepEqual(removePendingAnalysis(normalized, "one"), []);
});

test("parses a privacy-safe batch list without starting restaurant searches", () => {
  const parsed = parseBatchRestaurantLines(`一蘭 渋谷店\nAFURI｜原宿｜東京都渋谷区千駄ヶ谷3-63-1\nすし大\t本館\t築地`);
  assert.equal(parsed.totalLineCount, 3);
  assert.deepEqual(parsed.restaurants, [
    { name: "一蘭 渋谷店" },
    { name: "AFURI", branch: "原宿", address: "東京都渋谷区千駄ヶ谷3-63-1" },
    { name: "すし大", branch: "本館", address: "築地" }
  ]);
  assert.equal(parsed.truncated, false);
});

test("caps batch input at thirty non-empty lines", () => {
  const parsed = parseBatchRestaurantLines(Array.from({ length: 35 }, (_, index) => `店${index}`).join("\n"));
  assert.equal(parsed.restaurants.length, 30);
  assert.equal(parsed.truncated, true);
});
