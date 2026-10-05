import { cleanTimestamp } from "./saved-plans.js";
export const PENDING_STORAGE_KEY = "tabitabi-pending";
const MAX_PENDING = 30;

export function addPendingRestaurants(items, restaurants, options = {}) {
  return addPendingRestaurantsWithReport(items, restaurants, options).items;
}

export function addPendingRestaurantsWithReport(items, restaurants, { excludeRestaurant = null, sourcePlatform = "unknown", batchId = null, now = new Date().toISOString() } = {}) {
  const existing = normalizePendingAnalyses(items);
  const excludedKey = restaurantClueKey(excludeRestaurant);
  const additions = (Array.isArray(restaurants) ? restaurants : [])
    .map((restaurant) => createPendingAnalysis(restaurant, { sourcePlatform, batchId, now }))
    .filter(Boolean)
    .filter((item) => restaurantClueKey(item.clues) !== excludedKey);
  const merged = [...existing];
  let addedCount = 0, duplicateCount = 0, rejectedCount = 0;
  for (const addition of additions) {
    const index = merged.findIndex((item) => restaurantClueKey(item.clues) === restaurantClueKey(addition.clues));
    if (index >= 0) {
      duplicateCount++;
      if (!["completed", "skipped"].includes(merged[index].status)) merged[index] = { ...merged[index], clues: addition.clues, draft: merged[index].revision === 1 ? sanitizeDraft(null, addition.clues) : merged[index].draft };
    } else if (merged.length < MAX_PENDING) { merged.push(addition); addedCount++; }
    else rejectedCount++;
  }
  return { items: merged, addedCount, duplicateCount, rejectedCount };
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
      id: validUuid(item?.id) ? item.id.toLowerCase() : pendingId(key),
      legacyId: validUuid(item?.id) ? limitedString(item?.legacyId,180) || null : limitedString(item?.id,180) || null,
      clues,
      sourcePlatform: allowedPlatform(item?.sourcePlatform),
      batchId: validBatchId(item?.batchId),
      addedAt: validTimestamp(item?.addedAt),
      schemaVersion: 2, revision: Math.max(1, Math.min(1_000_000, Number.isSafeInteger(item?.revision) ? item.revision : 1)),
      status: ["pending", "reviewing", "completed", "failed", "skipped"].includes(item?.status) ? item.status : "pending",
      paused: !["completed","skipped"].includes(item?.status) && item?.paused === true,
      failureStage: ["input", "search", "details", "offline", "access", "budget"].includes(item?.failureStage) ? item.failureStage : null,
      draft: sanitizeDraft(item?.draft, clues),
      updatedAt: validTimestamp(item?.updatedAt || item?.addedAt)
    });
    if (normalized.length === MAX_PENDING) break;
  }
  return normalized;
}

export function removePendingAnalysis(items, id) {
  return normalizePendingAnalyses(items).filter((item) => item.id !== id && item.legacyId !== id);
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
    clues: pending.draft.clues,
    searchQuery: [pending.draft.clues.name, pending.draft.clues.branch, pending.draft.clues.area, pending.draft.clues.address, pending.draft.clues.nearest_station].filter(Boolean).join(" "),
    plan: { ...pending.draft.plan, partySize: pending.draft.plan.partySize || clampParty(defaultPartySize) },
    links: [],
    warnings: ["このブラウザに保存された未分析の手がかりです。店舗・支店はまだ確認が必要です。"]
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

function createPendingAnalysis(restaurant, { sourcePlatform, batchId, now }) {
  const clues = sanitizeClues(restaurant);
  if (!clues.name) return null;
  const key = restaurantClueKey(clues);
  return { id: pendingId(key), clues, sourcePlatform: allowedPlatform(sourcePlatform), batchId: validBatchId(batchId), addedAt: validTimestamp(now), schemaVersion: 2, revision: 1, status: "pending", paused: false, failureStage: null, draft: sanitizeDraft(null, clues), updatedAt: validTimestamp(now) };
}

function validBatchId(value) { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : null; }

function sanitizeClues(value = {}) {
  if(!value || typeof value!=="object" || Array.isArray(value)) value={};
  return Object.fromEntries(["name", "branch", "area", "address", "nearest_station", "category"]
    .map((key) => [key, limitedString(value[key], key === "address" ? 260 : 160)])
    .filter(([, field]) => field));
}

function pendingId(key) {
  const seeds=[2166136261,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  const hex=seeds.map(seed=>{let hash=seed;for(const character of key) hash=Math.imul(hash^character.codePointAt(0),16777619);return (hash>>>0).toString(16).padStart(8,"0");}).join("");
  return [hex.slice(0,8),hex.slice(8,12),"5"+hex.slice(13,16),"8"+hex.slice(17,20),hex.slice(20)].join("-");
}
function validUuid(value) {return typeof value==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);}

function allowedPlatform(value) {
  return ["tiktok", "instagram", "xiaohongshu", "x", "web", "unknown"].includes(value) ? value : "unknown";
}
function limitedString(value, maximum) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function validTimestamp(value) { return cleanTimestamp(value); }
function clampParty(value) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(20, Math.max(1, number)) : 2; }

export function transitionPendingAnalysis(items, id, status, { draft, failureStage = null, now = new Date().toISOString() } = {}) {
  return normalizePendingAnalyses(items).map(item => {
    if ((item.id !== id && item.legacyId !== id) || ["completed", "skipped"].includes(item.status)) return item;
    if (!["pending", "reviewing", "completed", "failed", "skipped", "paused"].includes(status)) return item;
    return { ...item, status: status === "paused" ? "pending" : status, paused: status === "paused",
      draft: draft ? sanitizeDraft(draft, item.clues) : item.draft,
      failureStage: status === "failed" ? failureStage : null, revision: item.revision + 1, updatedAt: validTimestamp(now) };
  });
}
export function recoverPendingAnalyses(items) {
  return normalizePendingAnalyses(items).map(item => item.status === "reviewing" ? { ...item, status: "pending", paused: true } : item);
}
export function pendingWork(items) { return normalizePendingAnalyses(items).filter(item => !["completed", "skipped"].includes(item.status)); }
export function batchProgress(items) {
  const groups = new Map();
  for (const item of normalizePendingAnalyses(items)) {
    const key = item.batchId || "legacy";
    if (!groups.has(key)) groups.set(key, { batchId: item.batchId, total: 0, completed: 0, skipped: 0, failed: 0, pending: 0 });
    const group = groups.get(key); group.total++;
    if (item.status === "completed") group.completed++;
    else if (item.status === "skipped") group.skipped++;
    else if (item.status === "failed") group.failed++;
    else group.pending++;
  }
  return [...groups.values()];
}
function sanitizeDraft(value, fallback = {}) {
  const clues = sanitizeClues(value?.clues || fallback);
  const plan = value?.plan || {};
  const date = typeof plan.planDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan.planDate)
    && Number.isFinite(Date.parse(plan.planDate+"T00:00:00Z"))
    && new Date(plan.planDate+"T00:00:00Z").toISOString().slice(0,10) === plan.planDate ? plan.planDate : "";
  return { clues, plan: { planDate: date, planTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(plan.planTime || "") ? plan.planTime : "", partySize: plan.partySize == null ? null : clampParty(plan.partySize) } };
}

export function pausePendingAnalysis(items,id,draft) {
  const item=normalizePendingAnalyses(items).find(entry=>entry.id===id || entry.legacyId===id);
  return transitionPendingAnalysis(items,id,item?.status==="failed"?"failed":"paused",{draft,failureStage:item?.failureStage});
}
