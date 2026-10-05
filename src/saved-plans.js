export const PLAN_STATUSES = [
  { value: "needs_reservation", label: "予約が必要" },
  { value: "reserved", label: "予約済み" },
  { value: "walk_in", label: "直接来店" },
  { value: "information_needed", label: "要確認" },
  { value: "not_recommended", label: "今回は見送る" }
];

// These are the user's own records, never evidence that a reservation exists.
export const USER_PROGRESS = [
  { value: "want_to_go", label: "行きたい" },
  { value: "reserved_by_user", label: "本人が予約済み" },
  { value: "visited", label: "行った" },
  { value: "skipped", label: "今回は見送る" }
];
export const REVIEW_OUTCOMES = ["supported", "unknown", "conflicted"];
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CLUE_FIELDS = ["name", "branch", "area", "address", "originalName", "nearest_station", "category"];

export function defaultPlanStatus(recommendation) {
  return {
    strongly_recommended: "needs_reservation", recommended: "needs_reservation",
    walk_in_ok: "walk_in", temporarily_unavailable: "not_recommended"
  }[recommendation] || "information_needed";
}

export function createSavedPlan({ restaurant = {}, userClues = {}, userLabel = "", plan = {}, now = new Date().toISOString() } = {}) {
  const clues = sanitizeUserClues(userClues);
  const sourceMode = restaurant.sourceMode === "live" ? "live" : "demo";
  const planStatus = validStatus(plan.planStatus) ? plan.planStatus : defaultPlanStatus(restaurant.recommendation);
  return {
    schemaVersion: 2,
    id: newPlanId(),
    restaurantId: limitedText(restaurant.id, 200) || (limitedText(restaurant.placeId, 160) ? `google:${limitedText(restaurant.placeId, 160)}` : ""),
    legacyId: null,
    revision: 1,
    sourceMode,
    placeId: sourceMode === "live" ? limitedText(restaurant.placeId, 160) || null : null,
    name: limitedText(userLabel, 500) || clues.originalName || clues.name || limitedText(restaurant.userLabel, 500) || (sourceMode === "demo" ? limitedText(restaurant.name, 500) : "") || "保存した店舗",
    userClues: clues,
    requiresRefresh: sourceMode === "live",
    planDate: cleanPlanDate(plan.planDate),
    planTime: cleanPlanTime(plan.planTime),
    partySize: clampPartySize(plan.partySize),
    planStatus,
    userProgress: validProgress(plan.userProgress) ? plan.userProgress : progressFromLegacyStatus(planStatus),
    note: limitedText(plan.note, 500),
    lastAnalyzedAt: null,
    lastReviewedAt: null,
    lastReviewOutcome: null,
    savedAt: cleanTimestamp(now),
    updatedAt: cleanTimestamp(now)
  };
}

export function updateSavedPlan(item, updates = {}, now = new Date().toISOString()) {
  const [current] = normalizeSavedPlans([item]);
  if (!current) return null;
  const planStatus = validStatus(updates.planStatus) ? updates.planStatus : current.planStatus;
  return {
    ...current,
    name: updates.name === undefined ? current.name : limitedText(updates.name, 500) || "保存した店舗",
    userClues: updates.userClues === undefined ? current.userClues : sanitizeUserClues(updates.userClues),
    note: updates.note === undefined ? current.note : limitedText(updates.note, 500),
    planDate: updates.planDate === undefined ? current.planDate : cleanPlanDate(updates.planDate),
    planTime: updates.planTime === undefined ? current.planTime : cleanPlanTime(updates.planTime),
    partySize: updates.partySize === undefined ? current.partySize : clampPartySize(updates.partySize),
    planStatus,
    userProgress: validProgress(updates.userProgress) ? updates.userProgress : updates.planStatus !== undefined && validStatus(updates.planStatus) ? progressFromLegacyStatus(planStatus) : current.userProgress,
    revision: incrementRevision(current.revision),
    updatedAt: cleanTimestamp(now) || current.updatedAt
  };
}

