import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { benchmarkTime, validateBenchmark } from "../server/benchmark-protocol.mjs";
import { summarizeBenchmark } from "../server/benchmark-summary.mjs";

const run = promisify(execFile);
const fixture = JSON.parse(await readFile(new URL("../eval/benchmark/fixtures/synthetic-study.json", import.meta.url), "utf8"));
const fresh = () => structuredClone(fixture);
// Test-only human-shaped records. A stubbed archive result verifies logic, not a real study.
function humanShaped() {
  const study = fresh();
  study.studyMode = "real";
  study.protocol.evidenceClass = "human_study";
  for (const truth of study.groundTruth) {
    truth.evidenceClass = "human_study";
    truth.verification.method = "human";
    for (const source of truth.verification.sources) {
      source.kind = "human_confirmation";
      source.evidenceRef = "controlled/test-only-reference";
    }
  }
  for (const attempt of study.attempts) attempt.evidenceClass = "human_study";
  return study;
}
const summarize = (study) => summarizeBenchmark(study, { baselineVerification: { valid: true } });
function duration(attempt, seconds) { attempt.endedAt = new Date(Date.parse(attempt.startedAt) + seconds * 1000).toISOString(); }

test("default fixture covers 30 cases and 90 assignments but can never establish GQ", () => {
  assert.equal(validateBenchmark(fresh()).valid, true);
  const report = summarize(fresh());
  assert.equal(report.gq.status, "fixture_only");
  assert.equal(report.gq.passed, false);
  assert.equal(report.counts.uniqueCases, 30);
  assert.equal(report.counts.totalAssignedTasks, 90);
  assert.equal(report.routes.candidate.correctCompletionRate, 1);
  assert.equal(report.comparison.successMedianTimeReductionVsPrimaryReference, 0.4);
});

test("real-shaped data requires independent baseline filesystem proof", () => {
  assert.equal(summarizeBenchmark(humanShaped()).gq.status, "insufficient_evidence");
  assert.equal(summarize(humanShaped()).gq.status, "pass");
  const mislabeled = fresh();
  mislabeled.studyMode = "real";
  assert.equal(summarize(mislabeled).gq.status, "insufficient_evidence");
});

test("all failures preserve denominators and undefined success time", () => {
  const study = humanShaped();
  for (const attempt of study.attempts) attempt.terminal = "abandoned";
  const report = summarize(study);
  assert.equal(report.routes.candidate.correctCompletionRate, 0);
  assert.equal(report.routes.candidate.expectedValidAssignments, 30);
  assert.equal(report.routes.candidate.terminalCounts.abandoned, 30);
  assert.equal(report.routes.candidate.successDurationSeconds.median, null);
  assert.equal(report.comparison.successMedianTimeReductionVsPrimaryReference, null);
  assert.equal(report.gq.passed, false);
});

test("abstaining on every actionable case cannot pass using faster justified unknowns", () => {
  const study = humanShaped();
  for (const attempt of study.attempts) if (attempt.terminal === "correct_action") attempt.terminal = "incorrect_unknown";
  const report = summarize(study);
  assert.equal(report.validation.valid, true);
  assert.equal(report.routes.candidate.correctCompletionRate, 5 / 30);
  assert.equal(report.routes.candidate.actionableResolutionRate, 0);
  assert.equal(report.comparison.timeImprovementPath, true);
  assert.equal(report.gq.status, "not_passed");
});

test("unsupported unknown labels and wrong-branch unknowns do not count as correct", () => {
  const study = humanShaped();
  study.attempts[0].terminal = "justified_unknown";
  study.attempts.at(-1).selectedBranchId = "branch-wrong";
  const report = summarize(study);
  assert.equal(report.validation.valid, false);
  assert.equal(report.gq.status, "insufficient_evidence");
  assert.equal(report.routes.baseline.correctCompletions, 29);
});

test("fast unsafe answers and lower completion cannot pass the time improvement path", () => {
  for (const terminal of ["unsafe_action", "wrong_branch", "abandoned"]) {
    const study = humanShaped();
    study.attempts.find((attempt) => attempt.route === "candidate").terminal = terminal;
    const report = summarize(study);
    assert.equal(report.comparison.timeImprovementPath, true);
    assert.equal(report.gq.status, "not_passed");
  }
});

test("same critical-error totals on different cases still count as new critical errors", () => {
  const study = humanShaped();
  study.attempts.find((a) => a.route === "baseline").terminal = "wrong_branch";
  study.attempts.find((a) => a.route === "primaryReference").terminal = "wrong_branch";
  study.attempts.find((a) => a.route === "candidate" && a.caseId === study.groundTruth[1].caseId).terminal = "wrong_branch";
  const report = summarize(study);
  assert.equal(report.comparison.versusBaseline.correctCompletionNonDecreasing, true);
  assert.equal(report.comparison.versusBaseline.newWrongBranchCaseCount, 1);
  assert.equal(report.gq.status, "not_passed");
});

test("hard-case error reduction may pass without a median speed improvement", () => {
  const study = humanShaped();
  const hard = study.groundTruth.find((truth) => truth.stratum === "hard");
  for (const attempt of study.attempts) {
    if (attempt.route === "candidate") duration(attempt, 100);
    else if (attempt.caseId === hard.caseId) attempt.terminal = "unsafe_action";
  }
  const report = summarize(study);
  assert.equal(report.comparison.timeImprovementPath, false);
  assert.equal(report.comparison.hardErrorImprovementPath, true);
  assert.equal(report.gq.status, "pass");
});

