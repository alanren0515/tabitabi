import { BENCHMARK_ROUTES, BENCHMARK_TERMINALS, inspectBenchmark } from "./benchmark-protocol.mjs";

const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const distribution = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (fraction) => {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  return { sampleCount: sorted.length, min: sorted[0] ?? null, p25: quantile(0.25), median: median(sorted), p75: quantile(0.75), max: sorted.at(-1) ?? null };
};
const decline = (candidate, reference) => candidate === null || reference === null ? null : candidate >= reference;
const improvement = (candidate, reference) => candidate === null || reference === null || reference <= 0 ? null : (reference - candidate) / reference;
const increase = (candidate, reference) => candidate === null || reference === null || reference <= 0 ? null : (candidate - reference) / reference;

function routeMetrics(route, truths, attempts) {
  const records = attempts.filter((attempt) => attempt.value.route === route);
  const validRecords = records.filter((attempt) => !attempt.excluded && attempt.validation.valid);
  const denominator = truths.length;
  const actionable = truths.filter((truth) => truth.value.expectation === "actionable").length;
  const terminalCounts = Object.fromEntries(BENCHMARK_TERMINALS.map((terminal) => [terminal, 0]));
  const terminalRates = {};
  const durations = [];
  const normalDurations = [];
  const hardDurations = [];
  const criticalCases = { wrong_branch: new Set(), unsafe_action: new Set() };
  const criticalStrata = { normal: 0, hard: 0 };
  let correct = 0;
  let actionableCorrect = 0;
  for (const attempt of validRecords) {
    const terminal = attempt.value.terminal;
    terminalCounts[terminal]++;
    if (["wrong_branch", "unsafe_action"].includes(terminal)) {
      criticalCases[terminal].add(attempt.value.caseId);
      criticalStrata[attempt.truth.value.stratum]++;
    }
    if (terminal === "correct_action" || terminal === "justified_unknown") {
      correct++;
      if (terminal === "correct_action") actionableCorrect++;
      if (attempt.validation.durationSeconds !== null) {
        durations.push(attempt.validation.durationSeconds);
        (attempt.truth.value.stratum === "normal" ? normalDurations : hardDurations).push(attempt.validation.durationSeconds);
      }
    }
  }
  for (const terminal of BENCHMARK_TERMINALS) terminalRates[terminal] = ratio(terminalCounts[terminal], denominator);
  const presentCases = new Set(records.filter((attempt) => !attempt.excluded && attempt.truth).map((attempt) => attempt.value.caseId));
  return {
    metrics: {
      attemptRecords: records.length,
      expectedValidAssignments: denominator,
      validTerminalRecords: validRecords.length,
      missingAssignments: Math.max(0, denominator - presentCases.size),
      incompleteAttemptRecords: records.filter((attempt) => !attempt.excluded && !attempt.validation.valid).length,
      excludedAttemptRecords: records.filter((attempt) => attempt.excluded).length,
      correctCompletions: correct,
      correctCompletionRate: ratio(correct, denominator),
      actionableAssignments: actionable,
      correctActions: actionableCorrect,
      actionableResolutionRate: ratio(actionableCorrect, actionable),
      terminalCounts,
      terminalRates,
      incompleteOrMissingAssignments: Math.max(0, denominator - validRecords.length),
      routeFailuresAfterAssignment: records.filter((attempt) => !attempt.excluded && attempt.value.routeAvailability === "failed_after_assignment").length,
      unknown: {
        justified: terminalCounts.justified_unknown,
        incorrect: terminalCounts.incorrect_unknown,
        unsupportedLabels: records.filter((attempt) => !attempt.excluded && attempt.value.terminal === "justified_unknown" && !attempt.validation.valid).length
      },
      criticalErrors: {
        wrongBranch: terminalCounts.wrong_branch,
        unsafeAction: terminalCounts.unsafe_action,
        affectedCaseCount: new Set([...criticalCases.wrong_branch, ...criticalCases.unsafe_action]).size,
        denominator,
        normal: criticalStrata.normal,
        hard: criticalStrata.hard
      },
      successDurationSeconds: distribution(durations),
      normalSuccessDurationSeconds: distribution(normalDurations),
      hardSuccessDurationSeconds: distribution(hardDurations)
    }, criticalCases
  };
}

function protect(candidate, reference) {
  const comparable = candidate.metrics.expectedValidAssignments > 0
    && candidate.metrics.validTerminalRecords === candidate.metrics.expectedValidAssignments
    && reference.metrics.validTerminalRecords === reference.metrics.expectedValidAssignments;
  const newWrongBranchCases = [...candidate.criticalCases.wrong_branch].filter((code) => !reference.criticalCases.wrong_branch.has(code)).length;
  const newUnsafeActionCases = [...candidate.criticalCases.unsafe_action].filter((code) => !reference.criticalCases.unsafe_action.has(code)).length;
  return {
    correctCompletionNonDecreasing: decline(candidate.metrics.correctCompletionRate, reference.metrics.correctCompletionRate),
    actionableResolutionNonDecreasing: decline(candidate.metrics.actionableResolutionRate, reference.metrics.actionableResolutionRate),
    newWrongBranchCaseCount: comparable ? newWrongBranchCases : null,
    newUnsafeActionCaseCount: comparable ? newUnsafeActionCases : null,
    noNewCriticalErrors: comparable ? newWrongBranchCases === 0 && newUnsafeActionCases === 0 : null
  };
}

