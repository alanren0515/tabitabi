import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProjectStatus, selectCurrentPilotReport } from "../server/project-status.mjs";
import { loadPilotReport } from "../server/pilot-report.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const [cases, audits, matrix, candidateReport, decisionReport, testReport, remotePilotReport, monitoringReport, localEnv, git] = await Promise.all([
  readJson("eval/cases.json", []), readJson("eval/manual-audits.json", []), readJson("eval/coverage-matrix.json", []),
  readJson("eval/latest-candidate-results.json", null), readJson("eval/latest-decision-results.json", null),
  readJson("data/release-evidence/latest-tests.json", null), readJson("data/release-evidence/latest-remote-pilot.json", null),
  readJson("data/monitoring/latest.json", null), readText(".env.local"), currentGitState()
]);
const localPilotReport = await loadPilotReport(resolve(process.env.PILOT_EVENTS_PATH || "data/events.jsonl"), new Date(), { releaseRevision: git.revision });
const pilotReport = selectCurrentPilotReport({ remoteReport: remotePilotReport, localReport: localPilotReport, revision: git.revision });
const filePresence = parseEnvPresence(localEnv);
const providers = {
  qwenVision: Boolean(process.env.DASHSCOPE_API_KEY) || Boolean(filePresence.DASHSCOPE_API_KEY),
  googlePlaces: Boolean(process.env.GOOGLE_MAPS_API_KEY) || Boolean(filePresence.GOOGLE_MAPS_API_KEY),
  hotPepper: Boolean(process.env.HOTPEPPER_API_KEY) || Boolean(filePresence.HOTPEPPER_API_KEY),
  openAiFallback: Boolean(process.env.OPENAI_API_KEY) || Boolean(filePresence.OPENAI_API_KEY)
};
console.log(JSON.stringify(buildProjectStatus({ providers, cases, audits, matrix, candidateReport, decisionReport, testReport, revision: git.revision, pilotReport, monitoringReport }), null, 2));

function parseEnvPresence(content = "") {
  const result = {};
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    result[match[1]] = Boolean(stripQuotes(match[2]));
  }
  return result;
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1).trim();
  return text;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function readText(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
