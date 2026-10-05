import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { summarizeCommercialMetrics } from "../server/commercial-metrics.mjs";
import { fixture, syntheticFixture, DAY, ANCHOR, AS_OF, REVISION, OTHER_REVISION } from "../eval/commercial/fixtures/scenarios.mjs";

const summary = (f, now = AS_OF) => summarizeCommercialMetrics(f.state, { now, releaseRevision: REVISION });

test("R7 includes exactly 24h and 7d, deduplicates devices, and requires maturity", () => {
  for (const offset of [DAY - 1, DAY, 7 * DAY, 7 * DAY + 1]) {
    const f = fixture(); const d = f.device();
    f.analysis(d, ANCHOR); f.analysis(d, ANCHOR + offset); f.analysis(d, ANCHOR + offset + 1);
    // The second completion is outside the boundary in the 24h-1 case; use only the first.
    f.state.events.splice(-2); f.state.researchLinks.splice(-2);
    const result = summary(f, ANCHOR + 7 * DAY);
    assert.equal(result.r7.matureDevices, 1);
    assert.equal(result.r7.retainedDevices, [DAY, 7 * DAY].includes(offset) ? 1 : 0);
  }
  const f = fixture(); const d = f.device();
  f.analysis(d, ANCHOR); f.analysis(d, ANCHOR + DAY); f.review(d, ANCHOR + 2 * DAY);
  assert.equal(summary(f, ANCHOR + 7 * DAY - 1).r7.rate, null);
  assert.equal(summary(f).r7.retainedDevices, 1);
});

test("same session, original batch, duplicate analysis, failures, and passive reviews are not reuse", () => {
  for (const kind of ["session", "batch", "run", "failed", "history_open", "automatic", "unknown"]) {
    const f = fixture(); const d = f.device(); const batchId = f.nextId();
    const anchor = f.analysis(d, ANCHOR, { batchId });
    if (["history_open", "automatic", "unknown"].includes(kind)) f.review(d, ANCHOR + 2 * DAY, { reviewIntent: kind });
    else f.analysis(d, ANCHOR + 2 * DAY, { ...(kind === "session" ? { sessionId: anchor.sessionId } : {}),
      ...(kind === "batch" ? { batchId } : {}), ...(kind === "run" ? { analysisRunId: anchor.analysisRunId } : {}), failed: kind === "failed" });
    assert.equal(summary(f).r7.rate, 0, kind);
  }
});

test("review is only a return and never creates the initial anchor", () => {
  const f = fixture(); const d = f.device();
  f.review(d, ANCHOR); f.analysis(d, ANCHOR + 5 * DAY);
  assert.equal(summary(f).r7.matureDevices, 0);
  const g = fixture(); const e = g.device();
  g.analysis(e, ANCHOR); g.review(e, ANCHOR + DAY);
  assert.equal(summary(g).r7.rate, 1);
  assert.equal(summary(g).funnel.completedRuns, 1);
});

test("source, mode and revision eligibility cannot be supplied by a different event in a flow", () => {
  for (const override of [{ sourceMode: "demo" }, { trafficType: "audit" }, { sourceMode: "unknown" }, { releaseRevision: OTHER_REVISION }]) {
    const f = fixture(); const d = f.device(); const a = f.analysis(d, ANCHOR);
    f.event(d, ANCHOR + 1, "analysis_started", { analysisRunId: a.analysisRunId, ...override });
    assert.equal(summary(f).funnel.inputRuns, 0);
    assert.equal(summary(f).r7.matureDevices, 0);
  }
  for (const researchSource of ["unknown", "benchmark", "assigned_task", "incentivized", "reminded"]) {
    const f = fixture(); const d = f.device(); f.analysis(d, ANCHOR, { researchSource });
    assert.equal(summary(f).r7.matureDevices, 0);
    assert.equal(summary(f).funnel.completedRuns, 1);
  }
  const f = fixture(); const d = f.device();
  f.analysis(d, ANCHOR, { releaseRevision: OTHER_REVISION }); f.analysis(d, ANCHOR + 5 * DAY);
  assert.equal(summary(f).r7.matureDevices, 0);
});

test("consent must be current, valid, linked and cover the entire closed observation window", () => {
  for (const status of ["revoked", "expired"]) {
    const f = fixture(); const d = f.device({ status }); f.analysis(d, ANCHOR);
    assert.equal(summary(f).r7.matureDevices, 0);
  }
  const f = fixture(); const d = f.device({ granted: ANCHOR - 23 * DAY }); f.analysis(d, ANCHOR);
  assert.equal(summary(f, ANCHOR + DAY).r7.exclusions.consentWindowIncompleteDevices, 1);
  assert.equal(summary(f).r7.matureDevices, 0);
  const g = fixture(); const e = g.device({ granted: ANCHOR + DAY });
  g.analysis(e, ANCHOR); g.analysis(e, ANCHOR + 2 * DAY); g.analysis(e, ANCHOR + 3 * DAY);
  assert.equal(summary(g).r7.observedAnchorDevices, 1);
  assert.equal(summary(g).r7.rate, 1);
  g.state.researchLinks = [];
  assert.equal(summary(g).r7.rate, null);
});

