import { costFixture, FIXTURE_TIME } from "./fixture.mjs";
import { createShadowEntitlementState, summarizeShadowEntitlements, transitionShadowEntitlements } from "../../server/shadow-entitlements.mjs";

// All customers, amounts, labor rates and billing observations below are synthetic arithmetic data.
// They are neither quotations nor posted supplier charges, payments or real delivery evidence.
export function customerCostFixture() {
  const requestRecords = costFixture();
  const starts = requestRecords.filter(record => record.recordType === "attempt_started");
  const coverage = { tasks: "complete", apiRequests: "complete", workLogs: "complete", apiBills: "complete", moneyEntries: "complete" };
  const cycle = (cycleId, customerId) => ({ cycleId, customerId, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z",
    currencies: ["JPY", "USD"], coverage: { ...coverage } });
  const cycles = [cycle("synthetic-cycle-first", "synthetic-customer-one"), cycle("synthetic-cycle-unknown", "synthetic-customer-two")];
  const tasks = [{ taskId: "synthetic-task-first", cycleId: cycles[0].cycleId, requestIds: starts.slice(0, 3).map(record => record.requestId) },
    { taskId: "synthetic-task-unknown", cycleId: cycles[1].cycleId, requestIds: [starts[3].requestId] }];
  const laborRates = [{ version: "fixture-labor-v1", rateKey: "fixture-general-work", currency: "JPY", perHour: 1200,
    effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveUntil: "2026-11-01T00:00:00.000Z" }];
  const workLog = (workLogId, taskId, category, actualMinutes) => ({ workLogId, taskId, operatorId: "synthetic-private-operator",
    category, actualMinutes, currency: "JPY", rateVersion: laborRates[0].version, occurredAt: FIXTURE_TIME });
  const workLogs = [workLog("synthetic-work-first", tasks[0].taskId, "initial_verification", 30),
    workLog("synthetic-work-support", tasks[0].taskId, "customer_service", 10),
    workLog("synthetic-work-zero", tasks[0].taskId, "rework", 0),
    workLog("synthetic-work-unknown", tasks[1].taskId, "repeat_verification", null)];
  const apiBills = starts.map((record, index) => ({ billId: `synthetic-bill-${index + 1}`, requestId: record.requestId,
    amount: [0.11, 3, 0.004, null][index], currency: index === 1 ? "JPY" : "USD", billedAt: FIXTURE_TIME }));
  const moneyEntries = [];
  const kinds = ["quote", "receipt", "refund", "customer_support", "channel", "fixed_allocation"];
  for (const [index, current] of cycles.entries()) for (const currency of current.currencies) for (const kind of kinds) {
    const known = { quote: 11000, receipt: 10000, refund: 100, customer_support: 0, channel: 100, fixed_allocation: 250 };
    moneyEntries.push({ entryId: `synthetic-money-${index}-${currency}-${kind}`, cycleId: current.cycleId, currency, kind,
      amount: currency === "USD" ? 0 : index === 0 ? known[kind] : kind === "receipt" ? null : 0,
      occurredAt: FIXTURE_TIME, ...(kind === "fixed_allocation" ? { methodVersion: "fixture-fixed-per-cycle-v1",
        effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveUntil: "2026-11-01T00:00:00.000Z" } : {}) });
  }
  return { schemaVersion: 1, cycles, tasks, workLogs, laborRates, requestRecords, apiBills, moneyEntries };
}

export function shadowEntitlementFixture() {
  const at = "2026-10-03T00:00:00.000Z", later = "2026-10-03T01:00:00.000Z", expiresAt = "2026-10-04T00:00:00.000Z";
  let state = createShadowEntitlementState({ credits: 3, at, expiresAt });
  const output = [{ scenario: "available", ...summarizeShadowEntitlements(state) }];
  const reserve = operationId => ({ type: "reserve", operationId, units: 1, at, reservationExpiresAt: later });
  state = transitionShadowEntitlements(state, reserve("fixture-delivered"));
  state = transitionShadowEntitlements(state, reserve("fixture-delivered"));
  state = transitionShadowEntitlements(state, { type: "commit", operationId: "fixture-delivered", at,
    evidence: { delivery: "delivered_reconciliation", terminal: true, resultKind: "insufficient_information" } });
  state = transitionShadowEntitlements(state, reserve("fixture-complete-failure"));
  state = transitionShadowEntitlements(state, { type: "release", operationId: "fixture-complete-failure", at,
    evidence: { delivery: "not_delivered", outcome: "complete_failure" } });
  state = transitionShadowEntitlements(state, reserve("fixture-unknown-delivery"));
  output.push({ scenario: "committed_released_and_unknown_reserved", ...summarizeShadowEntitlements(state) });
  state = transitionShadowEntitlements(state, { type: "advance_time", at: expiresAt });
  output.push({ scenario: "allowance_expired_unknown_delivery_held", ...summarizeShadowEntitlements(state) });
  return output;
}
