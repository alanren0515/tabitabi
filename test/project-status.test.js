import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectStatus } from "../server/project-status.mjs";

test("reports provider booleans and concrete remaining external evidence without secrets", () => {
  const cases = Array.from({ length: 33 }, (_, index) => ({ id: `case-${index}`, verificationStatus: "confirmed" }));
  const audits = [...Array.from({ length: 5 }, (_, index) => ({ caseId: `case-${index}`, status: "audited" })), ...Array.from({ length: 3 }, (_, index) => ({ caseId: `decision-${index}`, status: "decision_audited" }))];
  const matrix = Array.from({ length: 30 }, (_, index) => ({ id: `cv-${index}`, status: index < 21 ? "confirmed" : "planned" }));
  const status = buildProjectStatus({
    providers: { qwenVision: "secret", googlePlaces: "secret", hotPepper: "secret", openAiFallback: "" }, cases, audits, matrix,
    candidateReport: { top3Recall: 1 }, decisionReport: { safeDecisionPassed: 33 }, pilotReport: { gatePassed: false, metrics: { inputRuns: 0, feedbackRuns: 0 } }
  });
  assert.equal(status.status, "external_evidence_required");
  assert.deepEqual(status.providers, { qwenVision: true, googlePlaces: true, hotPepper: true, openAiFallback: false });
  assert.deepEqual(status.remaining, { mobileAudits: 25, riskScenarios: 9, liveInputRuns: 20, feedbackRuns: 10 });
  assert.deepEqual(status.nextCommands, ["npm run audit:mobile", "npm run eval:release-gate"]);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("becomes ready only after release evidence and pilot thresholds pass", () => {
  const cases = Array.from({ length: 30 }, (_, index) => ({ id: `case-${index}`, verificationStatus: "confirmed", officialSources: ["https://example.com"] }));
  const audits = cases.map((item) => ({ caseId: item.id, status: "audited", evidence: ["output/result.png"], identification: "pass", branchCorrect: true, severeActionError: false, bookingSafety: "pass", mobileFlow: "pass", auditedAt: new Date().toISOString() }));
  const matrix = cases.map((item, index) => ({ id: `cv-${index}`, status: "confirmed", linkedCaseId: item.id }));
  const selectedCaseIds = cases.map((item) => item.id);
  const decisionReport = { generatedAt: new Date().toISOString(), selectedCaseIds, selectedCases: 30, evaluated: 30, candidateMatchPassed: 30, safeDecisionPassed: 30, errors: 0, gatePassed: true, results: selectedCaseIds.map((id) => ({ id, candidateMatched: true, passed: true, selectedPlaceId: `place-${id}`, detailsPlaceId: `place-${id}`, issues: [] })) };
  const candidateReport = { generatedAt: new Date().toISOString(), cases: 30, verifiedCases: 30, top3Recall: 0.95, gatePassed: true, results: selectedCaseIds.map((id) => ({ id, passed: true, matchedRank: 1 })) };
  const status = buildProjectStatus({ providers: { qwenVision: true, googlePlaces: true }, cases, audits, matrix, candidateReport, decisionReport, pilotReport: { gatePassed: true, metrics: { inputRuns: 20, feedbackRuns: 10 } } });
  assert.equal(status.status, "ready");
  assert.deepEqual(status.remaining, { mobileAudits: 0, riskScenarios: 0, liveInputRuns: 0, feedbackRuns: 0 });
});
