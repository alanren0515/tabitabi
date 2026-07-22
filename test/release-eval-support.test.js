import test from "node:test";
import assert from "node:assert/strict";
import { candidateSelectionsForDecision, providerIntervalFromEnv } from "../scripts/release-eval-support.mjs";

test("uses a provider interval that stays below the 20 attempts per five minute circuit", () => {
  assert.equal(providerIntervalFromEnv(undefined), 16_000);
  assert.equal(providerIntervalFromEnv("20000"), 20_000);
  assert.equal(providerIntervalFromEnv("invalid"), 16_000);
});

test("reuses only a passing candidate report from the same release revision", () => {
  const report = {
    releaseRevision: "a".repeat(40),
    gatePassed: true,
    results: [{ id: "case-1", matchedPlaceId: "place-1", matchedRank: 1 }]
  };
  const selections = candidateSelectionsForDecision({ report, releaseRevision: "a".repeat(40), caseIds: ["case-1"] });
  assert.equal(selections.get("case-1").matchedPlaceId, "place-1");
  assert.throws(
    () => candidateSelectionsForDecision({ report, releaseRevision: "b".repeat(40), caseIds: ["case-1"] }),
    /同一 release revision/
  );
  assert.throws(
    () => candidateSelectionsForDecision({ report, releaseRevision: "a".repeat(40), caseIds: ["missing"] }),
    /缺少.*Place ID/
  );
});