test("duplicate events and links cannot inflate counts; conflicting duplicate IDs fail closed", () => {
  const f = fixture(); const d = f.device(); f.analysis(d, ANCHOR); f.analysis(d, ANCHOR + DAY);
  const baseline = summary(f);
  f.state.events.push(...structuredClone(f.state.events)); f.state.researchLinks.push(...structuredClone(f.state.researchLinks));
  assert.deepEqual(summary(f).funnel, baseline.funnel);
  assert.deepEqual(summary(f).r7, baseline.r7);
  f.state.events.at(-1).record.researchSource = "reminded";
  assert.equal(summary(f).exclusions.conflictingEventIds, 1);
  assert.equal(summary(f).r7.rate, 0);
});

test("channel slices require 5 unique consenting devices, never repeated events", () => {
  const f = fixture();
  for (let index = 0; index < 4; index++) {
    const d = f.device(); f.analysis(d, ANCHOR);
    for (let repeat = 0; repeat < 5; repeat++) f.review(d, ANCHOR + DAY);
  }
  assert.deepEqual(summary(f).slices.channel.direct, { suppressed: true, reason: "fewer_than_5_consented_devices" });
  f.analysis(f.device(), ANCHOR);
  assert.equal(summary(f).slices.channel.direct.consentedDevices, 5);
  assert.equal(summary(f).slices.channel.direct.suppressed, false);
  f.analysis(null, ANCHOR);
  assert.equal(summary(f).slices.channel.unknown.suppressed, true);
});

test("funnel uses input/completion intersections; bookings are distinct from maps and reviews", () => {
  const f = fixture(); const d = f.device(); const a = f.analysis(d, ANCHOR);
  f.analysis(d, ANCHOR + DAY, { failed: true });
  for (const actionCapability of ["map", "direct_booking", "platform_booking", "phone"]) {
    f.event(d, ANCHOR + 1, "primary_action_clicked", { analysisRunId: a.analysisRunId, sessionId: a.sessionId, actionCapability });
  }
  const r = f.review(d, ANCHOR + 2 * DAY);
  f.event(d, ANCHOR + 2 * DAY + 1, "primary_action_clicked", { interactionId: r.interactionId, actionCapability: "direct_booking" });
  const result = summary(f);
  assert.equal(result.funnel.completionRate, 0.5);
  assert.equal(result.funnel.actionRuns, 1);
  assert.equal(result.funnel.bookingOutboundRuns, 1);
  assert.equal(result.funnel.failedRuns, 1);
  assert.equal(result.coverage.researchLinkedInputRunRate, 1);
});

test("aggregation is explicit, pure, identifier-free, and returns null for zero denominators", () => {
  const f = fixture(); const before = structuredClone(f.state);
  assert.throws(() => summarizeCommercialMetrics(f.state), /AS_OF_REQUIRED/);
  assert.throws(() => summarizeCommercialMetrics(f.state, { now: AS_OF }), /REVISION_REQUIRED/);
  assert.equal(summary(f).funnel.completionRate, null);
  assert.equal(summary(f).r7.rate, null);
  assert.deepEqual(f.state, before);
  const d = f.device(); const event = f.analysis(d, ANCHOR);
  const output = JSON.stringify(summary(f));
  for (const identifier of [d.deviceId, d.grantKey, event.eventId, event.analysisRunId, event.sessionId]) assert.equal(output.includes(identifier), false);
});

test("checked-in fixture matches generator and CLI defaults only to fixture evidence", async () => {
  const expected = syntheticFixture();
  assert.deepEqual(JSON.parse(await readFile(new URL("../eval/commercial/fixtures/synthetic.json", import.meta.url), "utf8")), expected);
  const output = JSON.parse(execFileSync(process.execPath, ["scripts/summarize-commercial.mjs"], { encoding: "utf8" }));
  assert.equal(output.evidenceType, "fixture_only");
  assert.equal(output.realWorldEvidence, false);
  assert.equal(output.r7.matureDevices, 6);
  assert.equal(output.r7.retainedDevices, 2);
  const missing = spawnSync(process.execPath, ["scripts/summarize-commercial.mjs", "--input", "/should-not-be-read"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /EXPLICIT_INPUT_AS_OF_AND_REVISION_REQUIRED/);
  assert.equal(missing.stderr.includes("/should-not-be-read"), false);
});

test("a reminder signal disqualifies the whole flow from natural retention", () => {
  const f = fixture(); const d = f.device(); const a = f.analysis(d, ANCHOR);
  f.event(d, ANCHOR + 1, "analysis_started", { analysisRunId: a.analysisRunId, researchSource: "reminded" });
  assert.equal(summary(f).r7.matureDevices, 0);
  assert.equal(summary(f).funnel.completedRuns, 1);
});
