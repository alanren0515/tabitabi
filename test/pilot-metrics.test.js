import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePilotGate, summarizePilotMetrics } from "../server/pilot-metrics.mjs";

function event(eventName, run, extra = {}) {
  return { event: eventName, analysisRunId: run, trafficType: "product", sourceMode: "live", ...extra };
}

test("deduplicates clicks per analysis and excludes audit and legacy events", () => {
  const events = [
    event("input_submitted", "run_0001"),
    event("restaurant_identified", "run_0001"),
    event("analysis_completed", "run_0001"),
    event("primary_action_clicked", "run_0001"),
    event("primary_action_clicked", "run_0001"),
    event("feedback_submitted", "run_0001", { helpful: true, willingnessToPay: "consider" }),
    event("analysis_completed", "orphan_01"),
    event("primary_action_clicked", "orphan_01"),
    event("input_submitted", "audit_001", { trafficType: "audit" }),
    event("analysis_completed", "legacy_01", { trafficType: null })
  ];
  const metrics = summarizePilotMetrics(events);
  assert.equal(metrics.inputRuns, 1);
  assert.equal(metrics.completedRuns, 1);
  assert.equal(metrics.actionRuns, 1);
  assert.equal(metrics.actionRate, 1);
  assert.equal(metrics.helpfulRate, 1);
  assert.equal(metrics.willingnessToPayResponses, 1);
  assert.deepEqual(metrics.willingnessToPayDistribution, { consider: 1, depends_on_price: 0, would_not: 0, unsure: 0 });
  assert.equal(metrics.excludedAuditEvents, 1);
  assert.equal(metrics.excludedLegacyEvents, 1);
});

test("reports willingness-to-pay distribution without adding a pilot gate", () => {
  const metrics = summarizePilotMetrics([
    event("feedback_submitted", "pay_0001", { helpful: true, willingnessToPay: "consider" }),
    event("feedback_submitted", "pay_0002", { helpful: true, willingnessToPay: "depends_on_price" }),
    event("feedback_submitted", "pay_0003", { helpful: false, willingnessToPay: "would_not" }),
    event("feedback_submitted", "pay_0004", { helpful: false })
  ]);
  assert.equal(metrics.willingnessToPayResponses, 3);
  assert.deepEqual(metrics.willingnessToPayDistribution, { consider: 1, depends_on_price: 1, would_not: 1, unsure: 0 });
  assert.equal("willingnessToPay" in evaluatePilotGate({ inputRuns: 20, feedbackRuns: 10, analysisCompletionRate: 0.8, actionRate: 0.35, helpfulRate: 0.6 }).gates, false);
});

test("reports privacy-safe seven-day return lower bound", () => {
  const metrics = summarizePilotMetrics([
    { event: "app_visit", visitType: "first_open", trafficType: "product", sourceMode: "demo" },
    { event: "app_visit", visitType: "first_open", trafficType: "product", sourceMode: "demo" },
    { event: "app_visit", visitType: "return_within_7d", trafficType: "product", sourceMode: "demo" }
  ]);
  assert.equal(metrics.firstOpens, 2);
  assert.equal(metrics.returnsWithin7Days, 1);
  assert.equal(metrics.sevenDayReturnLowerBound, 0.5);
});

test("excludes a run if any event reveals demo or sample fallback mode", () => {
  const metrics = summarizePilotMetrics([
    event("input_submitted", "mixed_01"),
    event("restaurant_identified", "mixed_01", { sourceMode: "demo" }),
    event("analysis_completed", "mixed_01"),
    event("primary_action_clicked", "mixed_01"),
    event("input_submitted", "live_01"),
    event("analysis_completed", "live_01")
  ]);
  assert.equal(metrics.excludedDemoRuns, 1);
  assert.equal(metrics.inputRuns, 1);
  assert.equal(metrics.completedRuns, 1);
  assert.equal(metrics.actionRuns, 0);
});

test("enforces sample, completion, action, and helpfulness thresholds", () => {
  const metrics = { inputRuns: 20, feedbackRuns: 10, analysisCompletionRate: 0.8, actionRate: 0.35, helpfulRate: 0.6 };
  assert.equal(evaluatePilotGate(metrics).gatePassed, true);
  const failed = evaluatePilotGate({ ...metrics, inputRuns: 19, helpfulRate: 0.59 });
  assert.deepEqual(failed.blockedBy, ["inputSample", "helpfulRate"]);
});
