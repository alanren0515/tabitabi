import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormalReleaseGate } from "../server/formal-release-gate.mjs";

const now = Date.parse("2026-07-18T12:00:00.000Z");
const generatedAt = "2026-07-18T11:00:00.000Z";
const revision = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const imageTag = "deployment-01KXRBYNTMPKPM0CPT8YZHPFJW";
const pilotMetrics = { inputRuns: 20, feedbackRuns: 10, analysisCompletionRate: 0.8, actionRate: 0.35, helpfulRate: 0.6 };
const valid = {
  now,
  app: "tabitabi-jp",
  currentRevision: revision,
  repositoryClean: true,
  releaseEvidence: { generatedAt, revision, repositoryClean: true, gatePassed: true },
  pilotEvidence: { schemaVersion: 1, source: "fly-volume", app: "tabitabi-jp", volume: "tabitabi_data", generatedAt, auditRevision: revision, releaseRevision: revision, imageRef: `registry.fly.io/tabitabi-jp:${imageTag}`, repositoryClean: true, gatePassed: true, gates: { inputSample: true, feedbackSample: true, analysisCompletion: true, actionRate: true, helpfulRate: true }, blockedBy: [], metrics: pilotMetrics },
  preflightEvidence: { generatedAt, revision, repositoryClean: true, passed: true },
  flyEvidence: { generatedAt, revision, repositoryClean: true, app: "tabitabi-jp", passed: true, deployment: { machineUpdatedAt: "2026-07-18T10:00:00.000Z", imageDigest, imageTag } },
  smokeEvidence: { generatedAt, revision, releaseRevision: revision, repositoryClean: true, baseUrl: "https://tabitabi-jp.fly.dev", passed: true, live: false }
};

test("passes only when technical, pilot, deployment, Fly, and provider-free evidence all pass", () => {
  assert.equal(evaluateFormalReleaseGate(valid).gatePassed, true);
  const failed = evaluateFormalReleaseGate({ ...valid, pilotEvidence: { ...valid.pilotEvidence, gatePassed: false } });
  assert.deepEqual(failed.blockedBy, ["productionPilot"]);
});

test("rejects stale, wrong-app, or live provider smoke evidence", () => {
  assert.equal(evaluateFormalReleaseGate({ ...valid, flyEvidence: { ...valid.flyEvidence, app: "other" } }).gates.flyRemoteState, false);
  assert.equal(evaluateFormalReleaseGate({ ...valid, smokeEvidence: { ...valid.smokeEvidence, live: true } }).gates.providerFreeSmoke, false);
  const stale = { ...valid.preflightEvidence, generatedAt: "2026-07-16T00:00:00.000Z" };
  assert.equal(evaluateFormalReleaseGate({ ...valid, preflightEvidence: stale }).gates.deploymentPreflight, false);
});

test("reports real pilot deficits without treating zero as missing data", () => {
  const metrics = { inputRuns: 0, feedbackRuns: 0, analysisCompletionRate: null, actionRate: null, helpfulRate: null };
  const pilotEvidence = { ...valid.pilotEvidence, gatePassed: false, gates: { inputSample: false, feedbackSample: false, analysisCompletion: false, actionRate: false, helpfulRate: false }, blockedBy: ["inputSample", "feedbackSample", "analysisCompletion", "actionRate", "helpfulRate"], metrics };
  const report = evaluateFormalReleaseGate({ ...valid, pilotEvidence });
  assert.deepEqual(report.pilot, { inputRuns: 0, feedbackRuns: 0, actionRate: null, helpfulRate: null, pilotBlockedBy: pilotEvidence.blockedBy });
});

test("rejects a forged passing pilot and local-report provenance", () => {
  const forged = { ...valid.pilotEvidence, gatePassed: true, metrics: { inputRuns: 0, feedbackRuns: 0 } };
  assert.equal(evaluateFormalReleaseGate({ ...valid, pilotEvidence: forged }).gates.productionPilot, false);
  assert.equal(evaluateFormalReleaseGate({ ...valid, pilotEvidence: { ...valid.pilotEvidence, source: "local-events" } }).gates.productionPilot, false);
});

test("rejects mixed commits, mismatched images, dirty repositories, and pre-deploy evidence", () => {
  assert.equal(evaluateFormalReleaseGate({ ...valid, smokeEvidence: { ...valid.smokeEvidence, releaseRevision: "c".repeat(40) } }).gates.releaseRevision, false);
  assert.equal(evaluateFormalReleaseGate({ ...valid, pilotEvidence: { ...valid.pilotEvidence, imageRef: "registry.fly.io/tabitabi-jp@sha256:deadbeef" } }).gates.deployedImage, false);
  assert.equal(evaluateFormalReleaseGate({ ...valid, repositoryClean: false }).gates.repositoryClean, false);
  assert.equal(evaluateFormalReleaseGate({ ...valid, releaseEvidence: { ...valid.releaseEvidence, generatedAt: "2026-07-18T09:00:00.000Z" } }).gates.deployedImage, false);
});
