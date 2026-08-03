import { readFile } from "node:fs/promises";
import { createProviderCircuitBreaker } from "./provider-circuit-breaker.mjs";
import { dailyBudgetSnapshot } from "./daily-budget.mjs";
import { getVisionCapabilities } from "./vision-extraction.mjs";
import { serviceReadiness } from "./readiness.mjs";
import { buildDailyMonitoringReport, DEFAULT_MONITORING_LIMITS, tokyoDate, writeMonitoringSnapshot } from "./daily-monitoring.mjs";

const releaseRevision = String(process.env.RELEASE_REVISION || "").trim().toLowerCase();
if (!/^[a-f0-9]{40}$/.test(releaseRevision)) throw new Error("A valid RELEASE_REVISION is required for daily monitoring");

const now = new Date();
const dataRoot = "/app/data";
const events = await readJsonLines(`${dataRoot}/events.jsonl`);
const sourceMetrics = await readJsonLines(`${dataRoot}/source-metrics.jsonl`);
const budgetState = (await readJsonIfPresent(`${dataRoot}/daily-budget.json`)) || { date: tokyoDate(now), counts: {} };
const budgetLimits = {
  vision_requests: envInteger("DAILY_VISION_REQUEST_LIMIT", DEFAULT_MONITORING_LIMITS.vision_requests),
  vision_qwen_attempts: envInteger("DAILY_QWEN_ATTEMPT_LIMIT", DEFAULT_MONITORING_LIMITS.vision_qwen_attempts),
  vision_openai_fallback_attempts: envInteger("DAILY_OPENAI_FALLBACK_LIMIT", DEFAULT_MONITORING_LIMITS.vision_openai_fallback_attempts),
  places_search: envInteger("DAILY_PLACES_SEARCH_LIMIT", DEFAULT_MONITORING_LIMITS.places_search),
  places_details: envInteger("DAILY_PLACES_DETAILS_LIMIT", DEFAULT_MONITORING_LIMITS.places_details),
  hotpepper_attempts: envInteger("DAILY_HOTPEPPER_ATTEMPT_LIMIT", DEFAULT_MONITORING_LIMITS.hotpepper_attempts)
};
const providerCircuit = await createProviderCircuitBreaker({ path: `${dataRoot}/provider-circuit.json` }).snapshot();
const readiness = serviceReadiness({ visionCapabilities: getVisionCapabilities(process.env), env: process.env, dataStoreWritable: true });
const report = buildDailyMonitoringReport({
  events,
  sourceMetrics,
  date: tokyoDate(now),
  releaseRevision,
  budgetState: budgetState && { ...budgetState, counts: budgetState.counts || {} },
  budgetLimits,
  providerCircuit,
  readiness,
  now
});
await writeMonitoringSnapshot(`${dataRoot}/daily-monitoring`, report);
console.log(`TABITABI_DAILY_MONITOR=${JSON.stringify(report)}`);

async function readJsonLines(path) {
  try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function envInteger(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
