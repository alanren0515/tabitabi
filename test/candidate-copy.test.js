import test from "node:test";
import assert from "node:assert/strict";
import { localizedCandidateDecisionCopy } from "../src/candidate-copy.js";
import { translate } from "../src/i18n.js";

test("uses the new localized candidate headings in every supported language", () => {
  for (const locale of ["ja", "en", "zh-CN"]) {
    for (const decision of [{ kind: "likely_single" }, { kind: "likely_with_alternatives" }, { kind: "ambiguous" }]) {
      const key = decision.kind === "likely_single" ? "candidate.singleHeading" : decision.kind === "likely_with_alternatives" ? "candidate.leadHeading" : "candidate.ambiguousHeading";
      const copy = localizedCandidateDecisionCopy({ locale, translate: (translationKey, values) => translate(locale, translationKey, values), decision, candidateCount: decision.kind === "ambiguous" ? 2 : 1 });
      assert.notEqual(copy.heading, "このお店ですか？");
      assert.notEqual(copy.heading, "どのお店ですか？");
      assert.equal(copy.heading, translate(locale, key));
    }
  }
});