test("missing, duplicated and mixed-version attempts never disappear from the denominator", () => {
  const mutations = [
    (s) => { delete s.attempts[0].endedAt; },
    (s) => { s.attempts.splice(0, 1); },
    (s) => { s.attempts.push(structuredClone(s.attempts[0])); },
    (s) => { s.attempts[0].protocolVersion = "other-version"; },
    (s) => { s.attempts[0].groundTruthVersion = "other-version"; },
    (s) => { s.attempts[0].revision = "c".repeat(40); },
    (s) => { s.protocol.status = "draft"; }
  ];
  for (const mutate of mutations) {
    const study = humanShaped(); mutate(study);
    const report = summarize(study);
    assert.equal(report.gq.status, "insufficient_evidence");
    assert.equal(report.counts.expectedValidAssignments, 90);
    assert.ok(report.routes.baseline.correctCompletionRate <= 1);
  }
  const incompleteFixture = fresh(); delete incompleteFixture.attempts[0].endedAt;
  assert.equal(summarize(incompleteFixture).gq.status, "insufficient_evidence");
});

test("timeouts retain their assignments and must match the frozen time cap", () => {
  const study = humanShaped();
  study.attempts[0].terminal = "timed_out";
  duration(study.attempts[0], 300);
  let report = summarize(study);
  assert.equal(report.validation.valid, true);
  assert.equal(report.routes.baseline.terminalCounts.timed_out, 1);
  assert.equal(report.routes.baseline.correctCompletionRate, 29 / 30);
  duration(study.attempts[0], 301);
  report = summarize(study);
  assert.equal(report.gq.status, "insufficient_evidence");
});

test("invalid truth excludes all three routes symmetrically and reports planned assignments", () => {
  const study = humanShaped();
  study.groundTruth[0].status = "invalid_truth";
  study.groundTruth[0].invalidReason = "Controlled verification found source expired.";
  let report = summarize(study);
  assert.equal(report.validation.valid, true);
  assert.equal(report.counts.validCases, 29);
  assert.equal(report.counts.excludedCases, 1);
  assert.equal(report.counts.expectedExcludedAssignments, 3);
  assert.equal(report.counts.excludedAttemptRecords, 3);
  assert.equal(report.counts.totalAssignedTasks, 90);
  assert.equal(report.gq.status, "insufficient_evidence");
  for (const route of Object.values(report.routes)) assert.equal(route.expectedValidAssignments, 29);

  const enough = humanShaped();
  const excluded = { ...structuredClone(study.groundTruth[0]), caseId: "case-excluded" };
  enough.groundTruth.push(excluded);
  enough.protocol.caseRoster.push(excluded.caseId);
  enough.protocol.caseMix.normal++;
  report = summarize(enough);
  assert.equal(report.counts.totalAssignedTasks, 93);
  assert.equal(report.counts.validCases, 30);
  assert.equal(report.gq.status, "pass");
});

test("empty datasets, malformed records and duplicate truth remain safe and explicit", () => {
  const empty = fresh(); empty.groundTruth = []; empty.attempts = [];
  assert.equal(summarize(empty).routes.candidate.correctCompletionRate, null);
  assert.equal(summarize(empty).gq.status, "insufficient_evidence");
  for (const malformed of [null, [], {}, { studyMode: "real", groundTruth: [null], attempts: [null] }]) {
    assert.equal(summarize(malformed).gq.passed, false);
  }
  const missing = fresh();
  missing.attempts[0].terminal = "wrong_branch"; delete missing.attempts[0].caseId;
  assert.equal(summarize(missing).validation.valid, false);
  const duplicate = fresh(); duplicate.groundTruth.push(structuredClone(duplicate.groundTruth[0]));
  const report = summarize(duplicate);
  assert.equal(report.counts.uniqueCases, 30);
  assert.equal(report.gq.status, "insufficient_evidence");
});

test("calendar validity, frozen roster and actual task ordering are checked", () => {
  assert.equal(benchmarkTime("2026-02-30T12:00:00Z"), null);
  assert.equal(benchmarkTime("2026-10-02T01:00:00.1Z"), Date.parse("2026-10-02T01:00:00.100Z"));
  const study = fresh();
  study.protocol.caseRoster[0] = "case-substituted";
  assert.equal(validateBenchmark(study).valid, false);
  const reordered = fresh();
  const first = reordered.attempts[0];
  const later = reordered.attempts.find((a) => a.participantCode === first.participantCode && a.assignmentOrder === 2);
  later.startedAt = first.startedAt; later.endedAt = first.endedAt;
  assert.ok(validateBenchmark(reordered).errors.some((error) => error.code === "overlapping_or_reordered_tasks"));
});

test("summaries and parse errors omit research identities, source contents and free text", async (t) => {
  const study = fresh();
  study.attempts[0].reviewReason = "PRIVATE_REVIEW_CONTENT";
  study.groundTruth[0].privateContact = "PRIVATE_CONTACT";
  const report = JSON.stringify(summarize(study));
  for (const privateValue of ["PRIVATE_REVIEW_CONTENT", "PRIVATE_CONTACT", "P-synth01", "case-synth01"]) assert.equal(report.includes(privateValue), false);
  const directory = await mkdtemp(join(tmpdir(), "benchmark-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, "private-records.json");
  await writeFile(input, '{"PRIVATE_CONTENT":');
  try {
    await run(process.execPath, [resolve("scripts/benchmark-summary.mjs"), "--input", input]);
    assert.fail("invalid JSON must return a nonzero exit");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(error.stdout.includes("PRIVATE_CONTENT"), false);
    assert.equal(error.stdout.includes(input), false);
    assert.equal(JSON.parse(error.stdout).errors[0].code, "input_read_or_parse_failed");
  }
});
