import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerCostFixture } from "../eval/costs/customer-fixture.mjs";
import { summarizeCustomerCosts } from "../server/customer-cost-report.mjs";

function completeFixture() {
  const snapshot = customerCostFixture();
  const cycleId = snapshot.cycles[0].cycleId;
  snapshot.cycles = snapshot.cycles.slice(0, 1);
  snapshot.tasks = snapshot.tasks.slice(0, 1);
  const ids = new Set(snapshot.tasks[0].requestIds);
  snapshot.requestRecords = snapshot.requestRecords.filter(row => row.recordType === "cache_access" || ids.has(row.requestId));
  snapshot.workLogs = snapshot.workLogs.filter(row => row.taskId === snapshot.tasks[0].taskId);
  snapshot.apiBills = snapshot.apiBills.filter(row => ids.has(row.requestId));
  snapshot.moneyEntries = snapshot.moneyEntries.filter(row => row.cycleId === cycleId);
  return snapshot;
}
function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)]));
  return value;
}
function assertIncomplete(report) {
  assert.equal(report.completeCostForDeclaredSnapshot, false);
  for (const cycle of report.reports) for (const values of Object.values(cycle.currencies)) for (const value of Object.values(values.contribution)) {
    assert.equal(value.complete, false);
    assert.equal(value.completeAmount, null);
    assert.equal(value.knownSubtotalIsNotMargin, true);
  }
}

test("customer report keeps failed API cost, gross/net/refunds, support and acquisition separate by currency", () => {
  const report = summarizeCustomerCosts(completeFixture());
  assert.equal(report.completeCostForDeclaredSnapshot, true);
  const cycle = report.reports[0], jpy = cycle.currencies.JPY, usd = cycle.currencies.USD;
  assert.equal(cycle.allocatedRequestCount, 3);
  assert.equal(cycle.work.knownActualMinutesSubtotal, 40);
  assert.equal(cycle.work.explicitZeroMinuteLogs, 1);
  assert.equal(jpy.quote.knownSubtotal, 11000);
  assert.equal(jpy.receivedGross.knownSubtotal, 10000);
  assert.equal(jpy.refunds.knownSubtotal, 100);
  assert.equal(jpy.receivedNet.completeAmount, 9900);
  assert.equal(jpy.labor.knownSubtotal, 600);
  assert.equal(jpy.customerSupport.knownSubtotal, 200);
  assert.equal(jpy.apiListPrice.knownSubtotal, 2);
  assert.equal(jpy.apiBilled.knownSubtotal, 3);
  assert.equal(jpy.contribution.billedBeforeAcquisition.completeAmount, 8847);
  assert.equal(jpy.contribution.billedAfterAcquisition.completeAmount, 8747);
  assert.equal(jpy.contribution.listPriceEstimateAfterAcquisition.completeAmount, 8748);
  assert.ok(Math.abs(usd.apiListPrice.knownSubtotal - 0.1028) < 1e-12);
  assert.equal(usd.contribution.billedAfterAcquisition.completeAmount, -0.114);
  assert.equal(report.completeOperationalCoverage, false);
  assert.equal(report.realWorldEvidence, false);
  assert.equal(report.releaseGateEvidence, false);
});

test("stable identifiers deduplicate API/task/work/customer-cycle/finance retries regardless of object key order", () => {
  const snapshot = completeFixture();
  for (const key of ["cycles", "tasks", "workLogs", "laborRates", "requestRecords", "apiBills", "moneyEntries"]) snapshot[key].push(...reordered(snapshot[key]));
  snapshot.tasks[1].requestIds.reverse(); // Request references are sets, not independently chargeable occurrences.
  const report = summarizeCustomerCosts(snapshot);
  assert.equal(report.completeCostForDeclaredSnapshot, true);
  assert.equal(report.reports.length, 1);
  assert.equal(report.reports[0].taskCount, 1);
  assert.equal(report.reports[0].work.knownActualMinutesSubtotal, 40);
  assert.equal(report.reports[0].currencies.JPY.contribution.billedAfterAcquisition.completeAmount, 8747);
  assert.ok(report.diagnostics.duplicateRecords > 0);
});

test("a later receipt or supplier bill remains assigned to its explicit cycle instead of being lost by calendar month", () => {
  const snapshot = completeFixture();
  snapshot.moneyEntries.find(row => row.kind === "receipt" && row.currency === "JPY").occurredAt = "2026-11-05T00:00:00.000Z";
  snapshot.apiBills[0].billedAt = "2026-11-05T00:00:00.000Z";
  const report = summarizeCustomerCosts(snapshot);
  assert.equal(report.completeCostForDeclaredSnapshot, true);
  assert.equal(report.reports[0].currencies.JPY.receivedNet.completeAmount, 9900);
});

