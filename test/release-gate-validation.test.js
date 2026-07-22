import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidateEvalReport, validateDecisionEvalReport, validateReleaseInputs } from "../server/eval-validation.mjs";

const cases = [{ id: "case-1", verificationStatus: "confirmed", officialSources: ["https://restaurant.example/"] }];
const matrix = [{ id: "cv-01", status: "confirmed", linkedCaseId: "case-1" }];
const audit = { caseId: "case-1", status: "audited", identification: "pass", branchCorrect: true, severeActionError: false, bookingSafety: "pass", mobileFlow: "pass", evidence: ["output/manual/case-1.png"], auditedAt: "2026-07-13T00:00:00Z" };

test("accepts a complete release-audit record", () => {
  assert.deepEqual(validateReleaseInputs({ cases, matrix, audits: [audit] }), []);
});

test("rejects contradictory mobile statuses and duplicate audits", () => {
  const errors = validateReleaseInputs({ cases, matrix, audits: [{ ...audit, status: "audited", mobileFlow: "pending" }, audit] });
  assert.ok(errors.some((item) => item.includes("completed mobile flow")));
  assert.ok(errors.some((item) => item.includes("duplicate audit")));
});

test("rejects unsupported evidence-free manual claims", () => {
  const errors = validateReleaseInputs({ cases, matrix, audits: [{ ...audit, evidence: [], branchCorrect: null, auditedAt: "not-a-date" }] });
  assert.ok(errors.some((item) => item.includes("evidence")));
  assert.ok(errors.some((item) => item.includes("branchCorrect")));
  assert.ok(errors.some((item) => item.includes("auditedAt")));
});

test("accepts a fresh complete decision evaluation report for every confirmed case", () => {
  const report = {
    generatedAt: "2026-07-14T00:00:00Z",
    selectedCaseIds: ["case-1"],
    selectedCases: 1,
    evaluated: 1,
    candidateMatchPassed: 1,
    safeDecisionPassed: 1,
    errors: 0,
    gatePassed: true,
    results: [{ id: "case-1", candidateMatched: true, passed: true, selectedPlaceId: "place-1", detailsPlaceId: "place-1", issues: [] }]
  };
  assert.deepEqual(validateDecisionEvalReport({ report, cases, now: new Date("2026-07-14T01:00:00Z").valueOf() }), []);
});

test("rejects stale, partial, mismatched, or failed decision evaluation evidence", () => {
  const report = {
    generatedAt: "2026-06-01T00:00:00Z",
    selectedCaseIds: [],
    selectedCases: 0,
    evaluated: 1,
    candidateMatchPassed: 1,
    safeDecisionPassed: 0,
    errors: 0,
    gatePassed: true,
    results: [{ id: "case-1", candidateMatched: true, passed: false, selectedPlaceId: "place-1", detailsPlaceId: "place-2", issues: ["unsafe"] }]
  };
  const errors = validateDecisionEvalReport({ report, cases, now: new Date("2026-07-14T01:00:00Z").valueOf() });
  assert.ok(errors.some((item) => item.includes("stale")));
  assert.ok(errors.some((item) => item.includes("cover every confirmed case")));
  assert.ok(errors.some((item) => item.includes("decision failures")));
  assert.ok(errors.some((item) => item.includes("result failed")));
  assert.ok(errors.some((item) => item.includes("place id")));
});

test("accepts only a fresh candidate report covering every confirmed case", () => {
  const report = { generatedAt: "2026-07-14T00:00:00Z", cases: 1, verifiedCases: 1, top3Recall: 1, gatePassed: true, results: [{ id: "case-1", passed: true, matchedRank: 1 }] };
  assert.deepEqual(validateCandidateEvalReport({ report, cases, now: new Date("2026-07-14T01:00:00Z").valueOf() }), []);
  const errors = validateCandidateEvalReport({ report: { ...report, generatedAt: "2026-06-01T00:00:00Z", results: [{ id: "other", passed: false, matchedRank: 4 }] }, cases, now: new Date("2026-07-14T01:00:00Z").valueOf() });
  assert.ok(errors.some((item) => item.includes("stale")));
  assert.ok(errors.some((item) => item.includes("do not match")));
  assert.ok(errors.some((item) => item.includes("did not pass")));
  assert.ok(validateCandidateEvalReport({ report: { ...report, results: [{ id: "case-1", passed: true, matchedRank: 0 }] }, cases, now: new Date("2026-07-14T01:00:00Z").valueOf() }).some((item) => item.includes("did not pass")));
});

test("binds candidate and decision evidence to the evaluated release revision", () => {
  const revision = "a".repeat(40);
  const candidate = { generatedAt: "2026-07-14T00:00:00Z", releaseRevision: revision, cases: 1, verifiedCases: 1, top3Recall: 1, gatePassed: true, results: [{ id: "case-1", passed: true, matchedRank: 1 }] };
  const decision = { generatedAt: "2026-07-14T00:00:00Z", releaseRevision: revision, selectedCaseIds: ["case-1"], selectedCases: 1, evaluated: 1, candidateMatchPassed: 1, safeDecisionPassed: 1, errors: 0, gatePassed: true, results: [{ id: "case-1", candidateMatched: true, passed: true, selectedPlaceId: "place-1", detailsPlaceId: "place-1", issues: [] }] };
  const now = new Date("2026-07-14T01:00:00Z").valueOf();
  assert.deepEqual(validateCandidateEvalReport({ report: candidate, cases, now, expectedRevision: revision }), []);
  assert.deepEqual(validateDecisionEvalReport({ report: decision, cases, now, expectedRevision: revision }), []);
  assert.ok(validateCandidateEvalReport({ report: candidate, cases, now, expectedRevision: "b".repeat(40) }).some((item) => item.includes("different release")));
  assert.ok(validateDecisionEvalReport({ report: decision, cases, now, expectedRevision: "b".repeat(40) }).some((item) => item.includes("different release")));
});
