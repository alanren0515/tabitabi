export const PENDING_STORAGE_KEY = "tabitabi-pending";
const MAX_PENDING = 30;

export function addPendingRestaurants(items, restaurants, { excludeRestaurant = null, sourcePlatform = "unknown", now = new Date().toISOString() } = {}) {
  const existing = normalizePendingAnalyses(items);
  const excludedKey = restaurantClueKey(excludeRestaurant);
  const additions = (Array.isArray(restaurants) ? restaurants : [])
    .map((restaurant) => createPendingAnalysis(restaurant, { sourcePlatform, now }))
    .filter(Boolean)
    .filter((item) => restaurantClueKey(item.clues) !== excludedKey);
  const merged = [...existing];
  for (const addition of additions) {
    const index = merged.findIndex((item) => restaurantClueKey(item.clues) === restaurantClueKey(addition.clues));
    if (index >= 0) merged[index] = { ...merged[index], ...addition, id: merged[index].id, addedAt: merged[index].addedAt };
    else merged.push(addition);
  }
  return merged.slice(0, MAX_PENDING);
}

export function normalizePendingAnalyses(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const item of value) {
    const clues = sanitizeClues(item?.clues || item);
    if (!clues.name) continue;
    const key = restaurantClueKey(clues);
    if (normalized.some((entry) => restaurantClueKey(entry.clues) === key)) continue;
    normalized.push({
      id: limitedString(item?.id, 180) || pendingId(key),
      clues,
      sourcePlatform: allowedPlatform(item?.sourcePlatform),
      addedAt: validTimestamp(item?.addedAt)
    });
    if (normalized.length === MAX_PENDING) break;
  }
  return normalized;
}

export function removePendingAnalysis(items, id) {
  return normalizePendingAnalyses(items).filter((item) => item.id !== id);
}

export function pendingAnalysisToTextExtraction(item, defaultPartySize = 2) {
  const [pending] = normalizePendingAnalyses([item]);
  if (!pending) return null;
  return {
    kind: "pending_analysis",
    platform: pending.sourcePlatform,
    contentRead: true,
    requiresContent: false,
    requiresWebpage: false,
    clues: pending.clues,
    searchQuery: [pending.clues.name, pending.clues.branch, pending.clues.area, pending.clues.address, pending.clues.nearest_station].filter(Boolean).join(" "),
    plan: { planDate: "", planTime: "", partySize: clampParty(defaultPartySize) },
    links: [],
    warnings: ["这是保存在当前浏览器的待分析线索，仍需确认具体分店。"]
  };
}

export function parseBatchRestaurantLines(value) {
  const lines = String(value || "").slice(0, 10_000).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const restaurants = [];
  let invalidLineCount = 0;
  for (const line of lines.slice(0, MAX_PENDING)) {
    const parts = line.split(/[\t|｜]/).map((part) => part.trim());
    const name = parts[0]?.slice(0, 160) || "";
    if (!name) {
      invalidLineCount += 1;
      continue;
    }
    const branch = parts[1]?.slice(0, 160) || "";
    const address = parts.slice(2).filter(Boolean).join(" ").slice(0, 260);
    restaurants.push({ name, ...(branch ? { branch } : {}), ...(address ? { address } : {}) });
  }
  return { restaurants, totalLineCount: lines.length, invalidLineCount, truncated: lines.length > MAX_PENDING };
}

export function restaurantClueKey(value = {}) {
  value ||= {};
  return [value.name, value.branch, value.address || value.area || value.nearest_station]
    .map((field) => String(field || "").normalize("NFKC").toLowerCase().replace(/\s+/g, ""))
    .join("|");
}

function createPendingAnalysis(restaurant, { sourcePlatform, now }) {
  const clues = sanitizeClues(restaurant);
  if (!clues.name) return null;
  const key = restaurantClueKey(clues);
  return { id: pendingId(key), clues, sourcePlatform: allowedPlatform(sourcePlatform), addedAt: validTimestamp(now) };
}

function sanitizeClues(value = {}) {
  return Object.fromEntries(["name", "branch", "area", "address", "nearest_station", "category"]
    .map((key) => [key, limitedString(value[key], key === "address" ? 260 : 160)])
    .filter(([, field]) => field));
}

function pendingId(key) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return `pending:${(hash >>> 0).toString(36)}`;
}

function allowedPlatform(value) {
  return ["tiktok", "instagram", "xiaohongshu", "x", "web", "unknown"].includes(value) ? value : "unknown";
}
function limitedString(value, maximum) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function validTimestamp(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(); }
function clampParty(value) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(20, Math.max(1, number)) : 2; }
