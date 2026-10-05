import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { summarizeRequestCosts } from "../server/cost-summary.mjs";
import { createRequestCostTracker } from "../server/request-costs.mjs";
import { costFixture, FIXTURE_PRICES, FIXTURE_TIME } from "../eval/costs/fixture.mjs";

function requestPair() {
  return structuredClone(costFixture().filter(record => record.provider === "google_places"));
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}

test("summary accepts tracker output and preserves bounded, unknown and separate-currency totals", async () => {
  const records = [];
  const tracker = createRequestCostTracker({ append: record => records.push(record), prices: FIXTURE_PRICES, now: () => Date.parse(FIXTURE_TIME) });
  const fetchImpl = async () => new Response("{}", { status: 503 });
  await tracker.trackedFetch({ interactionId: randomUUID(), trafficType: "audit" },
    { provider: "google_places", operation: "text_search", sku: "text_search_pro" }, fetchImpl)("synthetic", {});
  const complete = summarizeRequestCosts(records);
  assert.equal(complete.invalidRecords, 0);
  assert.equal(complete.completeEstimateForObservedAttempts, true);
  assert.equal(complete.transportFailedAttempts, 1);
  assert.equal(complete.breakdown[0].trafficType, "audit");
  assert.equal(complete.currencies.USD.knownListPriceSubtotal, 0.1);
  assert.equal(complete.completeOperationalCoverage, false);

  const errorRecords = [];
  const errorTracker = createRequestCostTracker({ append: record => errorRecords.push(record), prices: FIXTURE_PRICES, now: () => Date.parse(FIXTURE_TIME) });
  await errorTracker.trackedFetch({}, { provider: "google_places", operation: "text_search", sku: "text_search_pro" }, async () => Response.error())("synthetic", {});
  const errorReport = summarizeRequestCosts(errorRecords);
  assert.equal(errorReport.invalidRecords, 0);
  assert.equal(errorReport.completeEstimateForObservedAttempts, true);
  assert.equal(errorReport.transportFailedAttempts, 1);
  assert.equal(errorReport.unattributedAttempts, 1);

  const fixture = costFixture();
  const report = summarizeRequestCosts(fixture);
  assert.equal(report.invalidRecords, 0);
  assert.equal(report.observedAttempts, 4);
  assert.equal(report.unknownCostAttempts, 1);
  assert.equal(report.unknownReasons.usage_unknown, 1);
  assert.equal(report.completeEstimateForObservedAttempts, false);
  assert.equal(report.currencies.JPY.knownListPriceSubtotal, 2);
  assert.ok(Math.abs(report.currencies.USD.knownListPriceSubtotal - 0.1028) < 1e-12);
  assert.equal(report.currencies.USD.actualBilledAmount, null);
  assert.equal(report.currencies.USD.afterFreeTierEstimate, null);
  const serialized = JSON.stringify(report);
  for (const record of fixture) for (const key of ["requestId", "accessId", "httpOperationId", "loadId", "analysisRunId", "interactionId"]) {
    if (record[key]) assert.equal(serialized.includes(record[key]), false);
  }
});

test("unsupported record types are invalid without consulting object prototypes", () => {
  for (const recordType of ["__proto__", "constructor", "toString"]) {
    const pair = requestPair();
    const report = summarizeRequestCosts([...pair, { ...pair[0], recordType }]);
    assert.equal(report.invalidRecords, 1);
    assert.equal(report.observedAttempts, 1);
    assert.equal(report.estimatedAttempts, 1);
    assert.equal(report.completeEstimateForObservedAttempts, false);
  }
});

