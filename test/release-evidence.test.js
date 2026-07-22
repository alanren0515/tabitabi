import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReleaseEvidence } from "../server/release-evidence.mjs";

const revision = "a".repeat(40);
const now = Date.parse("2026-07-23T00:00:00Z");
const cases = [{ id: "case-1", verificationStatus: "confirmed", officialSources: ["https://restaurant.example/"] }];
const matrix = [{ id: "cv-01", status: "confirmed", linkedCaseId: "case-1" }];
const audits = [{ caseId: "case-1", status: "audited", identification: "pass", branchCorrect: true, severeActionError: false, bookingSafety: "pass", mobileFlow: "pass", evidence: ["output/manual/case-1.png"], auditedAt: "2026-07-22T00:00:00Z" }];
const candidateResults = { generatedAt: "2026-07-22T23:00:00Z", releaseRevision: revision, cases: 1, verifiedCases: 1, top3Recall: 1, gatePassed: true, results: [{ id: "case-1", passed: true, matchedRank: 1 }] };
const decisionResults = { generatedAt: "2026-07-22T23:00:00Z", releaseRevision: revision, selectedCaseIds: ["case-1"], selectedCases: 1, evaluated: 1, candidateMatchPassed: 1, safeDecisionPassed: 1, errors: 0, gatePassed: true, results: [{ id: "case-1", candidateMatched: true, passed: true, selectedPlaceId: "place-1", detailsPlaceId: "place-1", issues: [] }] };
const testResults = { generatedAt: "2026-07-22T23:00:00Z", revision, repositoryClean: true, passed: true, tests: 300, failures: 0 };

test("requires clean current-revision test evidence even when historical product gates are incomplete", () => {
  const result = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults, decisionResults, testResults, revision, now });
  assert.equal(result.gates.currentRevisionTests, true);
  const dirty = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults, decisionResults, testResults: { ...testResults, repositoryClean: false }, revision, now });
  assert.equal(dirty.gates.currentRevisionTests, false);
  assert.ok(dirty.errors.some((item) => item.includes("clean repository")));
});
