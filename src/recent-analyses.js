import { clampPartySize, cleanPlanDate, cleanPlanTime, cleanTimestamp, limitedText, sanitizeUserClues } from "./saved-plans.js";

export const RECENT_STORAGE_KEY = "tabitabi-recent";
const MAX_RECENT = 10;

export function createRecentAnalysis({ restaurant = {}, userClues = {}, plan = {}, now = new Date().toISOString() } = {}) {
  const live = restaurant.sourceMode === "live";
  const clues = sanitizeUserClues(userClues);
  const placeId = live ? limitedText(restaurant.placeId, 160) || null : null;
  return {
    schemaVersion: 2,
    id: placeId ? `google:${placeId}` : limitedText(restaurant.id, 200),
    restaurantId: limitedText(restaurant.id, 200),
    placeId,
    name: clues.originalName || clues.name || limitedText(restaurant.userLabel, 500) || (!live ? limitedText(restaurant.name, 500) : "") || "確認した店舗",
    area: clues.area || "",
    sourceMode: live ? "live" : "demo",
    userClues: clues,
    planDate: cleanPlanDate(plan.planDate), planTime: cleanPlanTime(plan.planTime), partySize: clampPartySize(plan.partySize),
    analyzedAt: cleanTimestamp(now),
    requiresRefresh: live
  };
}

export function addRecentAnalysis(items, entry) {
  const [safeEntry] = normalizeRecentAnalyses([entry]);
  const previous = normalizeRecentAnalyses(items);
  if (!safeEntry) return previous;
  return [safeEntry, ...previous.filter((item) => item.id !== safeEntry.id)]
    .sort((a, b) => (b.analyzedAt || "").localeCompare(a.analyzedAt || ""))
    .slice(0, MAX_RECENT);
}

export function normalizeRecentAnalyses(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecentAnalysisRecord).map((item) => {
    const sourceMode = item.sourceMode === "live" ? "live" : "demo";
    return {
      schemaVersion: 2,
      id: limitedText(item.id, 200),
      restaurantId: limitedText(item.restaurantId, 200) || limitedText(item.id, 200),
      placeId: sourceMode === "live" ? limitedText(item.placeId, 160) || null : null,
      name: limitedText(item.name, 500) || "確認した店舗",
      area: limitedText(item.area, 500),
      sourceMode,
      userClues: sanitizeUserClues(item.userClues),
      planDate: cleanPlanDate(item.planDate), planTime: cleanPlanTime(item.planTime), partySize: clampPartySize(item.partySize),
      analyzedAt: cleanTimestamp(item.analyzedAt),
      requiresRefresh: sourceMode === "live"
    };
  }).slice(0, MAX_RECENT);
}

export function isRecentAnalysisRecord(item) {
  return Boolean(item && typeof item === "object" && !Array.isArray(item) && limitedText(item.id, 200));
}
