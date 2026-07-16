import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyCandidateFailure, matchesExpected } from "./eval-matching.mjs";

const baseUrl = process.env.TABITABI_BASE_URL || "http://localhost:4173";
const casesPath = resolve(process.argv[2] || "eval/cases.json");
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

const results = [];
for (const testCase of cases) {
  try {
    const requestSearch = () => fetch(`${baseUrl}/api/restaurants/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
await writeFile(resolve("eval/latest-candidate-results.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`, "utf8");
if (results.some((result) => result.error)) process.exitCode = 2;
else if (!summary.gatePassed) process.exitCode = 1;