test("cross-customer request allocation and conflicting tasks cannot charge the same upstream attempt twice", () => {
  const snapshot = customerCostFixture();
  snapshot.tasks[1].requestIds.push(snapshot.tasks[0].requestIds[0]);
  const report = summarizeCustomerCosts(snapshot);
  assertIncomplete(report);
  assert.equal(report.diagnostics.allocationConflicts, 1);
  assert.equal(report.reports[0].currencies.USD.apiListPrice.knownSubtotal, 0.0028);
  assert.equal(report.reports[1].currencies.USD.apiListPrice.knownSubtotal, 0);

  const taskConflict = completeFixture();
  taskConflict.tasks.push({ ...taskConflict.tasks[0], cycleId: "unknown-customer-cycle" });
  assertIncomplete(summarizeCustomerCosts(taskConflict));
});

test("zero actual minutes is explicit; unknown minutes, invalid/overlapping/expired rates never become free labor", () => {
  const unknown = completeFixture(); unknown.workLogs[0].actualMinutes = null;
  const report = summarizeCustomerCosts(unknown);
  assertIncomplete(report);
  assert.equal(report.reports[0].work.unknownMinuteLogs, 1);
  assert.equal(report.reports[0].work.explicitZeroMinuteLogs, 1);
  assert.equal(report.reports[0].currencies.JPY.labor.knownSubtotal, 0);
  assert.equal(report.reports[0].currencies.JPY.customerSupport.knownSubtotal, 200);
  for (const change of [
    snapshot => { snapshot.workLogs[2].rateVersion = null; },
    snapshot => { snapshot.laborRates[0].effectiveUntil = "2026-10-03T00:00:00.000Z"; },
    snapshot => { snapshot.laborRates.push({ ...snapshot.laborRates[0], version: "overlapping-version" }); },
    snapshot => { snapshot.workLogs[0].currency = "USD"; },
    snapshot => { snapshot.workLogs = []; }
  ]) {
    const snapshot = completeFixture(); change(snapshot);
    assertIncomplete(summarizeCustomerCosts(snapshot));
  }
});

test("missing receipts, refunds, billed/API price, support/channel/fixed cost or coverage withhold all complete contributions", () => {
  const changes = [
    snapshot => { snapshot.moneyEntries = snapshot.moneyEntries.filter(row => !(row.kind === "receipt" && row.currency === "JPY")); },
    snapshot => { snapshot.moneyEntries.find(row => row.kind === "refund").amount = null; },
    snapshot => { snapshot.apiBills.pop(); },
    snapshot => { for (const row of snapshot.requestRecords) if (row.provider === "qwen") row.price = null; },
    ...["customer_support", "channel", "fixed_allocation"].map(kind => snapshot => { snapshot.moneyEntries.find(row => row.kind === kind).amount = null; }),
    snapshot => { delete snapshot.cycles[0].coverage.workLogs; }
  ];
  for (const change of changes) {
    const snapshot = completeFixture(); change(snapshot);
    const report = summarizeCustomerCosts(snapshot);
    assertIncomplete(report);
    assert.equal(report.reports[0].currencies.JPY.receivedGross.knownSubtotal, snapshot.moneyEntries.some(row => row.kind === "receipt" && row.currency === "JPY") ? 10000 : 0);
    assert.ok(report.reports[0].currencies.JPY.contribution.billedAfterAcquisition.missingCycleComponents.length > 0);
  }
});

test("complete actual minutes require known task coverage and unambiguous work allocation", () => {
  for (const change of [
    snapshot => { delete snapshot.cycles[0].coverage.tasks; },
    snapshot => { snapshot.workLogs.push({ ...snapshot.workLogs[0], workLogId: "orphan-work", taskId: "missing-task", actualMinutes: 60 }); },
    snapshot => { snapshot.tasks.push({ taskId: "orphan-task", cycleId: "missing-cycle", requestIds: [] }); },
    snapshot => { snapshot.tasks.push({ ...snapshot.tasks[0], cycleId: "conflicting-cycle" }); },
    snapshot => { snapshot.workLogs.push({ ...snapshot.workLogs[0], taskId: "conflicting-task" }); }
  ]) {
    const snapshot = completeFixture(); change(snapshot);
    assert.equal(summarizeCustomerCosts(snapshot).reports[0].work.completeActualMinutes, false);
  }
});

