export const RECENT_STORAGE_KEY = "tabitabi-recent";
const MAX_RECENT = 10;

export function createRecentAnalysis({ restaurant, userClues = {}, plan = {}, now = new Date().toISOString() }) {
  const live = restaurant?.sourceMode === "live";
  const placeId = live ? restaurant.placeId || null : null;
  return {
    id: placeId ? `google:${placeId}` : restaurant.id,
    placeId,
    name: live ? userClues.originalName || userClues.name || restaurant.userLabel || "已分析餐厅" : restaurant.name,
    area: live ? userClues.area || "" : restaurant.area || "",
    sourceMode: live ? "live" : "demo",
    userClues: live ? sanitizeUserClues(userClues) : {},
    planDate: cleanDate(plan.planDate),
    planTime: cleanTime(plan.planTime),
    partySize: clampParty(plan.partySize),
    analyzedAt: now,
    requiresRefresh: live,
    ...(live ? {} : { snapshot: restaurant })
  };
}

export function addRecentAnalysis(items, entry) {
  return [entry, ...normalizeRecentAnalyses(items).filter((item) => item.id !== entry.id)]
    .sort((a, b) => String(b.analyzedAt).localeCompare(String(a.analyzedAt)))
    .slice(0, MAX_RECENT);
}

export function normalizeRecentAnalyses(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item?.id && item?.analyzedAt).map((item) => ({
    id: String(item.id).slice(0, 200),
    placeId: typeof item.placeId === "string" ? item.placeId.slice(0, 160) : null,
    name: String(item.name || "已分析餐厅").slice(0, 200),
    area: String(item.area || "").slice(0, 100),
    sourceMode: item.sourceMode === "live" ? "live" : "demo",
    userClues: item.sourceMode === "live" ? sanitizeUserClues(item.userClues) : {},
    planDate: cleanDate(item.planDate),
    planTime: cleanTime(item.planTime),
    partySize: clampParty(item.partySize),
    analyzedAt: String(item.analyzedAt),
    requiresRefresh: item.sourceMode === "live" && Boolean(item.placeId),
    ...(item.sourceMode === "live" ? {} : item.snapshot ? { snapshot: item.snapshot } : {})
  })).slice(0, MAX_RECENT);
}

function sanitizeUserClues(value = {}) {
  return Object.fromEntries(["name", "branch", "area", "address", "originalName"]
    .map((key) => [key, String(value[key] || "").slice(0, key === "address" ? 260 : 200)])
    .filter(([, field]) => field));
}
function cleanDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : ""; }
function cleanTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : ""; }
function clampParty(value) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(20, Math.max(1, number)) : 2; }
