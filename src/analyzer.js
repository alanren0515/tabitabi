import { demoRestaurants } from "./data.js";

export function normalizeInput(value = "") {
  return value.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function scoreRestaurant(input, restaurant) {
  const normalized = normalizeInput(input);
  if (!normalized) return 0;
  return restaurant.matchTerms.reduce((score, term) => {
    const normalizedTerm = normalizeInput(term);
    if (!normalized.includes(normalizedTerm)) return score;
    return score + (normalizedTerm.length >= 3 ? 3 : 2);
  }, 0);
}

export function findCandidates(input, limit = 3) {
  const ranked = demoRestaurants
    .map((restaurant) => ({ restaurant, score: scoreRestaurant(input, restaurant) }))
    .sort((a, b) => b.score - a.score);
  const matches = ranked.filter((item) => item.score > 0);
  return (matches.length ? matches : ranked)
    .slice(0, limit)
    .map((item, index) => ({ ...item.restaurant, matchScore: item.score, isFallback: matches.length === 0, rank: index + 1 }));
}

export function recommendationLabel(value) {
  return {
    strongly_recommended: "予約を強く推奨",
    recommended: "予約がおすすめ",
    walk_in_ok: "直接来店を検討",
    temporarily_unavailable: "来店は一旦見送り",
    unknown: "情報を確認中"
  }[value] || "情報を確認中";
}

export function confidenceLabel(value) {
  return { high: "確度：高", medium: "確度：中", low: "確度：低" }[value] || "確度：低";
}
