import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { currentGitState } from "../server/release-revision.mjs";
import { mergeExternalMonitoring, tokyoDate, writeMonitoringSnapshot } from "../server/daily-monitoring.mjs";

const run = promisify(execFile);
const app = flyApplicationName(await readFile("fly.toml", "utf8"));
const baseUrl = process.env.TABITABI_BASE_URL || `https://${app}.fly.dev`;
if (!app) throw new Error("fly.toml must contain a valid app name");
const git = await currentGitState();

const remote = await readRemoteMonitorOrUnavailable(app, git.revision);
const http = await readHttpHealth(baseUrl);
const fly = await runFlyAudit();
const report = mergeExternalMonitoring(remote, { http, fly });
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
    const { stdout } = await run("flyctl", ["ssh", "console", "-a", application, "-C", "node /app/server/remote-daily-monitor.mjs"], { env: runtime.env, timeout: 45_000, maxBuffer: 512 * 1024 });
    const marker = String(stdout).split(/\r?\n/).find((line) => line.startsWith("TABITABI_DAILY_MONITOR="));
    if (!marker) throw new Error("Remote daily monitor marker was not returned");
    return JSON.parse(marker.slice("TABITABI_DAILY_MONITOR=".length));
  } finally { await runtime.cleanup(); }
}

async function readRemoteMonitorOrUnavailable(application, revision) {
  try {
    return await readRemoteMonitor(application);
  } catch {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      date: tokyoDate(),
      timeZone: "Asia/Tokyo",
      releaseRevision: /^[a-f0-9]{40}$/.test(String(revision || "")) ? revision : null,
      eventCounts: { totalEventsToday: null, eligibleLiveEventsToday: null },
      dailyAllReleases: null,
      dailyCurrentRelease: null,
      budget: null,
      providerCircuit: null,
      readiness: { ready: false, missing: ["remote_daily_monitor_unavailable"] },
      sources: [],
      alerts: [{ severity: "critical", code: "REMOTE_DAILY_MONITOR_UNAVAILABLE", message: "远端每日监测脚本不可用；当前使用量不明。", action: "先部署包含 remote-daily-monitor.mjs 的新镜像，再重新运行每日监测。" }],
      status: "critical"
    };
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
