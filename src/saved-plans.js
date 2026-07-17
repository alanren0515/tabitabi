export const PLAN_STATUSES = [
  { value: "needs_reservation", label: "予約が必要" },
  { value: "reserved", label: "予約済み" },
  { value: "walk_in", label: "直接来店" },
  { value: "information_needed", label: "要確認" },
  { value: "not_recommended", label: "今回は見送る" }
];

export function defaultPlanStatus(recommendation) {
  return {
    strongly_recommended: "needs_reservation",
    recommended: "needs_reservation",
    walk_in_ok: "walk_in",
    temporarily_unavailable: "not_recommended"
  }[recommendation] || "information_needed";
}

export function createSavedPlan({ restaurant, userClues = {}, userLabel = "", plan = {}, now = new Date().toISOString() }) {
  const live = restaurant.sourceMode === "live";
  return {
    id: restaurant.id,
    placeId: restaurant.placeId || null,
    name: live ? userLabel || restaurant.userLabel || restaurant.name || "保存した店舗" : restaurant.name,
    area: live ? "最新情報を再確認してください" : restaurant.area || "",
    recommendation: live ? "unknown" : restaurant.recommendation,
    nextAction: live ? "店舗情報をもう一度確認する" : restaurant.nextAction,
    requiresRefresh: live,
    userClues,
    planDate: cleanDate(plan.planDate),
    planTime: cleanTime(plan.planTime),
    partySize: clampParty(plan.partySize),
    planStatus: validStatus(plan.planStatus) ? plan.planStatus : defaultPlanStatus(restaurant.recommendation),
    lastAnalyzedAt: restaurant.sourceContext ? now : null,
    savedAt: now,
    updatedAt: now,
    ...(live ? {} : { snapshot: restaurant })
  };
}

export function updateSavedPlan(item, updates, now = new Date().toISOString()) {
  return {
    ...item,
    planDate: updates.planDate === undefined ? item.planDate : cleanDate(updates.planDate),
    planTime: updates.planTime === undefined ? item.planTime : cleanTime(updates.planTime),
    partySize: updates.partySize === undefined ? item.partySize : clampParty(updates.partySize),
    planStatus: validStatus(updates.planStatus) ? updates.planStatus : item.planStatus,
    updatedAt: now
  };
}

export function normalizeSavedPlans(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item?.id).map((item) => ({
    ...item,
    planDate: cleanDate(item.planDate),
    planTime: cleanTime(item.planTime),
    partySize: clampParty(item.partySize),
    planStatus: validStatus(item.planStatus) ? item.planStatus : defaultPlanStatus(item.recommendation),
    updatedAt: item.updatedAt || item.savedAt || new Date(0).toISOString()
  }));
}

export function planStatusLabel(value) {
  return PLAN_STATUSES.find((item) => item.value === value)?.label || "要確認";
}

export function sortSavedPlansByUrgency(value, today = localDateString()) {
  if (!Array.isArray(value)) return [];
  const statusPriority = {
    needs_reservation: 0,
    information_needed: 1,
    walk_in: 2,
    reserved: 3,
    not_recommended: 4
  };
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

function dateSortKey(value, today) {
  const date = cleanDate(value);
  if (!date) return { bucket: 1, value: "", direction: 1 };
  if (date < today) return { bucket: 2, value: date, direction: -1 };
  return { bucket: 0, value: date, direction: 1 };
}

function localDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validStatus(value) { return PLAN_STATUSES.some((item) => item.value === value); }
function cleanDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : ""; }
function cleanTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : ""; }
function clampParty(value) { const number = Number.parseInt(value, 10); return Number.isFinite(number) ? Math.min(20, Math.max(1, number)) : 2; }
