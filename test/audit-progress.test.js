import test from "node:test";
import assert from "node:assert/strict";
import { markAuditPassed, mobileAuditFinished, nextUnfinishedCaseId } from "../src/audit-progress.js";

test("treats both completed pass and completed fail as finished mobile audits", () => {
  assert.equal(mobileAuditFinished({ mobileFlow: "pass" }), true);
  assert.equal(mobileAuditFinished({ mobileFlow: "fail" }), true);
  assert.equal(mobileAuditFinished({ mobileFlow: "pending" }), false);
  assert.equal(mobileAuditFinished({}), false);
});

test("advances to the first unfinished case without hiding completed failures", () => {
  const cases = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const drafts = { one: { mobileFlow: "pass" }, two: { mobileFlow: "fail" }, three: { mobileFlow: "pending" } };
  assert.equal(nextUnfinishedCaseId(cases, drafts, "one"), "three");
  drafts.three.mobileFlow = "pass";
  assert.equal(nextUnfinishedCaseId(cases, drafts, "one"), "one");
});

test("fills only pass judgments while preserving evidence and notes", () => {
  const result = markAuditPassed({ caseId: "one", evidence: ["result.png"], notes: "checked" });
  assert.deepEqual(result, {
    caseId: "one",
    evidence: ["result.png"],
    notes: "checked",
    identification: "pass",
    branchCorrect: true,
    bookingSafety: "pass",
    severeActionError: false,
    mobileFlow: "pass"
  });
});
