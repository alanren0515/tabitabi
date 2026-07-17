import test from "node:test";
import assert from "node:assert/strict";
import { candidateDecision, candidateDecisionCopy, rejectCandidate, restoreCandidates, visibleCandidates } from "../src/candidate-selection.js";

const candidates = [{ id: "shinjuku", name: "新宿店" }, { id: "ueno", name: "上野店" }];

test("rejects one candidate without selecting or removing the remaining branch", () => {
  const rejected = rejectCandidate(candidates, [], "shinjuku");
  assert.deepEqual(rejected, ["shinjuku"]);
  assert.deepEqual(visibleCandidates(candidates, rejected).map((item) => item.id), ["ueno"]);
});

test("ignores unknown and duplicate candidate rejection ids", () => {
  assert.deepEqual(rejectCandidate(candidates, ["shinjuku"], "shinjuku"), ["shinjuku"]);
  assert.deepEqual(rejectCandidate(candidates, ["shinjuku"], "missing"), ["shinjuku"]);
});

test("restores all candidates after the user changes their mind", () => {
  assert.deepEqual(restoreCandidates(), []);
  assert.equal(visibleCandidates(candidates, restoreCandidates()).length, 2);
});

test("marks one strong identity match as likely without auto-confirming it", () => {
  assert.deepEqual(candidateDecision([{
    id: "ueno",
    rank: 1,
    matchScore: 22,
    matchReasons: ["店名高度一致", "分店名一致"]
  }]), {
    kind: "likely_single",
    leadId: "ueno",
    leadScore: 22,
    scoreGap: 22
  });
});

test("marks a clearly separated, location-supported leader while retaining alternatives", () => {
  const decision = candidateDecision([
    { id: "namba", rank: 1, matchScore: 24, matchReasons: ["店名一致", "分店名一致"] },
    { id: "shibuya", rank: 2, matchScore: 10, matchReasons: ["店名一致"] }
  ]);
  assert.equal(decision.kind, "likely_with_alternatives");
  assert.equal(decision.leadId, "namba");
});

test("keeps close or relevance-only results ambiguous for user choice", () => {
  assert.equal(candidateDecision([
    { id: "first", rank: 1, matchScore: 19, matchReasons: ["店名一致"] },
    { id: "second", rank: 2, matchScore: 17, matchReasons: ["店名一致"] }
  ]).kind, "ambiguous");
  assert.equal(candidateDecision([
    { id: "beef-men", rank: 1, matchScore: 10, matchReasons: ["Google Maps 搜索相关度排序"] },
    { id: "other", rank: 2, matchScore: 8, matchReasons: ["Google Maps 搜索相关度排序"] }
  ]).kind, "ambiguous");
});

test("returns no decision when all candidates have been rejected", () => {
  assert.deepEqual(candidateDecision([]), { kind: "none", leadId: "", leadScore: 0, scoreGap: 0 });
});

test("describes one uncertain result as a single candidate instead of several results", () => {
  assert.deepEqual(candidateDecisionCopy({
    decision: { kind: "ambiguous" },
    candidateCount: 1,
    input: "つるとんたん 六本木"
  }), {
    heading: "候補は1件ですが、確定できません",
    summary: "「つるとんたん 六本木」と一部一致しますが、根拠が十分ではありません。店名・支店・住所を確認してください。"
  });
});