test("malformed completion and attribution records cannot establish a complete estimate", () => {
  const cases = [
    [1, record => delete record.finishedAt],
    [1, record => { record.finishedAt = "invalid"; }],
    [1, record => { record.finishedAt = "2026-02-30T00:00:00.000Z"; }],
    [1, record => { record.finishedAt = "2026-10-02T23:59:59.000Z"; }],
    [1, record => { record.transportStatus = "unknown"; }],
    [1, record => { record.httpStatus = "200"; }],
    [1, record => { record.httpStatus = 200.5; }],
    [1, record => { record.httpStatus = 600; }],
    [1, record => { record.httpStatus = 500; }],
    [1, record => { record.transportStatus = "http_error"; }],
    [1, record => { record.transportStatus = "network_error"; }],
    [1, record => { record.httpStatus = null; }],
    [0, record => { record.httpOperationId = "private-invalid-id"; }],
    [0, record => { record.analysisRunId = "private-invalid-id"; }],
    [0, record => { record.interactionId = randomUUID(); }],
    [0, record => delete record.analysisRunId],
    [0, record => { record.attributionStatus = "unattributed"; }],
    [0, record => { record.attributionStatus = "unknown"; }],
    [0, record => { record.loadId = "private-invalid-id"; }],
    [0, record => { record.occurredAt = 0; }]
  ];
  for (const [index, mutate] of cases) {
    const pair = requestPair();
    mutate(pair[index]);
    const report = summarizeRequestCosts(pair);
    assert.equal(report.invalidRecords, 1);
    assert.equal(report.observedAttempts, 1);
    assert.equal(report.estimatedAttempts, 0);
    assert.equal(report.unknownCostAttempts, 1);
    assert.equal(report.unfinishedOrOrphanedAttempts, 1);
    assert.equal(report.completeEstimateForObservedAttempts, false);
    assert.equal(JSON.stringify(report).includes("private-invalid-id"), false);
  }
  const cache = structuredClone(costFixture().find(record => record.recordType === "cache_access"));
  cache.interactionId = randomUUID();
  const report = summarizeRequestCosts([...requestPair(), cache]);
  assert.equal(report.invalidRecords, 1);
  assert.equal(report.cache.accesses, 0);
  assert.equal(report.completeEstimateForObservedAttempts, false);
});

test("known finite prices cannot overflow a currency subtotal into a complete estimate", () => {
  const first = requestPair();
  for (const record of first) record.price.perRequest = Number.MAX_VALUE;
  const second = structuredClone(first);
  const requestId = randomUUID();
  for (const record of second) record.requestId = requestId;
  const report = summarizeRequestCosts([...first, ...second]);
  assert.equal(report.invalidRecords, 0);
  assert.equal(report.observedAttempts, 2);
  assert.equal(report.estimatedAttempts, 1);
  assert.equal(report.unknownCostAttempts, 1);
  assert.equal(report.unknownReasons.amount_overflow, 1);
  assert.equal(report.currencies.USD.knownListPriceSubtotal, Number.MAX_VALUE);
  assert.equal(Number.isFinite(report.currencies.USD.knownListPriceSubtotal), true);
  assert.equal(report.currencies.USD.estimatedAttempts, 1);
  assert.equal(report.tokyoDays["2026-10-03"].unknownCostAttempts, 1);
  assert.equal(report.breakdown[0].unknownCostAttempts, 1);
  assert.equal(report.completeEstimateForObservedAttempts, false);
});

test("reordered repeated records and price snapshots compare by value", () => {
  const pair = requestPair();
  pair[1].price = reverseKeys(pair[1].price);
  const report = summarizeRequestCosts([...pair, ...pair.map(reverseKeys)]);
  assert.equal(report.duplicateRecords, 2);
  assert.equal(report.conflictingAttempts, 0);
  assert.equal(report.unknownCostAttempts, 0);
  assert.equal(report.completeEstimateForObservedAttempts, true);
  assert.equal(report.currencies.USD.knownListPriceSubtotal, 0.1);

  const conflict = structuredClone(pair[1]);
  conflict.httpStatus = 201;
  const conflicting = summarizeRequestCosts([...pair, conflict]);
  assert.equal(conflicting.conflictingAttempts, 1);
  assert.equal(conflicting.unknownReasons.conflicting_attempt, 1);
  assert.equal(conflicting.completeEstimateForObservedAttempts, false);
});
