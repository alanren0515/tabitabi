import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePublicLaunchGate } from "../server/public-launch-gate.mjs";

const now = Date.parse("2026-07-23T12:00:00.000Z");
const generatedAt = "2026-07-23T11:30:00.000Z";
const revision = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const valid = {
  now,
  app: "tabitabi-jp",
  currentRevision: revision,
  repositoryClean: true,
  formalEvidence: { generatedAt, repositoryClean: true, gatePassed: true, releaseId: `tabitabi-jp:${revision}:${imageDigest}` },
  publicSmokeEvidence: { generatedAt, revision, releaseRevision: revision, repositoryClean: true, releaseMode: "public", live: false, passed: true, checks: { health: true, readiness: true, capabilities: true, pilot: true, pilotContent: true, privacy: true, terms: true } },
  flyEvidence: { generatedAt, revision, repositoryClean: true, app: "tabitabi-jp", passed: true, checks: { exactlyOneMachine: true, healthChecksPassing: true, requiredSecretsDeployed: true }, deployment: { releaseCreatedAt: "2026-07-23T11:00:00.000Z", imageDigest } },
  legalReviewEvidence: { generatedAt, revision, approved: true, operatorName: "Ren", contactEmail: "rgq.alan515@gmail.com", scopes: ["terms", "privacy", "cross_border_processing"] },
  restoreDrillEvidence: { generatedAt, app: "tabitabi-jp", volume: "tabitabi_data", passed: true, checks: { snapshotAvailable: true, restoreCompleted: true, eventsReadable: true, budgetReadable: true, circuitStateReadable: true, noSecondProductionMachine: true } },
  alertingEvidence: { generatedAt, app: "tabitabi-jp", passed: true, checks: { flyRestartAlert: true, providerBudgetAlert: true, emergencyStopAlert: true, recipientVerified: true, drillDelivered: true } }
};

test("passes only with same-release public smoke, legal review, restore, and alert drills", () => {
  const report = evaluatePublicLaunchGate(valid);
  assert.equal(report.gatePassed, true);
  assert.deepEqual(report.blockedBy, []);
});

test("rejects a closed-pilot smoke report and missing operational evidence", () => {
  const report = evaluatePublicLaunchGate({ ...valid, publicSmokeEvidence: { ...valid.publicSmokeEvidence, releaseMode: "pilot" }, restoreDrillEvidence: null });
  assert.ok(report.blockedBy.includes("publicDeployment"));
  assert.ok(report.blockedBy.includes("restoreDrill"));
});

test("rejects mismatched code or a public smoke that predates activation", () => {
  const wrongRevision = evaluatePublicLaunchGate({ ...valid, legalReviewEvidence: { ...valid.legalReviewEvidence, revision: "c".repeat(40) } });
  assert.equal(wrongRevision.gates.sameRelease, false);
  const oldSmoke = evaluatePublicLaunchGate({ ...valid, publicSmokeEvidence: { ...valid.publicSmokeEvidence, generatedAt: "2026-07-23T10:00:00.000Z" } });
  assert.equal(oldSmoke.gates.publicDeployment, false);
});