test("unknown or invalid financial prices do not make known actual minutes incomplete", () => {
  for (const change of [
    snapshot => { snapshot.workLogs[0].rateVersion = null; },
    snapshot => { snapshot.laborRates[0].perHour = null; },
    snapshot => { snapshot.moneyEntries[0].amount = -1; },
    snapshot => { snapshot.apiBills[0].amount = null; }
  ]) {
    const snapshot = completeFixture(); change(snapshot);
    const report = summarizeCustomerCosts(snapshot);
    assert.equal(report.reports[0].work.knownActualMinutesSubtotal, 40);
    assert.equal(report.reports[0].work.completeActualMinutes, true);
    assertIncomplete(report);
  }
});

test("conflicting labor/payment/cycle records, unallocated costs, bad dates and overflow cannot establish full contribution", () => {
  const changes = [
    snapshot => { snapshot.workLogs.push({ ...snapshot.workLogs[0], actualMinutes: 60 }); },
    snapshot => { snapshot.moneyEntries.push({ ...snapshot.moneyEntries[1], amount: 99999 }); },
    snapshot => { snapshot.apiBills.push({ ...snapshot.apiBills[0], billId: "different-bill-for-same-request" }); },
    snapshot => { snapshot.cycles.push({ ...snapshot.cycles[0], customerId: "different-customer" }); },
    snapshot => { snapshot.workLogs.push({ ...snapshot.workLogs[0], workLogId: "orphan-work", taskId: "missing-task" }); },
    snapshot => { snapshot.workLogs[0].occurredAt = "2026-02-30T00:00:00.000Z"; },
    snapshot => { snapshot.laborRates[0].perHour = Number.MAX_VALUE; snapshot.workLogs[0].actualMinutes = 120; },
    snapshot => { snapshot.moneyEntries.find(row => row.kind === "fixed_allocation").effectiveUntil = "2026-10-03T00:00:00.000Z"; }
  ];
  for (const change of changes) {
    const snapshot = completeFixture(); change(snapshot);
    const report = summarizeCustomerCosts(snapshot);
    assertIncomplete(report);
    assert.equal(JSON.stringify(report).includes("Infinity"), false);
  }
  assert.throws(() => summarizeCustomerCosts({}), /INVALID_CUSTOMER_COST_SNAPSHOT/);
});

test("reports/CLI expose aggregates and bounded synthetic evidence without original identifiers or arbitrary text", async () => {
  const snapshot = completeFixture();
  snapshot.moneyEntries[0].body = "PRIVATE_PAYMENT_OR_CUSTOMER_BODY";
  snapshot.workLogs[0].notes = "PRIVATE_OPERATOR_NOTE";
  const serialized = JSON.stringify(summarizeCustomerCosts(snapshot));
  for (const key of ["cycleId", "customerId", "taskId", "workLogId", "operatorId", "requestId", "billId", "entryId"]) for (const rows of Object.values(snapshot).filter(Array.isArray)) for (const row of rows) {
    if (row[key]) assert.equal(serialized.includes(row[key]), false, key);
  }
  assert.equal(serialized.includes("PRIVATE_"), false);
  const defaultReport = JSON.parse(execFileSync(process.execPath, ["scripts/summarize-customer-costs.mjs"], { encoding: "utf8" }));
  assert.equal(defaultReport.evidenceType, "fixture_only");
  assert.equal(defaultReport.shadowFixture.at(-1).heldUnknownDeliveryOperations, 1);
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-customer-cost-test-"));
  try {
    const path = join(directory, "snapshot.json"); await writeFile(path, JSON.stringify(snapshot));
    const explicit = JSON.parse(execFileSync(process.execPath, ["scripts/summarize-customer-costs.mjs", "--input", path], { encoding: "utf8" }));
    assert.equal(explicit.evidenceType, "explicit_local_snapshot_unverified");
    assert.equal(explicit.realWorldEvidence, false);
    assert.equal(explicit.releaseGateEvidence, false);
    assert.equal(explicit.snapshotBoundary.maxBytes, 10 * 1024 * 1024);
    assert.equal(explicit.snapshotBoundary.suppliedCoverageAssertionsVerified, false);
    assert.equal(explicit.shadowFixture.length, 0);
    await writeFile(path, "x".repeat(10 * 1024 * 1024 + 1));
    assert.throws(() => execFileSync(process.execPath, ["scripts/summarize-customer-costs.mjs", "--input", path], { encoding: "utf8", stdio: "pipe" }), error => error.stderr.includes("CUSTOMER_COST_SNAPSHOT_TOO_LARGE") && !error.stderr.includes(path));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
