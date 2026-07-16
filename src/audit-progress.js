export function mobileAuditFinished(draft = {}) {
  return ["pass", "fail"].includes(draft.mobileFlow);
}

export function nextUnfinishedCaseId(cases = [], drafts = {}, fallbackId = "") {
  return cases.find((item) => !mobileAuditFinished(drafts[item.id]))?.id || fallbackId;
}

export function markAuditPassed(draft = {}) {
  return {
    ...draft,
    identification: "pass",
    branchCorrect: true,
    bookingSafety: "pass",
    severeActionError: false,
    mobileFlow: "pass"
  };
}
