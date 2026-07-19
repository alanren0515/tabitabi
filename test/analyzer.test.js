import test from "node:test";
import assert from "node:assert/strict";
import { findCandidates, normalizeInput, recommendationLabel } from "../src/analyzer.js";
import { buildRestaurantQuery, extractionReviewState, formatBudget, mergeScreenshotSupplemental, normalizeExtraction, sampleTikTokExtraction, selectExtractedRestaurant } from "../src/screenshot-extraction.js";

test("normalizes mixed-width and whitespace input", () => {
  assert.equal(normalizeInput("  ＳＯＧＥＴＳＵ   银座  "), "sogetsu 银座");
});

test("ranks the strongest restaurant match first", () => {
  const [candidate] = findCandidates("小红书看到的 银座 鮨 蒼月");
  assert.equal(candidate.id, "sogetsu-ginza");
  assert.ok(candidate.matchScore > 0);
});

test("returns explicitly marked fallback candidates for unknown input", () => {
  const candidates = findCandidates("完全未知的餐厅 XYZ");
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate) => candidate.isFallback));
});

test("maps recommendation enum to user-facing copy", () => {
  assert.equal(recommendationLabel("walk_in_ok"), "直接来店を検討");
  assert.equal(recommendationLabel("unexpected"), "情報を確認中");
});

test("matches the restaurant extracted from the supplied TikTok screenshot", () => {
  const query = buildRestaurantQuery(sampleTikTokExtraction);
  const [candidate] = findCandidates(query);
  assert.equal(candidate.id, "homes-pasta-ueno");
  assert.ok(candidate.matchScore >= 6);
});

test("keeps social engagement separate from restaurant matching facts", () => {
  const normalized = normalizeExtraction({
    restaurant: { name: "テスト店", budget_min: 1000, budget_max: 2000 },
    engagement: { likes: 1005 }
  });
  assert.equal(buildRestaurantQuery(normalized), "テスト店");
  assert.equal(normalized.engagement.likes, 1005);
  assert.equal(formatBudget(normalized.restaurant), "¥1,000–2,000");
  assert.equal(normalized.overall_confidence, "low");
});

test("keeps a screenshot station clue when address and area are missing", () => {
  const normalized = normalizeExtraction({
    restaurant: { name: "ホームズパスタ", nearest_station: "上野駅" }
  });
  assert.equal(buildRestaurantQuery(normalized), "ホームズパスタ 上野駅");
});

test("fills missing screenshot location and platform from supplemental text without overwriting visible identity", () => {
  const merged = mergeScreenshotSupplemental({
    platform: "tiktok",
    restaurant: { name: "カリー屋 ジンコック", address: "" },
    warnings: []
  }, {
    platform: "instagram",
    clues: { name: "错误店名", area: "神保町", address: "", nearest_station: "" }
  });
  assert.equal(merged.platform, "instagram");
  assert.equal(merged.restaurant.name, "カリー屋 ジンコック");
  assert.equal(merged.restaurant.area, "神保町");
  assert.equal(merged.search_query, "カリー屋 ジンコック 神保町");
  assert.match(merged.warnings.at(-1), /入力された文章/);
});

test("keeps multiple screenshot restaurants distinct and lets the user choose one", () => {
  const extraction = normalizeExtraction({
    restaurant: { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区神南1-22-7" },
    restaurants: [
      { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区神南1-22-7" },
      { name: "AFURI", branch: "原宿", address: "東京都渋谷区千駄ヶ谷3-63-1" }
    ]
  });
  assert.equal(extraction.restaurants.length, 2);
  const selected = selectExtractedRestaurant(extraction, 1);
  assert.equal(selected.restaurant.name, "AFURI");
  assert.match(selected.search_query, /AFURI.*原宿.*千駄ヶ谷/);
  assert.deepEqual(selected.restaurants.map((item) => item.name), ["一蘭", "AFURI"]);
});

test("blocks a missing restaurant name and always keeps screenshot acknowledgement visible", () => {
  const missing = extractionReviewState({ restaurant: { name: "", area: "新宿" }, overall_confidence: "low" }, { requiresUserConfirmation: true });
  assert.equal(missing.canContinue, false);
  assert.equal(missing.requiresAcknowledgement, true);
  assert.equal(missing.needsAttention, true);
  assert.match(missing.message, /店名を補足/);

  const low = extractionReviewState({ restaurant: { name: "候选店", area: "新宿" }, overall_confidence: "low" }, { requiresUserConfirmation: true });
  assert.equal(low.canContinue, true);
  assert.equal(low.requiresAcknowledgement, true);
  assert.equal(low.needsAttention, true);
  assert.match(low.message, /確認してください/);
});

test("requires screenshot acknowledgement even for a high-confidence extraction", () => {
  const high = extractionReviewState({ restaurant: { name: "400℃ PIZZA", nearest_station: "神楽坂" }, overall_confidence: "high" });
  assert.equal(high.canContinue, true);
  assert.equal(high.requiresAcknowledgement, true);
  assert.equal(high.needsAttention, false);
});
