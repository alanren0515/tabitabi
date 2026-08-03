import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pilotEligibleLiveEvents, summarizePilotMetrics } from "./pilot-metrics.mjs";
import { dailyBudgetSnapshot } from "./daily-budget.mjs";

export const DEFAULT_MONITORING_LIMITS = Object.freeze({
  vision_requests: 60,
  vision_qwen_attempts: 60,
  vision_openai_fallback_attempts: 10,
  places_search: 90,
  places_details: 90,
  hotpepper_attempts: 60
});

export const MONITORING_THRESHOLDS = Object.freeze({
  budgetWarningRatio: 0.7,
  budgetCriticalRatio: 0.9,
  sourceMinimumRequests: 5,
  sourceErrorWarningRate: 0.15,
  sourceErrorCriticalRate: 0.3,
  historyRetentionDays: 90
});

export function tokyoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function buildDailyMonitoringReport({
  events = [],
  sourceMetrics = [],
  date = tokyoDate(),
  releaseRevision = "",
  budgetState = null,
  budgetLimits = DEFAULT_MONITORING_LIMITS,
  providerCircuit = { open: false, degradedProviders: [] },
  readiness = { ready: true, missing: [] },
  now = new Date()
} = {}) {
  const liveEvents = pilotEligibleLiveEvents(events);
  const dailyEvents = liveEvents.filter((event) => tokyoDate(event.occurredAt) === date);
  const dailyAllReleases = summarizePilotMetrics(dailyEvents);
  const dailyCurrentRelease = summarizePilotMetrics(dailyEvents, { releaseRevision });
  const budget = budgetState ? dailyBudgetSnapshot(budgetState, budgetLimits) : null;
  const sources = summarizeSourceMetrics(sourceMetrics.filter((record) => tokyoDate(record.occurredAt) === date));
  const alerts = [
    ...budgetAlerts(budget),
    ...providerAlerts(providerCircuit, readiness),
    ...sourceAlerts(sources)
  ];
  if (dailyAllReleases.inputRuns === 0) {
    alerts.push({ severity: "info", code: "NO_LIVE_INPUT_TODAY", message: "今天尚未发现合格的真实 live 输入。", action: "这不是故障；继续观察，不要用 0 推断监测失败。" });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    date,
    timeZone: "Asia/Tokyo",
    releaseRevision: validRevision(releaseRevision) ? releaseRevision : null,
    eventCounts: {
      totalEventsToday: events.filter((event) => tokyoDate(event.occurredAt) === date).length,
      eligibleLiveEventsToday: dailyEvents.length
    },
    dailyAllReleases,
    dailyCurrentRelease,
    budget,
    providerCircuit,
    readiness: {
      ready: readiness.ready === true,
      missing: Array.isArray(readiness.missing) ? readiness.missing : []
    },
    sources,
    alerts,
    status: monitoringStatus(alerts)
  };
}

