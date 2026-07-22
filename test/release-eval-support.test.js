import test from "node:test";
import assert from "node:assert/strict";
import { assertAuthorizedEvaluationBudget, candidateSelectionsForDecision, providerIntervalFromEnv } from "../scripts/release-eval-support.mjs";

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

test("blocks an evaluation before provider calls when the approved ceiling is missing or insufficient", () => {
  const capabilities = { dailyBudget: { buckets: { places_search: { used: 20, limit: 70 } } } };
  assert.doesNotThrow(() => assertAuthorizedEvaluationBudget({
    capabilities,
    authorizedLimits: { places_search: 70 },
    requiredCalls: { places_search: 35 }
  }));
  assert.throws(() => assertAuthorizedEvaluationBudget({
    capabilities,
    authorizedLimits: {},
    requiredCalls: { places_search: 35 }
  }), /缺少.*授权上限/);
  assert.throws(() => assertAuthorizedEvaluationBudget({
    capabilities,
    authorizedLimits: { places_search: 50 },
    requiredCalls: { places_search: 35 }
  }), /硬上限.*高于本轮授权/);
  assert.throws(() => assertAuthorizedEvaluationBudget({
    capabilities: { dailyBudget: { buckets: { places_search: { used: 55, limit: 70 } } } },
    authorizedLimits: { places_search: 70 },
    requiredCalls: { places_search: 35 }
  }), /会超过本轮授权/);
});