export function normalizeSavedPlans(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  const occurrences = new Map();
  return value.filter(isSavedPlanRecord).map((item) => {
    const oldId = limitedText(item.id, 200);
    const restaurantId = limitedText(item.restaurantId, 200) || limitedText(item.restaurant?.id, 200) || oldId;
    const legacyId = limitedText(item.legacyId, 200) || (item.schemaVersion !== 2 || !UUID_PATTERN.test(oldId) ? oldId : "") || null;
    const seed = JSON.stringify([oldId, restaurantId, cleanPlanDate(item.planDate), cleanPlanTime(item.planTime), cleanTimestamp(item.savedAt)]);
    const occurrence = occurrences.get(seed) || 0;
    occurrences.set(seed, occurrence + 1);
    let id = item.schemaVersion === 2 && UUID_PATTERN.test(oldId) && !usedIds.has(oldId.toLowerCase()) ? oldId.toLowerCase() : migratedPlanId(`${seed}:${occurrence}`);
    while (usedIds.has(id)) id = migratedPlanId(`${id}:${usedIds.size}`);
    usedIds.add(id);
    const sourceMode = item.sourceMode === "live" || (item.requiresRefresh && item.placeId) ? "live" : "demo";
    const planStatus = validStatus(item.planStatus) ? item.planStatus : defaultPlanStatus(item.recommendation);
    const reviewedAt = item.schemaVersion === 2 && sourceMode === "live" ? cleanTimestamp(item.lastReviewedAt) : null;
    const reviewOutcome = item.schemaVersion === 2 && REVIEW_OUTCOMES.includes(item.lastReviewOutcome) ? item.lastReviewOutcome : null;
    return {
      schemaVersion: 2, id, restaurantId, legacyId,
      revision: Number.isSafeInteger(item.revision) && item.revision >= 1 ? item.revision : 1,
      sourceMode,
      placeId: sourceMode === "live" ? limitedText(item.placeId, 160) || null : null,
      name: limitedText(item.name, 500) || "保存した店舗",
      userClues: sanitizeUserClues(item.userClues),
      requiresRefresh: sourceMode === "live",
      planDate: cleanPlanDate(item.planDate), planTime: cleanPlanTime(item.planTime), partySize: clampPartySize(item.partySize),
      planStatus,
      userProgress: validProgress(item.userProgress) ? item.userProgress : progressFromLegacyStatus(planStatus),
      note: limitedText(item.note, 500),
      lastAnalyzedAt: cleanTimestamp(item.lastAnalyzedAt),
      lastReviewedAt: reviewedAt && reviewOutcome ? reviewedAt : null,
      lastReviewOutcome: reviewedAt && reviewOutcome ? reviewOutcome : null,
      savedAt: cleanTimestamp(item.savedAt),
      updatedAt: cleanTimestamp(item.updatedAt) || cleanTimestamp(item.savedAt)
    };
  });
}

export function isSavedPlanRecord(item) {
  return Boolean(item && typeof item === "object" && !Array.isArray(item) && (limitedText(item.id, 200) || limitedText(item.restaurantId, 200) || limitedText(item.restaurant?.id, 200)));
}

export function searchSavedPlans(items, query = "") {
  const normalized = normalizeSavedPlans(items);
  const text = searchableText(limitedText(query, 500));
  return text ? normalized.filter((item) => searchableText(`${item.name}\n${item.note}`).includes(text)) : normalized;
}

// Call only for an explicitly requested review. A legacy time is not a review.
export function recordPlanReview(item, { sourceMode, resultGeneratedAt, requestStatus, outcome } = {}) {
  const [current] = normalizeSavedPlans([item]);
  if (!current) return null;
  const timestamp = cleanTimestamp(resultGeneratedAt);
  if (sourceMode !== "live" || current.sourceMode !== "live" || requestStatus !== "completed" || !timestamp || !REVIEW_OUTCOMES.includes(outcome)) return current;
  if (current.lastReviewedAt && timestamp < current.lastReviewedAt) return current;
  if (timestamp === current.lastReviewedAt && outcome === current.lastReviewOutcome) return current;
  return { ...current, lastReviewedAt: timestamp, lastReviewOutcome: outcome, revision: incrementRevision(current.revision), updatedAt: current.updatedAt && current.updatedAt > timestamp ? current.updatedAt : timestamp };
}

