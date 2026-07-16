import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPilotReport } from "../server/pilot-report.mjs";

test("builds the current pilot report directly from the event log", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-pilot-report-"));
  const path = join(root, "events.jsonl");
  const events = [
    { event: "input_submitted", trafficType: "product", sourceMode: "live", analysisRunId: "run_live_001" },
    { event: "restaurant_identified", trafficType: "product", sourceMode: "live", analysisRunId: "run_live_001" },
    { event: "input_submitted", trafficType: "audit", sourceMode: "live", analysisRunId: "run_audit_001" }
  ];
  await writeFile(path, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);

  const report = await loadPilotReport(path, new Date("2026-07-16T00:00:00Z"));
  assert.equal(report.generatedAt, "2026-07-16T00:00:00.000Z");
  assert.equal(report.metrics.inputRuns, 1);
  assert.equal(report.metrics.identifiedRuns, 1);
  assert.equal(report.metrics.excludedAuditEvents, 1);
  assert.equal(report.gatePassed, false);
});

test("treats a missing event log as an empty pilot", async () => {
  const report = await loadPilotReport("/tmp/tabitabi-missing-event-log.jsonl", new Date("2026-07-16T00:00:00Z"));
  assert.equal(report.metrics.inputRuns, 0);
  assert.equal(report.metrics.feedbackRuns, 0);
});
