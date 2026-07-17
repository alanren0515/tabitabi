import { validateCandidateEvalReport, validateDecisionEvalReport, validateReleaseInputs } from "./eval-validation.mjs";

export function evaluateReleaseEvidence({ cases = [], matrix = [], audits = [], candidateResults = null, decisionResults = null, now = Date.now() } = {}) {
  const errors = validateReleaseInputs({ cases, matrix, audits });
  const candidateErrors = validateCandidateEvalReport({ report: candidateResults, cases, now });
  const decisionErrors = validateDecisionEvalReport({ report: decisionResults, cases, now });
  const confirmedCases = cases.filter((item) => item.verificationStatus === "confirmed");
  const audited = audits.filter((item) => item.status === "audited");
  const decisionAudited = audits.filter((item) => ["audited", "decision_audited"].includes(item.status));
  const identificationPassed = audited.filter((item) => item.identification === "pass").length;
  const severeErrors = audited.filter((item) => item.severeActionError === true).length;
  const bookingSafetyPassed = audited.filter((item) => item.bookingSafety === "pass").length;
  const completedMatrix = matrix.filter((item) => item.status === "confirmed").length;
  const metrics = {
    confirmedCaseCount: confirmedCases.length,
    targetCaseCount: 30,
    auditedCaseCount: audited.length,
    decisionAuditedCaseCount: decisionAudited.length,
    identificationAccuracy: ratio(identificationPassed, audited.length),
    severeActionErrorRate: ratio(severeErrors, audited.length),
    bookingSafetyPassRate: ratio(bookingSafetyPassed, audited.length),
    plannedScenarioCount: matrix.length,
    completedScenarioCount: completedMatrix,
    candidateTop3Recall: candidateResults?.top3Recall ?? null,
    decisionSafetyPassed: decisionResults?.safeDecisionPassed ?? null
  };
  const gates = {
    schemaValid: errors.length === 0,
    confirmedSampleSize: confirmedCases.length >= 30,
    auditedSampleSize: audited.length >= 30,
    identificationAccuracy: audited.length >= 30 && metrics.identificationAccuracy >= 0.7,
    severeActionErrors: audited.length >= 30 && metrics.severeActionErrorRate < 0.05,
    bookingSafety: audited.length >= 30 && metrics.bookingSafetyPassRate >= 0.95,
    coverageMatrix: matrix.length >= 30 && completedMatrix === matrix.length,
    candidateTop3: candidateErrors.length === 0,
    decisionSafety: decisionErrors.length === 0
  };
  return {
    gatePassed: Object.values(gates).every(Boolean),
    gates,
    metrics,
    errors: [...errors, ...candidateErrors, ...decisionErrors],
    blockedBy: Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name),
    note: "planned 场景不计入准确率；只有 confirmed case + audited result 才进入发布指标。"
  };
}

function ratio(value, total) { return total ? value / total : null; }
