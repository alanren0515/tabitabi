import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectStatus, selectCurrentPilotReport, summarizeMonitoringReport } from "../server/project-status.mjs";

test("uses Fly pilot evidence only when it belongs to the current revision", () => {
  const revision = "a".repeat(40);
  const localReport = { source: "local", metrics: { inputRuns: 7, feedbackRuns: 2 } };
  const remoteReport = { source: "fly-volume", releaseRevision: revision, metrics: { inputRuns: 0, feedbackRuns: 0 } };
  assert.equal(selectCurrentPilotReport({ remoteReport, localReport, revision }).reportStatus, "available");
  assert.equal(selectCurrentPilotReport({ remoteReport: { ...remoteReport, releaseRevision: "b".repeat(40) }, localReport, revision }).reportStatus, "stale");
  assert.equal(selectCurrentPilotReport({ remoteReport: { ...remoteReport, source: "local" }, localReport, revision }).reportStatus, "unavailable");
});

test("reports provider booleans and concrete remaining external evidence without secrets", () => {
  const cases = Array.from({ length: 33 }, (_, index) => ({ id: `case-${index}`, verificationStatus: "confirmed" }));
  const audits = [...Array.from({ length: 5 }, (_, index) => ({ caseId: `case-${index}`, status: "audited" })), ...Array.from({ length: 3 }, (_, index) => ({ caseId: `decision-${index}`, status: "decision_audited" }))];
  const matrix = Array.from({ length: 30 }, (_, index) => ({ id: `cv-${index}`, status: index < 21 ? "confirmed" : "planned" }));
  const status = buildProjectStatus({
    providers: { qwenVision: "secret", googlePlaces: "secret", hotPepper: "secret", openAiFallback: "" }, cases, audits, matrix,
    candidateReport: { top3Recall: 1 }, decisionReport: { safeDecisionPassed: 33 }, pilotReport: { reportStatus: "available", gatePassed: false, metrics: { inputRuns: 0, feedbackRuns: 0 } }
  });
  assert.equal(status.status, "external_evidence_required");
  assert.equal(status.pilotReportStatus, "available");
  assert.deepEqual(status.providers, { qwenVision: true, googlePlaces: true, hotPepper: true, openAiFallback: false });
  assert.deepEqual(status.remaining, { mobileAudits: 25, riskScenarios: 9, liveInputRuns: 20, feedbackRuns: 10 });
  assert.deepEqual(status.nextCommands, ["npm run audit:mobile", "npm run eval:release-gate"]);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("does not report zero pilot usage when the remote report is unavailable", () => {
  const status = buildProjectStatus({
    pilotReport: { reportStatus: "unavailable", metrics: null },
    cases: [], audits: [], matrix: [], candidateReport: null, decisionReport: null, testReport: null, revision: ""
  });
  assert.equal(status.evaluation.pilotInputRuns, null);
  assert.equal(status.evaluation.pilotFeedbackRuns, null);
  assert.deepEqual(status.remaining, { mobileAudits: 30, riskScenarios: 30, liveInputRuns: null, feedbackRuns: null });
  assert.deepEqual(status.nextCommands, ["npm run release:pilot-remote"]);
});

test("reports daily monitoring separately from release readiness and marks stale reports", () => {
  const now = new Date("2026-08-04T12:00:00+09:00");
  const report = {
    status: "warning",
    date: "2026-08-04",
    generatedAt: "2026-08-04T09:00:00+09:00",
    dailyAllReleases: { inputRuns: 4, feedbackRuns: 2, analysisCompletedRuns: 3, primaryActionRuns: 1 },
    dailyCurrentRelease: { inputRuns: 1, feedbackRuns: 1, analysisCompletedRuns: 1, primaryActionRuns: 0 },
    alerts: [{ severity: "warning" }, { severity: "info" }]
  };
  const summary = summarizeMonitoringReport(report, now);
  assert.equal(summary.status, "warning");
  assert.equal(summary.freshness, "fresh");
  assert.deepEqual(summary.alerts, { total: 2, critical: 0, warning: 1, info: 1 });
  assert.deepEqual(summary.dailyAllReleases, { inputRuns: 4, feedbackRuns: 2, analysisCompletedRuns: 3, primaryActionRuns: 1 });
  assert.equal(summarizeMonitoringReport({ ...report, generatedAt: "2026-08-02T09:00:00+09:00" }, now).freshness, "stale");
  const status = buildProjectStatus({ monitoringReport: report, now, pilotReport: { reportStatus: "unavailable", metrics: null } });
  assert.equal(status.monitoring.status, "warning");
  assert.equal(status.monitoring.dailyAllReleases.inputRuns, 4);
});

test("becomes ready only after release evidence and pilot thresholds pass", () => {
  const revision = "a".repeat(40);
  const cases = Array.from({ length: 30 }, (_, index) => ({ id: `case-${index}`, verificationStatus: "confirmed", officialSources: ["https://example.com"] }));
  const audits = cases.map((item) => ({ caseId: item.id, status: "audited", evidence: ["output/result.png"], identification: "pass", branchCorrect: true, severeActionError: false, bookingSafety: "pass", mobileFlow: "pass", auditedAt: new Date().toISOString() }));
  const matrix = cases.map((item, index) => ({ id: `cv-${index}`, status: "confirmed", linkedCaseId: item.id }));
  const selectedCaseIds = cases.map((item) => item.id);
  const decisionReport = { generatedAt: new Date().toISOString(), releaseRevision: revision, selectedCaseIds, selectedCases: 30, evaluated: 30, candidateMatchPassed: 30, safeDecisionPassed: 30, errors: 0, gatePassed: true, results: selectedCaseIds.map((id) => ({ id, candidateMatched: true, passed: true, selectedPlaceId: `place-${id}`, detailsPlaceId: `place-${id}`, issues: [] })) };
  const candidateReport = { generatedAt: new Date().toISOString(), releaseRevision: revision, cases: 30, verifiedCases: 30, top3Recall: 0.95, gatePassed: true, results: selectedCaseIds.map((id) => ({ id, passed: true, matchedRank: 1 })) };
  const testReport = { generatedAt: new Date().toISOString(), revision, repositoryClean: true, passed: true, tests: 300, failures: 0 };
  const status = buildProjectStatus({ providers: { qwenVision: true, googlePlaces: true }, cases, audits, matrix, candidateReport, decisionReport, testReport, revision, pilotReport: { gatePassed: true, metrics: { inputRuns: 20, feedbackRuns: 10 } } });
  assert.equal(status.status, "ready");
  assert.deepEqual(status.remaining, { mobileAudits: 0, riskScenarios: 0, liveInputRuns: 0, feedbackRuns: 0 });
});
