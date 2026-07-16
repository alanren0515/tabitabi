import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("summarizes post-confirmation latency and candidate preview usage", () => {
  const directory = mkdtempSync(join(tmpdir(), "tabitabi-metrics-"));
  try {
    mkdirSync(join(directory, "data"));
    const events = [
      { event: "input_submitted", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live" },
      { event: "restaurant_identified", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live" },
      { event: "candidate_confirmed", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live", selectedRank: 1 },
      { event: "analysis_completed", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live", analysisDurationMs: 10_000 },
      { event: "primary_action_clicked", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live" },
      { event: "primary_action_clicked", analysisRunId: "live_0001", trafficType: "product", sourceMode: "live" },
      { event: "input_submitted", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live" },
      { event: "restaurant_identified", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live" },
      { event: "analysis_completed", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live", analysisDurationMs: 40_000 },
      { event: "candidate_preview_requested", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live" },
      { event: "candidate_preview_requested", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live" },
      { event: "candidate_preview_loaded", analysisRunId: "live_0002", trafficType: "product", sourceMode: "live", cacheStatus: "hit" },
      { event: "input_submitted", analysisRunId: "mixed_01", trafficType: "product", sourceMode: "live" },
      { event: "restaurant_identified", analysisRunId: "mixed_01", trafficType: "product", sourceMode: "demo" },
      { event: "analysis_completed", analysisRunId: "mixed_01", trafficType: "product", sourceMode: "live", analysisDurationMs: 1_000 },
      { event: "analysis_completed", analysisRunId: "audit_01", trafficType: "audit", sourceMode: "live", analysisDurationMs: 1_000 },
      { event: "analysis_completed", analysisRunId: "legacy_1", sourceMode: "live", analysisDurationMs: 1_000 }
    ];
    writeFileSync(join(directory, "data/events.jsonl"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
    writeFileSync(join(directory, "data/source-metrics.jsonl"), "");

    const result = spawnSync(process.execPath, [resolve("scripts/summarize-metrics.mjs")], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.funnel.liveAnalysisLatencySamples, 2);
    assert.equal(summary.funnel.averagePostConfirmationAnalysisMs, 25_000);
    assert.equal(summary.funnel.p95PostConfirmationAnalysisMs, 40_000);
    assert.equal(summary.funnel.analysisUnder30SecondsRate, 0.5);
    assert.equal(summary.funnel.candidatePreviewLoadRate, 0.5);
    assert.equal(summary.funnel.candidatePreviewCacheHits, 1);
    assert.equal(summary.funnel.inputsSubmitted, 2);
    assert.equal(summary.funnel.primaryActionsClicked, 1);
    assert.equal(summary.funnel.actionRate, 0.5);
    assert.equal(summary.funnel.excludedDemoRuns, 1);
    assert.equal(summary.funnel.excludedAuditEvents, 1);
    assert.equal(summary.funnel.excludedLegacyEvents, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
