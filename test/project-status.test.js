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

test("does not use local pilot evidence when the remote report is missing", () => {
  const selected = selectCurrentPilotReport({
    localReport: { source: "local", metrics: { inputRuns: 7, feedbackRuns: 2 } },
    revision: "a".repeat(40)
  });
  assert.equal(selected.reportStatus, "unavailable");
  assert.equal(selected.reportSource, "remote");
  assert.equal(selected.metrics, null);
  assert.match(selected.note, /尚未取得远端试点报告/);
  assert.match(selected.note, /不代表今天没有用户使用/);
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
  assert.equal(status.pilotReportNote, "尚未取得远端试点报告；当前试点件数不明，不代表今天没有用户使用。");
});

test("does not present stale local monitoring alerts as a current production failure", () => {
  const now = new Date("2026-09-09T12:00:00+09:00");
  const summary = summarizeMonitoringReport({
    status: "critical",
    date: "2026-08-27",
    generatedAt: "2026-08-27T10:00:00+09:00",
    alerts: [
      { severity: "critical", code: "HEALTH_CHECK_FAILED" },
      { severity: "critical", code: "FLY_AUDIT_FAILED" }
    ]
  }, now);

  assert.equal(summary.status, "stale");
  assert.equal(summary.reportedStatus, "critical");
  assert.equal(summary.freshness, "stale");
  assert.deepEqual(summary.alerts, { total: 0, critical: 0, warning: 0, info: 0 });
  assert.deepEqual(summary.historicalAlerts, { total: 2, critical: 2, warning: 0, info: 0 });
  assert.match(summary.note, /不代表当前生产故障/);
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