export function summarizeSourceMetrics(records = []) {
  const groups = new Map();
  for (const record of records) {
    const key = `${String(record.source || "unknown")}:${String(record.operation || "unknown")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map((items) => {
    const durations = items.map((item) => Number(item.durationMs)).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    const errors = items.filter((item) => item.status === "error").length;
    const upstreamCalls = items.filter((item) => !item.cacheStatus || item.cacheStatus === "miss").length;
    return {
      source: items[0].source || "unknown",
      operation: items[0].operation || "unknown",
      skuClass: items[0].skuClass || null,
      requests: items.length,
      upstreamCalls,
      cacheHits: items.filter((item) => item.cacheStatus === "hit").length,
      coalescedRequests: items.filter((item) => item.cacheStatus === "coalesced").length,
      successes: items.filter((item) => item.status === "success").length,
      errors,
      errorRate: items.length ? errors / items.length : 0,
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      p95DurationMs: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null
    };
  }).sort((left, right) => `${left.source}:${left.operation}`.localeCompare(`${right.source}:${right.operation}`));
}

export function mergeExternalMonitoring(report, { http = null, fly = null } = {}) {
  const alerts = [...(report?.alerts || [])];
  if (http?.health?.ok !== true) alerts.push({ severity: "critical", code: "HEALTH_CHECK_FAILED", message: "线上 /healthz 检查失败。", action: "检查 Fly Machine、路由和最近部署。" });
  if (http?.ready?.ready !== true) alerts.push({ severity: "critical", code: "READINESS_CHECK_FAILED", message: "线上 /readyz 未就绪。", action: "查看 ready 缺失项、供应商熔断和 emergency stop。" });
  if (http?.capabilities?.providerCircuit?.open === true) alerts.push({ severity: "critical", code: "REMOTE_PROVIDER_CIRCUIT_OPEN", message: "线上供应商熔断器处于打开状态。", action: "先停止评测和推广，查看 /readyz 与 incident runbook。" });
  if (http?.capabilities?.emergencyStop === true) alerts.push({ severity: "critical", code: "REMOTE_EMERGENCY_STOP", message: "线上 PAID_API_EMERGENCY_STOP 已开启。", action: "确认事件原因后再按 incident runbook 恢复。" });
  if (fly?.passed !== true) alerts.push({ severity: "critical", code: "FLY_AUDIT_FAILED", message: "Fly 资源或健康检查审计未通过。", action: "不要扩容；检查 Machine、Volume、健康检查和 Secret 状态。" });
  return { ...report, http, fly, alerts, status: monitoringStatus(alerts) };
}

export function monitoringStatus(alerts = []) {
  if (alerts.some((alert) => alert.severity === "critical")) return "critical";
  if (alerts.some((alert) => alert.severity === "warning")) return "warning";
  return "healthy";
}

export async function writeMonitoringSnapshot(directory, report, { retentionDays = MONITORING_THRESHOLDS.historyRetentionDays } = {}) {
  await mkdir(directory, { recursive: true });
  const date = String(report.date || tokyoDate());
  await atomicWrite(join(directory, `${date}.json`), report);
  await atomicWrite(join(directory, "latest.json"), report);
  const cutoff = Date.parse(`${date}T00:00:00+09:00`) - retentionDays * 24 * 60 * 60 * 1_000;
  for (const name of await readdir(directory)) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    if (Date.parse(`${match[1]}T00:00:00+09:00`) < cutoff) await unlink(join(directory, name)).catch(() => {});
  }
}

function budgetAlerts(budget) {
  if (!budget) return [{ severity: "critical", code: "BUDGET_UNAVAILABLE", message: "每日预算文件不可读取。", action: "保持付费 API 停止，检查 /app/data/daily-budget.json。" }];
  const alerts = [];
  for (const [bucket, item] of Object.entries(budget.buckets || {})) {
    const ratio = item.limit ? item.used / item.limit : 0;
    if (ratio >= MONITORING_THRESHOLDS.budgetCriticalRatio) alerts.push({ severity: "critical", code: "BUDGET_NEAR_LIMIT", bucket, message: `${bucket} 已使用 ${(ratio * 100).toFixed(0)}%，接近每日上限。`, action: "暂停评测或推广，核对供应商账单与调用来源。" });
    else if (ratio >= MONITORING_THRESHOLDS.budgetWarningRatio) alerts.push({ severity: "warning", code: "BUDGET_HIGH", bucket, message: `${bucket} 已使用 ${(ratio * 100).toFixed(0)}%。`, action: "减少测试流量并观察剩余额度。" });
  }
  return alerts;
}

function providerAlerts(circuit, readiness) {
  const alerts = [];
  if (circuit?.open === true) alerts.push({ severity: "critical", code: "PROVIDER_CIRCUIT_OPEN", message: "供应商异常熔断器处于打开状态。", action: "暂停付费评测，查看 degradedProviders 和 incident runbook。" });
  if (readiness?.ready !== true) alerts.push({ severity: "critical", code: "SERVICE_NOT_READY", message: "服务未就绪。", action: `检查：${(readiness.missing || []).join("、") || "未知原因"}。` });
  return alerts;
}

function sourceAlerts(sources) {
  const alerts = [];
  for (const source of sources) {
    if (source.requests < MONITORING_THRESHOLDS.sourceMinimumRequests) continue;
    if (source.errorRate >= MONITORING_THRESHOLDS.sourceErrorCriticalRate) alerts.push({ severity: "critical", code: "SOURCE_ERROR_RATE_HIGH", source: source.source, operation: source.operation, message: `${source.source}/${source.operation} 错误率 ${(source.errorRate * 100).toFixed(0)}%。`, action: "检查供应商状态、凭证和熔断器；必要时开启 emergency stop。" });
    else if (source.errorRate >= MONITORING_THRESHOLDS.sourceErrorWarningRate) alerts.push({ severity: "warning", code: "SOURCE_ERROR_RATE_ELEVATED", source: source.source, operation: source.operation, message: `${source.source}/${source.operation} 错误率 ${(source.errorRate * 100).toFixed(0)}%。`, action: "继续观察并核对最近变更。" });
  }
  return alerts;
}

function validRevision(value) { return /^[a-f0-9]{40}$/.test(String(value || "")); }

async function atomicWrite(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}