// Pure aggregation. Filesystem proof is supplied only by the CLI's baseline verifier.
export function summarizeBenchmark(study, { baselineVerification = null } = {}) {
  const inspected = inspectBenchmark(study);
  const { protocol, attempts } = inspected;
  const validTruths = inspected.truths.filter((truth) => !truth.validation.excluded);
  const excludedTruths = inspected.truths.filter((truth) => truth.validation.excluded);
  const byRoute = Object.fromEntries(BENCHMARK_ROUTES.map((route) => [route, routeMetrics(route, validTruths, attempts)]));
  const strata = { normal: 0, hard: 0 };
  for (const truth of validTruths) strata[truth.value.stratum]++;
  const assignedStrata = { normal: 0, hard: 0 };
  for (const truth of inspected.truths) if (Object.hasOwn(assignedStrata, truth.value.stratum)) assignedStrata[truth.value.stratum]++;
  const participantCodes = new Set(attempts.filter((attempt) => !attempt.excluded && /^P-[A-Za-z0-9_-]{3,32}$/.test(attempt.value.participantCode)).map((attempt) => attempt.value.participantCode));
  const baseline = protect(byRoute.candidate, byRoute.baseline);
  const primaryReference = protect(byRoute.candidate, byRoute.primaryReference);
  const reduction = improvement(byRoute.candidate.metrics.successDurationSeconds.median, byRoute.primaryReference.metrics.successDurationSeconds.median);
  const baselineReduction = improvement(byRoute.candidate.metrics.successDurationSeconds.median, byRoute.baseline.metrics.successDurationSeconds.median);
  const normalIncrease = increase(byRoute.candidate.metrics.normalSuccessDurationSeconds.median, byRoute.primaryReference.metrics.normalSuccessDurationSeconds.median);
  const comparableHard = strata.hard > 0 && ["candidate", "primaryReference"].every((route) => byRoute[route].metrics.validTerminalRecords === validTruths.length);
  const hardErrorReduction = comparableHard ? byRoute.primaryReference.metrics.criticalErrors.hard - byRoute.candidate.metrics.criticalErrors.hard : null;
  const evidence = {
    schemaValid: inspected.errors.length === 0,
    protocolFrozen: protocol.status === "frozen" && typeof protocol.frozenAt === "string",
    baselineArchiveVerified: inspected.studyMode === "real" ? baselineVerification?.valid === true : null,
    minimumUniqueValidCases: validTruths.length >= 30,
    targetParticipantRange: participantCodes.size >= 10 && participantCodes.size <= 15
      && protocol.targetParticipants?.length >= 10 && protocol.targetParticipants?.length <= 15,
    frozenCaseMixComplete: assignedStrata.normal === protocol.caseMix?.normal && assignedStrata.hard === protocol.caseMix?.hard
      && strata.normal > 0 && strata.hard > 0,
    completeThreeRouteCoverage: BENCHMARK_ROUTES.every((route) => byRoute[route].metrics.validTerminalRecords === validTruths.length),
    computableActionableRates: BENCHMARK_ROUTES.every((route) => byRoute[route].metrics.actionableResolutionRate !== null),
    computableSuccessTiming: reduction !== null || (normalIncrease !== null && hardErrorReduction > 0)
  };
  const reasons = Object.entries(evidence).filter(([name, passed]) => name !== "baselineArchiveVerified" ? passed !== true : inspected.studyMode === "real" && passed !== true).map(([name]) => name);
  const anyActionableCaseResolved = byRoute.candidate.metrics.correctActions > 0;
  const protectionsPass = anyActionableCaseResolved && [baseline, primaryReference].every((result) => result.correctCompletionNonDecreasing === true && result.actionableResolutionNonDecreasing === true && result.noNewCriticalErrors);
  const timePath = reduction === null ? null : reduction >= 0.25;
  const hardPath = normalIncrease === null ? null : hardErrorReduction > 0 && normalIncrease <= 0.1;
  let status;
  if (reasons.length) status = "insufficient_evidence";
  else if (inspected.studyMode === "synthetic") status = "fixture_only";
  else status = protectionsPass && (timePath === true || hardPath === true) ? "pass" : "not_passed";
  return {
    reportVersion: "benchmark-summary-v1",
    studyMode: ["synthetic", "real"].includes(inspected.studyMode) ? inspected.studyMode : null,
    providerFree: true,
    counts: {
      uniqueCases: inspected.truths.length,
      validCases: validTruths.length,
      excludedCases: excludedTruths.length,
      expectedValidAssignments: validTruths.length * BENCHMARK_ROUTES.length,
      totalAssignedTasks: inspected.truths.length * BENCHMARK_ROUTES.length,
      expectedExcludedAssignments: excludedTruths.length * BENCHMARK_ROUTES.length,
      attemptRecords: attempts.length,
      excludedAttemptRecords: attempts.filter((attempt) => attempt.excluded).length,
      targetParticipantsObserved: participantCodes.size,
      strata, assignedStrata
    },
    routes: Object.fromEntries(BENCHMARK_ROUTES.map((route) => [route, byRoute[route].metrics])),
    comparison: {
      versusBaseline: baseline,
      versusPrimaryReference: primaryReference,
      successMedianTimeReductionVsBaseline: baselineReduction,
      successMedianTimeReductionVsPrimaryReference: reduction,
      normalSuccessMedianTimeIncreaseVsPrimaryReference: normalIncrease,
      hardCriticalErrorReductionVsPrimaryReference: hardErrorReduction,
      anyActionableCaseResolved,
      timeImprovementPath: timePath,
      hardErrorImprovementPath: hardPath
    },
    gq: { status, passed: status === "pass", evidence, insufficientEvidenceReasons: reasons },
    validation: { valid: inspected.errors.length === 0, errors: inspected.errors },
    privacy: {
      includesRawRecords: false,
      includesParticipantOrCaseCodes: false,
      includesReviewTextOrSourceContent: false,
      expiryDeletionImplemented: false
    }
  };
}
