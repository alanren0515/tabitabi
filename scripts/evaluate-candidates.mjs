import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyCandidateFailure, matchesExpected } from "./eval-matching.mjs";
import { assertAuthorizedEvaluationBudget, providerIntervalFromEnv } from "./release-eval-support.mjs";

const baseUrl = process.env.TABITABI_BASE_URL || "http://localhost:4173";
const pilotHeaders = process.env.PILOT_ACCESS_CODE ? { "X-Pilot-Access": process.env.PILOT_ACCESS_CODE } : {};
const casesPath = resolve(process.argv[2] || "eval/cases.json");
const reportPath = resolve(process.env.CANDIDATE_EVAL_OUTPUT || "eval/latest-candidate-results.json");
const providerIntervalMs = providerIntervalFromEnv(process.env.EVAL_PROVIDER_INTERVAL_MS);
const cases = JSON.parse(await readFile(casesPath, "utf8"));

let capabilities;
try {
  const response = await fetch(`${baseUrl}/api/capabilities`);
  capabilities = await response.json();
} catch (error) {
  console.log(JSON.stringify({
    cases: cases.length,
    gatePassed: false,
    blockedReason: `无法连接 ${baseUrl}：${error.message}`
  }, null, 2));
  process.exit(2);
}

if (!capabilities.placesSearch) {
  console.log(JSON.stringify({
    cases: cases.length,
    gatePassed: false,
    blockedReason: "本地服务未配置 GOOGLE_MAPS_API_KEY"
  }, null, 2));
  process.exit(2);
}
if (!/^[a-f0-9]{40}$/.test(String(capabilities.releaseRevision || ""))) {
  console.error("候选评测要求服务以有效 RELEASE_REVISION 启动，避免把旧结果绑定到当前代码。\n");
  process.exit(2);
}
try {
  assertAuthorizedEvaluationBudget({
    capabilities,
    authorizedLimits: { places_search: process.env.EVAL_AUTHORIZED_PLACES_SEARCH_TOTAL },
    requiredCalls: { places_search: cases.length }
  });
} catch (error) {
  console.error(`${error.message}。请在取得费用确认后设置授权上限，并让本地服务使用不高于该值的 DAILY_PLACES_SEARCH_LIMIT。\n`);
  process.exit(2);
}

const results = [];
for (const testCase of cases) {
  process.stderr.write(`[candidate-eval] ${results.length + 1}/${cases.length} ${testCase.id}\n`);
  if (results.length && providerIntervalMs) await delay(providerIntervalMs);
  try {
    const requestSearch = () => fetch(`${baseUrl}/api/restaurants/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pilotHeaders },
      body: JSON.stringify({ query: testCase.query, clues: testCase.clues })
    });
    let response = await requestSearch();
    if (response.status === 429) {
      const retryAfterSeconds = Math.max(1, Math.min(65, Number(response.headers.get("retry-after")) || 60));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryAfterSeconds * 1_000 + 100));
      response = await requestSearch();
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    const candidates = payload.candidates || [];
    const matchedIndex = candidates.findIndex((candidate) => matchesExpected(candidate, testCase.expected));
    results.push({
      id: testCase.id,
      passed: matchedIndex >= 0 && matchedIndex < 3,
      top1: matchedIndex === 0,
      matchedRank: matchedIndex >= 0 ? matchedIndex + 1 : null,
      matchedPlaceId: matchedIndex >= 0 ? candidates[matchedIndex]?.placeId || null : null,
      candidateCount: candidates.length,
      verificationStatus: testCase.verificationStatus,
      failureReason: matchedIndex >= 0 ? null : classifyCandidateFailure(candidates, testCase.expected)
    });
  } catch (error) {
    results.push({ id: testCase.id, passed: false, error: error.message });
  }
}

const passed = results.filter((result) => result.passed).length;
const top1 = results.filter((result) => result.top1).length;
const verifiedCases = cases.filter((testCase) => testCase.verificationStatus === "confirmed").length;
const summary = {
  cases: results.length,
  verifiedCases,
  targetCaseCount: 30,
  coverageGatePassed: results.length >= 30 && verifiedCases === results.length,
  top3Passed: passed,
  top3Recall: results.length ? passed / results.length : 0,
  top1Passed: top1,
  top1Rate: results.length ? top1 / results.length : 0,
  results
};
summary.accuracyGatePassed = summary.top3Recall >= 0.9;
summary.gatePassed = summary.coverageGatePassed && summary.accuracyGatePassed && !results.some((result) => result.error);

console.log(JSON.stringify(summary, null, 2));
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), releaseRevision: capabilities.releaseRevision, ...summary }, null, 2)}\n`, "utf8");
if (results.some((result) => result.error)) process.exitCode = 2;
else if (!summary.gatePassed) process.exitCode = 1;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
