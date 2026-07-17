export const sampleTikTokExtraction = Object.freeze({
  platform: "tiktok",
  languages: ["ja", "zh"],
  restaurant: {
    name: "ホームズパスタ",
    branch: "上野店",
    category: "パスタ",
    address: "東京都台東区上野4-8-9 OAKビル 2F",
    area: "上野",
    nearest_station: "上野駅",
    budget_min: 1000,
    budget_max: 2000,
    currency: "JPY"
  },
  creator: {
    handle: "@shiso_tokyo"
  },
  claims: [
    {
      text: "1986年に渋谷で創業したパスタ店が上野に初出店",
      kind: "post_claim",
      confidence: "medium"
    },
    {
      text: "投稿では上野店が6月9日に開店したと説明",
      kind: "post_claim",
      confidence: "medium"
    }
  ],
  engagement: {
    likes: 1005,
    comments: 17,
    saves: 744,
    shares: 178
  },
  visible_text_excerpt: [
    "【ホームズパスタ 上野店】",
    "1人予算 1000〜2000円",
    "東京都台東区上野4-8-9 OAKビル 2F"
  ],
  search_query: "ホームズパスタ 上野店 東京都台東区上野4-8-9",
  warnings: [
    "営業時間、予約方法、営業状況は画像内の公式情報では確認できません",
    "いいね・保存数は投稿への反応であり、店舗の混雑や予約の必要性を直接示しません"
  ],
  overall_confidence: "high"
});

export function isKnownSampleScreenshot(file) {
  return Boolean(file?.name?.startsWith("codex-clipboard-20a3b31e-78e1-4104-936c-35c812715e81"));
}

export function buildRestaurantQuery(extraction) {
  const restaurant = extraction?.restaurant || {};
  return [restaurant.name, restaurant.branch, restaurant.address || restaurant.area || restaurant.nearest_station]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function normalizeExtraction(value = {}) {
  const sourceRestaurants = Array.isArray(value.restaurants) ? value.restaurants : [];
  const primary = normalizeRestaurant(value.restaurant || sourceRestaurants[0] || {});
  const normalizedSources = sourceRestaurants.map(normalizeRestaurant);
  const restaurants = [...normalizedSources, ...(normalizedSources.some((restaurant) => restaurantKey(restaurant) === restaurantKey(primary)) ? [] : [primary])]
    .filter((restaurant) => restaurant.name || restaurant.address)
    .filter((restaurant, index, items) => items.findIndex((item) => restaurantKey(item) === restaurantKey(restaurant)) === index)
    .slice(0, 6);
  return {
    platform: value.platform || "unknown",
    languages: Array.isArray(value.languages) ? value.languages : [],
    restaurant: primary,
    restaurants,
    creator: { handle: value.creator?.handle || "" },
    claims: Array.isArray(value.claims) ? value.claims : [],
    engagement: {
      likes: Number.isFinite(value.engagement?.likes) ? value.engagement.likes : null,
      comments: Number.isFinite(value.engagement?.comments) ? value.engagement.comments : null,
      saves: Number.isFinite(value.engagement?.saves) ? value.engagement.saves : null,
      shares: Number.isFinite(value.engagement?.shares) ? value.engagement.shares : null
    },
    visible_text_excerpt: Array.isArray(value.visible_text_excerpt) ? value.visible_text_excerpt : [],
    search_query: value.search_query || buildRestaurantQuery({ restaurant: primary }),
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
    overall_confidence: ["high", "medium", "low"].includes(value.overall_confidence) ? value.overall_confidence : "low"
  };
}

export function mergeScreenshotSupplemental(extraction, supplemental = null) {
  const normalized = normalizeExtraction(extraction);
  if (!supplemental?.clues) return normalized;
  const clues = supplemental.clues;
  const restaurant = {
    ...normalized.restaurant,
    name: normalized.restaurant.name || clues.name || "",
    branch: normalized.restaurant.branch || clues.branch || "",
    category: normalized.restaurant.category || clues.category || "",
    address: normalized.restaurant.address || clues.address || "",
    area: normalized.restaurant.area || clues.area || "",
    nearest_station: normalized.restaurant.nearest_station || clues.nearest_station || ""
  };
  const hintedPlatform = ["tiktok", "instagram", "youtube", "x", "threads", "lemon8", "line", "facebook", "xiaohongshu"].includes(supplemental.platform) ? supplemental.platform : "";
  return {
    ...normalized,
    platform: hintedPlatform || normalized.platform,
    restaurant,
    restaurants: normalized.restaurants.map((item, index) => index === 0 ? restaurant : item),
    search_query: buildRestaurantQuery({ restaurant }),
    warnings: [
      ...normalized.warnings,
      ...((clues.area || clues.address || clues.nearest_station || hintedPlatform)
        ? ["エリア、住所、駅、プラットフォームの補足は入力された文章に基づくため、候補画面で確認してください。"]
        : [])
    ]
  };
}

export function selectExtractedRestaurant(extraction, index) {
  const normalized = normalizeExtraction(extraction);
  const restaurant = normalized.restaurants[index];
  if (!restaurant) return normalized;
  return {
    ...normalized,
    restaurant,
    search_query: buildRestaurantQuery({ restaurant })
  };
}

export function extractionReviewState(extraction, meta = {}) {
  const normalized = normalizeExtraction(extraction);
  const hasName = Boolean(normalized.restaurant.name.trim());
  const lowConfidence = normalized.overall_confidence !== "high" || Boolean(meta.requiresUserConfirmation);
  return {
    canContinue: hasName,
    requiresAcknowledgement: hasName && lowConfidence,
    message: !hasName
      ? "店舗名を確実に読み取れませんでした。画像を見て店名を補足してください。"
      : lowConfidence
        ? "店名または場所の確度が低いため、画像と見比べて確認してください。"
        : "店名と場所の確度は高めですが、候補画面で支店まで確認してください。"
  };
}

function normalizeRestaurant(restaurant = {}) {
  return {
    name: restaurant.name || "",
    branch: restaurant.branch || "",
    category: restaurant.category || "",
    address: restaurant.address || "",
    area: restaurant.area || "",
    nearest_station: restaurant.nearest_station || "",
    budget_min: Number.isFinite(restaurant.budget_min) ? restaurant.budget_min : null,
    budget_max: Number.isFinite(restaurant.budget_max) ? restaurant.budget_max : null,
    currency: restaurant.currency || "JPY"
  };
}

function restaurantKey(restaurant) {
  return [restaurant.name, restaurant.branch, restaurant.address].map((value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")).join("|");
}

export function formatBudget(restaurant) {
  if (!Number.isFinite(restaurant?.budget_min) && !Number.isFinite(restaurant?.budget_max)) return "読み取れませんでした";
  const formatter = new Intl.NumberFormat("ja-JP");
  const min = Number.isFinite(restaurant.budget_min) ? formatter.format(restaurant.budget_min) : "?";
  const max = Number.isFinite(restaurant.budget_max) ? formatter.format(restaurant.budget_max) : "?";
  return `¥${min}–${max}`;
}
