import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { readFlyDailyMonitor } from "../server/fly-daily-monitor.mjs";
import { currentGitState } from "../server/release-revision.mjs";
import { buildUnavailableDailyMonitoringReport, mergeExternalMonitoring, writeMonitoringSnapshot } from "../server/daily-monitoring.mjs";

const run = promisify(execFile);
const app = flyApplicationName(await readFile("fly.toml", "utf8"));
const baseUrl = process.env.TABITABI_BASE_URL || `https://${app}.fly.dev`;
if (!app) throw new Error("fly.toml must contain a valid app name");
const git = await currentGitState();

let report;
if (process.env.GITHUB_ACTIONS === "true" && !String(process.env.FLY_API_TOKEN || "").trim()) {
  report = buildUnavailableDailyMonitoringReport({ error: { code: "MONITOR_TOKEN_MISSING" }, revision: git.revision });
  report.checksSkipped = ["http", "fly_machine_exec", "fly_resource_audit"];
} else {
  // Existing HTTP checks can wake the auto-stopped Machine before exec is attempted.
  const http = await readHttpHealth(baseUrl);
  const remote = await readRemoteMonitorOrUnavailable(app, git.revision);
  const fly = await runFlyAudit();
  report = mergeExternalMonitoring(remote, { http, fly });
}
report.revision = git.revision;
report.repositoryClean = git.clean;
report.baseUrl = baseUrl;
await mkdir("data/monitoring", { recursive: true });
await writeMonitoringSnapshot("data/monitoring", report);
console.log(JSON.stringify(report, null, 2));
if (report.status === "critical") process.exitCode = 2;

async function readRemoteMonitor(application) {
  const runtime = await createFlyCliRuntime();
  try {
    return await readFlyDailyMonitor({ application, run, env: runtime.env });
  } finally { await runtime.cleanup(); }
}

async function readRemoteMonitorOrUnavailable(application, revision) {
  try {
    return await readRemoteMonitor(application);
  } catch (error) {
    return buildUnavailableDailyMonitoringReport({ error, revision });
  }
}

async function runFlyAudit() {
  try { await run(process.execPath, ["scripts/audit-fly-remote.mjs"], { timeout: 60_000, maxBuffer: 512 * 1024 }); }
  catch { /* The sanitized evidence file is the source for the combined alert. */ }
  return readJson("data/release-evidence/latest-fly.json", { passed: false });
}

async function readHttpHealth(origin) {
  const result = { health: await probe(`${origin}/healthz`), ready: await probe(`${origin}/readyz`), capabilities: await probe(`${origin}/api/capabilities`) };
  return {
    health: { ok: result.health.ok, status: result.health.status },
    ready: { ok: result.ready.ok, status: result.ready.status, ready: result.ready.body?.ready === true },
    capabilities: {
      ok: result.capabilities.ok,
      status: result.capabilities.status,
      providerCircuit: result.capabilities.body?.providerCircuit || null,
      emergencyStop: result.capabilities.body?.emergencyStop === true,
      releaseRevision: result.capabilities.body?.releaseRevision || null
    }
  };
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch { return { ok: false, status: null, body: null }; }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}
