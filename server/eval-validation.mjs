export function validateReleaseInputs({ cases = [], matrix = [], audits = [] }) {
  const errors = [];
  const caseIds = new Set();
  for (const testCase of cases) {
    if (!testCase.id) errors.push("case is missing id");
    if (caseIds.has(testCase.id)) errors.push(`${testCase.id}: duplicate case id`);
    caseIds.add(testCase.id);
    if (testCase.verificationStatus === "confirmed" && !testCase.officialSources?.length) errors.push(`${testCase.id}: confirmed case requires an official source`);
  }

  if (new Set(matrix.map((item) => item.id)).size !== matrix.length) errors.push("coverage matrix contains duplicate ids");
  if (matrix.some((item) => !["planned", "confirmed"].includes(item.status))) errors.push("coverage matrix has invalid status");
  for (const scenario of matrix.filter((item) => item.status === "confirmed")) {
    if (!scenario.linkedCaseId && !scenario.evidence?.length) errors.push(`${scenario.id}: confirmed scenario requires a linked case or evidence`);
    if (scenario.linkedCaseId && !caseIds.has(scenario.linkedCaseId)) errors.push(`${scenario.id}: scenario references unknown case ${scenario.linkedCaseId}`);
  }

  const auditedCaseIds = new Set();
  for (const audit of audits) {
    const label = audit.caseId || "audit without caseId";
    if (!caseIds.has(audit.caseId)) errors.push(`${label}: audit references unknown case`);
    if (auditedCaseIds.has(audit.caseId)) errors.push(`${label}: duplicate audit`);
    auditedCaseIds.add(audit.caseId);
    if (!["audited", "decision_audited"].includes(audit.status)) errors.push(`${label}: invalid audit status`);
    if (!audit.evidence?.length || audit.evidence.some((item) => typeof item !== "string" || !item.trim())) errors.push(`${label}: audit evidence is required`);
    if (!["pass", "fail"].includes(audit.identification)) errors.push(`${label}: invalid identification result`);
    if (typeof audit.branchCorrect !== "boolean") errors.push(`${label}: branchCorrect must be boolean`);
    if (typeof audit.severeActionError !== "boolean") errors.push(`${label}: severeActionError must be boolean`);
    if (!["pass", "fail"].includes(audit.bookingSafety)) errors.push(`${label}: invalid bookingSafety result`);
    if (!["pass", "fail", "pending"].includes(audit.mobileFlow)) errors.push(`${label}: invalid mobileFlow result`);
    if (audit.status === "audited" && !["pass", "fail"].includes(audit.mobileFlow)) errors.push(`${label}: audited status requires a completed mobile flow`);
    if (audit.status === "decision_audited" && audit.mobileFlow !== "pending") errors.push(`${label}: decision_audited status requires pending mobile flow`);
    if (!audit.auditedAt || Number.isNaN(new Date(audit.auditedAt).valueOf())) errors.push(`${label}: valid auditedAt is required`);
  }
  return errors;
}

export function validateDecisionEvalReport({ report, cases = [], now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1_000 }) {
  const errors = [];
  const confirmedIds = cases.filter((item) => item.verificationStatus === "confirmed").map((item) => item.id).sort();
  if (!report || typeof report !== "object") return ["decision evaluation report is missing"];

  const generatedAt = new Date(report.generatedAt || "").valueOf();
  if (!Number.isFinite(generatedAt)) errors.push("decision evaluation report has invalid generatedAt");
  else if (generatedAt > now + 5 * 60 * 1_000) errors.push("decision evaluation report is dated in the future");
  else if (now - generatedAt > maxAgeMs) errors.push("decision evaluation report is stale");

  const selectedIds = Array.isArray(report.selectedCaseIds) ? [...report.selectedCaseIds].sort() : [];
  if (selectedIds.length !== confirmedIds.length || selectedIds.some((id, index) => id !== confirmedIds[index])) {
    errors.push("decision evaluation report does not cover every confirmed case exactly once");
  }
  if (report.selectedCases !== confirmedIds.length || report.evaluated !== confirmedIds.length) {
    errors.push("decision evaluation report case totals do not match confirmed cases");
  }
  if (report.candidateMatchPassed !== confirmedIds.length || report.safeDecisionPassed !== confirmedIds.length) {
    errors.push("decision evaluation report contains candidate or decision failures");
  }
  if (report.errors !== 0 || report.gatePassed !== true) {
    errors.push("decision evaluation gate did not pass cleanly");
  }

  const results = Array.isArray(report.results) ? report.results : [];
  const resultIds = results.map((item) => item?.id).sort();
  if (resultIds.length !== confirmedIds.length || resultIds.some((id, index) => id !== confirmedIds[index])) {
    errors.push("decision evaluation results do not match confirmed cases");
  }
  for (const result of results) {
    if (!result?.candidateMatched || !result?.passed || result?.error || (Array.isArray(result?.issues) && result.issues.length)) {
      errors.push(`${result?.id || "unknown case"}: decision evaluation result failed`);
    }
    if (!result?.selectedPlaceId || result.selectedPlaceId !== result.detailsPlaceId) {
      errors.push(`${result?.id || "unknown case"}: details place id does not match confirmed candidate`);
    }
  }
  return [...new Set(errors)];
}

export function validateCandidateEvalReport({ report, cases = [], now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1_000 }) {
  const errors = [];
  const confirmedIds = cases.filter((item) => item.verificationStatus === "confirmed").map((item) => item.id).sort();
  if (!report || typeof report !== "object") return ["candidate evaluation report is missing"];
  const generatedAt = new Date(report.generatedAt || "").valueOf();
  if (!Number.isFinite(generatedAt)) errors.push("candidate evaluation report has invalid generatedAt");
  else if (generatedAt > now + 5 * 60 * 1_000) errors.push("candidate evaluation report is dated in the future");
  else if (now - generatedAt > maxAgeMs) errors.push("candidate evaluation report is stale");
  const results = Array.isArray(report.results) ? report.results : [];
  const resultIds = results.map((item) => item?.id).sort();
  if (resultIds.length !== confirmedIds.length || resultIds.some((id, index) => id !== confirmedIds[index])) errors.push("candidate evaluation results do not match confirmed cases");
  if (report.cases !== confirmedIds.length || report.verifiedCases !== confirmedIds.length) errors.push("candidate evaluation case totals do not match confirmed cases");
  if (report.gatePassed !== true || report.top3Recall < 0.9 || results.some((item) => !item?.passed || !Number.isInteger(item?.matchedRank) || item.matchedRank < 1 || item.matchedRank > 3)) errors.push("candidate evaluation gate did not pass cleanly");
  return [...new Set(errors)];
}
