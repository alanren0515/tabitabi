import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDailyMonitoringReport, mergeExternalMonitoring, writeMonitoringSnapshot } from "../server/daily-monitoring.mjs";

const revision = "a".repeat(40);
const budgetLimits = { places_search: 10 };

function event(eventName, run, extra = {}) {
  return { event: eventName, analysisRunId: run, trafficType: "product", sourceMode: "live", occurredAt: "2026-08-04T02:00:00.000Z", ...extra };
}

test("separates today's all-release operations from the current-release pilot gate", () => {
  const report = buildDailyMonitoringReport({
    events: [
      event("input_submitted", "current_01", { releaseRevision: revision }),
      event("analysis_completed", "current_01", { releaseRevision: revision }),
      event("feedback_submitted", "current_01", { releaseRevision: revision, helpful: true }),
      event("input_submitted", "old_01", { releaseRevision: "b".repeat(40) }),
      event("input_submitted", "audit_01", { trafficType: "audit", releaseRevision: revision }),
      event("input_submitted", "demo_01", { sourceMode: "demo", releaseRevision: revision })
    ],
    date: "2026-08-04",
    releaseRevision: revision,
    budgetState: { date: "2026-08-04", counts: { places_search: 1 } },
    budgetLimits
  });
  assert.equal(report.dailyAllReleases.inputRuns, 2);
  assert.equal(report.dailyCurrentRelease.inputRuns, 1);
  assert.equal(report.dailyCurrentRelease.completedRuns, 1);
  assert.equal(report.eventCounts.totalEventsToday, 6);
  assert.equal(report.status, "healthy");
});

test("emits budget, circuit, readiness, and source error alerts without treating no usage as failure", () => {
  const report = buildDailyMonitoringReport({
    events: [],
    sourceMetrics: Array.from({ length: 5 }, (_, index) => ({ source: "google_places", operation: "text_search", status: index ? "error" : "success", occurredAt: "2026-08-04T02:00:00.000Z" })),
    date: "2026-08-04",
    budgetState: { date: "2026-08-04", counts: { places_search: 9 } },
    budgetLimits,
    providerCircuit: { open: true, reason: "burst:google_places", degradedProviders: [{ provider: "google_places" }] },
    readiness: { ready: false, missing: ["places_search"] }
  });
  assert.equal(report.status, "critical");
  assert.ok(report.alerts.some((item) => item.code === "BUDGET_NEAR_LIMIT"));
  assert.ok(report.alerts.some((item) => item.code === "PROVIDER_CIRCUIT_OPEN"));
  assert.ok(report.alerts.some((item) => item.code === "SERVICE_NOT_READY"));
  assert.ok(report.alerts.some((item) => item.code === "SOURCE_ERROR_RATE_HIGH"));
  assert.ok(report.alerts.some((item) => item.code === "NO_LIVE_INPUT_TODAY"));
});

test("merges external health and Fly failures into a critical operator status", () => {
  const report = buildDailyMonitoringReport({ budgetState: { date: "2026-08-04", counts: {} }, budgetLimits });
  const merged = mergeExternalMonitoring(report, {
    http: { health: { ok: true }, ready: { ready: true }, capabilities: { providerCircuit: { open: false }, emergencyStop: false } },
    fly: { passed: false }
  });
  assert.equal(merged.status, "critical");
  assert.ok(merged.alerts.some((item) => item.code === "FLY_AUDIT_FAILED"));
});

test("writes a dated snapshot and keeps a latest pointer without exposing event details", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-monitoring-"));
  await writeMonitoringSnapshot(directory, { date: "2026-08-04", status: "healthy", dailyAllReleases: { inputRuns: 2 }, alerts: [] });
  const dated = JSON.parse(await readFile(join(directory, "2026-08-04.json"), "utf8"));
  const latest = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
  assert.deepEqual(latest, dated);
  assert.equal("events" in latest, false);
  assert.equal(dated.dailyAllReleases.inputRuns, 2);
});
