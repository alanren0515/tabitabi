import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateDecisionSafety } from "./decision-eval.mjs";
import { candidateSelectionsForDecision, providerIntervalFromEnv } from "./release-eval-support.mjs";

const baseUrl = process.env.TABITABI_BASE_URL || "http://localhost:4173";
const pilotHeaders = process.env.PILOT_ACCESS_CODE ? { "X-Pilot-Access": process.env.PILOT_ACCESS_CODE } : {};
const casesPath = resolve(process.argv[2] || "eval/cases.json");
const reportPath = resolve(process.env.DECISION_EVAL_OUTPUT || "eval/latest-decision-results.json");
const candidateReportPath = resolve(process.env.CANDIDATE_EVAL_INPUT || "eval/latest-candidate-results.json");
const providerIntervalMs = providerIntervalFromEnv(process.env.EVAL_PROVIDER_INTERVAL_MS);
const allCases = JSON.parse(await readFile(casesPath, "utf8"));
const requestedIds = new Set(String(process.env.DECISION_EVAL_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
const limit = Math.max(0, Number.parseInt(process.env.DECISION_EVAL_LIMIT || "0", 10) || 0);
let cases = allCases.filter((testCase) => testCase.verificationStatus === "confirmed");
if (requestedIds.size) cases = cases.filter((testCase) => requestedIds.has(testCase.id));
if (limit) cases = cases.slice(0, limit);

let capabilities;
try {
  const response = await fetch(`${baseUrl}/api/capabilities`);
  capabilities = await response.json();
} catch (error) {
  await finishBlocked(`无法连接 ${baseUrl}：${error.message}`);
}

if (!capabilities?.placesSearch) {
  await finishBlocked("本地服务未配置 Google Places Search/Details");
}
if (!/^[a-f0-9]{40}$/.test(String(capabilities.releaseRevision || ""))) {
  await finishBlocked("决策评测要求服务以有效 RELEASE_REVISION 启动，避免把旧结果绑定到当前代码");
}

let candidateReport;
try {
  candidateReport = JSON.parse(await readFile(candidateReportPath, "utf8"));
} catch (error) {
  await finishBlocked(`无法读取同版本候选报告：${error.message}`);
}
let candidateResults;
try {
  candidateResults = candidateSelectionsForDecision({
    report: candidateReport,
    releaseRevision: capabilities.releaseRevision,
    caseIds: cases.map((item) => item.id)
  });
} catch (error) {
  await finishBlocked(error.message);
}

const results = [];
for (const testCase of cases) {
  process.stderr.write(`[decision-eval] ${results.length + 1}/${cases.length} ${testCase.id}\n`);
  if (results.length && providerIntervalMs) await delay(providerIntervalMs);
  try {
    const candidateResult = candidateResults.get(testCase.id);
    const selected = { placeId: candidateResult.matchedPlaceId };
    const detailsPayload = await requestJsonWithRateLimit("/api/restaurants/details", {
      placeId: selected.placeId,
      clues: testCase.clues,
      plan: {}
    });
    const restaurant = detailsPayload.restaurant || {};
    const safety = evaluateDecisionSafety(restaurant);
    const placeIdMatches = restaurant.placeId === selected.placeId;
    const issues = [...safety.issues];
    if (!placeIdMatches) issues.push("details_place_id_mismatch");

    results.push({
      id: testCase.id,
      passed: placeIdMatches && safety.passed,
      candidateMatched: true,
      matchedRank: candidateResult.matchedRank,
      selectedPlaceId: selected.placeId,
      detailsPlaceId: restaurant.placeId || null,
      restaurantName: restaurant.name || selected.name || null,
      recommendation: safety.recommendation,
      primaryActionType: safety.primaryActionType,
      primaryActionProvider: safety.primaryActionProvider,
      evidenceCount: safety.evidenceCount,
      unresolvedIdentityRisk: safety.unresolvedIdentityRisk,
      issues
    });
  } catch (error) {
    results.push({ id: testCase.id, passed: false, candidateMatched: false, error: error.message });
  }
}

const summary = summarize(results, cases.length);
const report = { generatedAt: new Date().toISOString(), releaseRevision: capabilities.releaseRevision, baseUrl, selectedCaseIds: cases.map((item) => item.id), ...summary, results };
console.log(JSON.stringify(report, null, 2));
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (summary.errors) process.exitCode = 2;
else if (!summary.gatePassed) process.exitCode = 1;

async function requestJsonWithRateLimit(path, body) {
  const request = () => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000)
  });
  let response = await request();
  if (response.status === 429) {
    const retryAfterSeconds = Math.max(1, Math.min(65, Number(response.headers.get("retry-after")) || 60));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryAfterSeconds * 1_000 + 100));
    response = await request();
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function summarize(items, selectedCases) {
  const errors = items.filter((item) => item.error).length;
  const candidateMatchPassed = items.filter((item) => item.candidateMatched).length;
  const safeDecisionPassed = items.filter((item) => item.candidateMatched && item.passed).length;
  return {
    selectedCases,
    evaluated: items.length,
    candidateMatchPassed,
    safeDecisionPassed,
    errors,
    gatePassed: selectedCases > 0 && items.length === selectedCases && safeDecisionPassed === selectedCases && errors === 0
  };
}

async function finishBlocked(blockedReason) {
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    selectedCases: cases.length,
    evaluated: 0,
    gatePassed: false,
    blockedReason,
    results: []
  };
  console.log(JSON.stringify(report, null, 2));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.exit(2);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