export function planStatusLabel(value) { return PLAN_STATUSES.find((item) => item.value === value)?.label || "要確認"; }
export function userProgressLabel(value) { return USER_PROGRESS.find((item) => item.value === value)?.label || "行きたい"; }

export function sortSavedPlansByUrgency(value, today = localDateString()) {
  if (!Array.isArray(value)) return [];
  const statusPriority = { needs_reservation: 0, information_needed: 1, walk_in: 2, reserved: 3, not_recommended: 4 };
  return value.map((item, index) => ({ item, index })).sort((left, right) => {
    const statusDelta = (statusPriority[left.item.planStatus] ?? 1) - (statusPriority[right.item.planStatus] ?? 1);
    if (statusDelta) return statusDelta;
    const leftDate = dateSortKey(left.item.planDate, today);
    const rightDate = dateSortKey(right.item.planDate, today);
    if (leftDate.bucket !== rightDate.bucket) return leftDate.bucket - rightDate.bucket;
    if (leftDate.value !== rightDate.value) return leftDate.value.localeCompare(rightDate.value) * leftDate.direction;
    return left.index - right.index;
  }).map(({ item }) => item);
}

export function sanitizeUserClues(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(CLUE_FIELDS.map((key) => [key, limitedText(value[key], 500)]).filter(([, field]) => field));
}
export function limitedText(value, maximum = 500) { return typeof value === "string" ? value.trim().slice(0, maximum).trim() : ""; }
export function cleanPlanDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value : "";
}
export function cleanPlanTime(value) { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : ""; }
export function cleanTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !cleanPlanDate(match[1])) return null;
  if (match[5] !== "Z" && (Number(match[7]) > 14 || Number(match[8]) > 59 || (Number(match[7]) === 14 && Number(match[8]) !== 0))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const normalized = date.toISOString();
  return cleanPlanDate(normalized.slice(0, 10)) ? normalized : null;
}
export function clampPartySize(value) { const number = Number(value); return Number.isFinite(number) ? Math.min(20, Math.max(1, Math.trunc(number))) : 2; }

function validStatus(value) { return PLAN_STATUSES.some((item) => item.value === value); }
function validProgress(value) { return USER_PROGRESS.some((item) => item.value === value); }
function incrementRevision(value) { return Math.min(Number.MAX_SAFE_INTEGER, value + 1); }
function progressFromLegacyStatus(value) { return value === "reserved" ? "reserved_by_user" : value === "not_recommended" ? "skipped" : "want_to_go"; }
function searchableText(value) { return value.normalize("NFKC").toLocaleLowerCase(); }
function dateSortKey(value, today) {
  const date = cleanPlanDate(value);
  if (!date) return { bucket: 1, value: "", direction: 1 };
  return date < today ? { bucket: 2, value: date, direction: -1 } : { bucket: 0, value: date, direction: 1 };
}
function localDateString(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function newPlanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytesToUuid(Array.from(bytes));
}
function migratedPlanId(seed) {
  // Stable local mapping makes migration retries and old references repeatable.
  const bytes = [];
  for (let part = 0; part < 4; part += 1) {
    let hash = (2166136261 ^ Math.imul(part + 1, 0x9e3779b9)) >>> 0;
    for (const character of seed) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    for (let shift = 0; shift < 32; shift += 8) bytes.push((hash >>> shift) & 255);
  }
  return bytesToUuid(bytes);
}
function bytesToUuid(bytes) {
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Plan identity is independent of title, date and an in-memory selected plan id.
export function savedPlanMatchesRestaurant(plan, restaurant) {
  if(!plan || !restaurant || plan.sourceMode!==restaurant.sourceMode) return false;
  if(plan.sourceMode==="live") return Boolean(plan.placeId && restaurant.placeId && plan.placeId===restaurant.placeId);
  return Boolean(plan.restaurantId && plan.restaurantId===restaurant.id);
}
