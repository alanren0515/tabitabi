import { estimateAttemptCost } from "./cost-prices.mjs";
import { isDeepStrictEqual } from "node:util";

// All observed attempts remain in the total, including failures, audit and unknown attribution.
export function summarizeRequestCosts(records) {
  if (!Array.isArray(records)) throw new Error("INVALID_COST_RECORDS");
  const operations = ["text_search", "place_details", "candidate_preview", "shop_search", "screenshot_extraction"];
  const starts = new Map(), finishes = new Map(), accesses = new Map(), conflicts = new Set();
  const recordMaps = new Map([["attempt_started", starts], ["attempt_finished", finishes], ["cache_access", accesses]]);
  let invalidRecords = 0, duplicateRecords = 0;
  for (const record of records) {
    const key = record?.recordType === "cache_access" ? record.accessId : record?.requestId;
    const map = recordMaps.get(record?.recordType);
    if (record?.schemaVersion !== 1 || !map || !uuid(key) || !timestamp(record.occurredAt) || !operations.includes(record.operation)
      || !["product", "audit", "unknown"].includes(record.trafficType)
      || !["live", "demo", "unknown"].includes(record.sourceMode) || !validAttribution(record)
      || (record.releaseRevision != null && (typeof record.releaseRevision !== "string" || !/^[a-f0-9]{40}$/.test(record.releaseRevision)))
      || (record.recordType === "cache_access" ? !uuid(record.loadId) || !["miss", "hit", "coalesced"].includes(record.cacheStatus) || !["delivered", "failed"].includes(record.outcome)
        : !["google_places", "hotpepper", "qwen", "openai"].includes(record.provider) || typeof record.sku !== "string" || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(record.sku)
          || (record.loadId !== null && !uuid(record.loadId)) || typeof record.fallback !== "boolean"
          || (record.recordType === "attempt_finished" && !validFinish(record)))) { invalidRecords++; continue; }
    if (map.has(key)) {
      duplicateRecords++;
      if (!isDeepStrictEqual(map.get(key), record)) conflicts.add(key);
    } else map.set(key, record);
  }
  const currency = {};
  const reasons = {};
  const breakdown = {};
  const tokyoDays = {};
  let known = 0, unknown = 0, unfinished = 0, unattributed = 0, failed = 0, fallback = 0, mismatched = 0;
  const ids = new Set([...starts.keys(), ...finishes.keys()]);
  for (const id of ids) {
    const start = starts.get(id), finish = finishes.get(id);
    const record = start || finish;
    const mismatch = start && finish && ["provider", "operation", "sku", "loadId", "httpOperationId", "analysisRunId", "interactionId", "attributionStatus", "trafficType", "sourceMode", "fallback", "releaseRevision", "occurredAt"]
      .some(key => start[key] !== finish[key]);
    let estimate;
    if (conflicts.has(id) || mismatch) { estimate = { status: "unknown", reason: "conflicting_attempt" }; mismatched++; }
    else if (!start || !finish) { estimate = { status: "unknown", reason: !start ? "missing_start" : "unfinished_attempt" }; unfinished++; }
    else if (!isDeepStrictEqual(start.price, finish.price)) { estimate = { status: "unknown", reason: "price_snapshot_mismatch" }; mismatched++; }
    else if (start.price && (start.price.provider !== start.provider || start.price.sku !== start.sku
      || !(Date.parse(start.price.effectiveFrom) <= Date.parse(start.occurredAt) && Date.parse(start.occurredAt) < Date.parse(start.price.effectiveUntil)))) {
      estimate = { status: "unknown", reason: "price_context_mismatch" };
    } else estimate = estimateAttemptCost(start.price, finish.usage);
    if (estimate.status === "estimated") {
      const subtotal = (currency[estimate.currency]?.knownListPriceSubtotal || 0) + estimate.amount;
      if (!Number.isFinite(subtotal)) estimate = { status: "unknown", reason: "amount_overflow" };
      else {
        known++;
        const sum = currency[estimate.currency] ||= { knownListPriceSubtotal: 0, estimatedAttempts: 0, actualBilledAmount: null, afterFreeTierEstimate: null };
        sum.knownListPriceSubtotal = subtotal; sum.estimatedAttempts++;
      }
    }
    if (estimate.status !== "estimated") { unknown++; reasons[estimate.reason] = (reasons[estimate.reason] || 0) + 1; }
    if (record.attributionStatus !== "verified_flow") unattributed++;
    if (finish && finish.transportStatus !== "http_success") failed++;
    if (record.fallback) fallback++;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(record.occurredAt));
    const dayStat = tokyoDays[day] ||= { attempts: 0, unknownCostAttempts: 0 };
    dayStat.attempts++; if (estimate.status !== "estimated") dayStat.unknownCostAttempts++;
    const group = `${record.provider}:${record.operation}:${record.trafficType || "unknown"}`;
    const stat = breakdown[group] ||= { provider: record.provider, operation: record.operation, trafficType: record.trafficType || "unknown", attempts: 0, unknownCostAttempts: 0 };
    stat.attempts++; if (estimate.status !== "estimated") stat.unknownCostAttempts++;
  }
  const validAccesses = [...accesses.values()].filter(record => !conflicts.has(record.accessId));
  const shared = validAccesses.filter(record => ["hit", "coalesced"].includes(record.cacheStatus));
  const knownLoads = new Set([...starts.values()].map(record => record.loadId).filter(Boolean));
  return { schemaVersion: 1, scope: "observed_request_log_only", completeOperationalCoverage: false,
    billingLedger: false, observedAttempts: ids.size, estimatedAttempts: known, unknownCostAttempts: unknown,
    completeEstimateForObservedAttempts: unknown === 0 && invalidRecords === 0 && conflicts.size === 0 && ids.size > 0,
    unfinishedOrOrphanedAttempts: unfinished, conflictingAttempts: mismatched, unattributedAttempts: unattributed,
    transportFailedAttempts: failed, fallbackAttempts: fallback, unknownReasons: reasons, currencies: currency,
    cache: { accesses: validAccesses.length, deliveredWithoutNewLoad: shared.filter(x => x.outcome === "delivered").length,
      coalescedFailures: shared.filter(x => x.cacheStatus === "coalesced" && x.outcome === "failed").length,
      hitAccesses: shared.filter(x => x.cacheStatus === "hit").length,
      coalescedAccesses: shared.filter(x => x.cacheStatus === "coalesced").length,
      missingOriginAccesses: shared.filter(x => !knownLoads.has(x.loadId)).length, estimatedSavings: null },
    tokyoDays, breakdown: Object.values(breakdown), invalidRecords, duplicateRecords,
    limitations: ["Bounded logs may be pruned, interrupted or fail to persist; observed subtotals are not the account's complete cost.",
      "Request list prices estimate attempted dispatches, including failures; supplier billing may differ. HTTP success is not a completed product analysis.",
      "Missing prices or usage stay unknown. Currency totals are separate; no exchange rate or free tier is assumed.",
      "Cache receipts identify beneficiaries; no monetary saving or shared amortization is inferred.",
      "Public HTML/network infrastructure, labor and customer-cycle costs are outside A04; A05 must add them."] };
}
function uuid(value) { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value); }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value);
}
function validAttribution(record) {
  if (!uuid(record.httpOperationId)) return false;
  const ids = [record.analysisRunId, record.interactionId].filter(value => value !== undefined);
  if (record.attributionStatus === "verified_flow") return ids.length === 1 && uuid(ids[0]);
  return record.attributionStatus === "unattributed" && ids.length === 0;
}
function validFinish(record) {
  if (!timestamp(record.finishedAt) || Date.parse(record.finishedAt) < Date.parse(record.occurredAt)) return false;
  if (["network_error", "timeout"].includes(record.transportStatus)) return record.httpStatus === null;
  // A Fetch error/opaque Response has status 0 and response.ok === false.
  if (record.transportStatus === "http_error" && record.httpStatus === 0) return true;
  if (!Number.isInteger(record.httpStatus) || record.httpStatus < 100 || record.httpStatus > 599) return false;
  if (record.transportStatus === "http_success") return record.httpStatus >= 200 && record.httpStatus < 300;
  return record.transportStatus === "http_error" && (record.httpStatus < 200 || record.httpStatus >= 300);
}
