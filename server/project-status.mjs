import { evaluateReleaseEvidence } from "./release-evidence.mjs";

export function selectCurrentPilotReport({ remoteReport = null, revision = "" } = {}) {
  if (remoteReport?.source === "fly-volume" && remoteReport?.releaseRevision === revision && remoteReport.metrics) {
    return { ...remoteReport, reportStatus: "available", reportSource: "remote" };
  }
  if (remoteReport?.source === "fly-volume") {
    return unavailablePilotReport("stale", "远端报告属于其他版本或结构不完整；当前试点件数不明。", remoteReport.generatedAt);
  }
  if (remoteReport?.source === "fly-audit-error") {
    return unavailablePilotReport("unavailable", "远端报告生成失败；当前试点件数不明，不代表今天没有用户使用。", remoteReport.generatedAt);
  }
  return unavailablePilotReport("unavailable", "尚未取得远端试点报告；当前试点件数不明，不代表今天没有用户使用。", null);
}

function unavailablePilotReport(reportStatus, note, generatedAt) {
  return { reportStatus, reportSource: "remote", generatedAt: generatedAt || null, gatePassed: false, metrics: null, gates: {}, note };
}

export function buildProjectStatus({
  providers = {}, cases = [], audits = [], matrix = [], candidateReport = null, decisionReport = null, testReport = null, revision = "", pilotReport = null, monitoringReport = null, now = new Date()
} = {}) {
  const fullAudits = audits.filter((item) => item?.status === "audited").length;
  const decisionAudits = audits.filter((item) => ["audited", "decision_audited"].includes(item?.status)).length;
  const completedScenarios = matrix.filter((item) => item?.status === "confirmed").length;
  const confirmedCases = cases.filter((item) => item?.verificationStatus === "confirmed").length;
  const pilotAvailable = pilotReport?.metrics && !["unavailable", "stale"].includes(pilotReport.reportStatus);
  const pilot = pilotAvailable ? pilotReport.metrics : {};
  const releaseEvidence = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults: candidateReport, decisionResults: decisionReport, testResults: testReport, revision });
  const remaining = {
    mobileAudits: Math.max(30 - fullAudits, 0),
    riskScenarios: Math.max(30 - completedScenarios, 0),
    liveInputRuns: pilotAvailable ? Math.max(20 - Number(pilot.inputRuns), 0) : null,
    feedbackRuns: pilotAvailable ? Math.max(10 - Number(pilot.feedbackRuns), 0) : null
  };
  const releaseReady = releaseEvidence.gatePassed;
  const pilotReady = pilotAvailable && remaining.liveInputRuns === 0 && remaining.feedbackRuns === 0 && pilotReport?.gatePassed === true;
  return {
    status: releaseReady && pilotReady ? "ready" : "external_evidence_required",
    providers: {
      qwenVision: Boolean(providers.qwenVision),
      googlePlaces: Boolean(providers.googlePlaces),
      hotPepper: Boolean(providers.hotPepper),
      openAiFallback: Boolean(providers.openAiFallback)
    },
    evaluation: {
      confirmedCases,
      fullMobileAudits: fullAudits,
      decisionAudits,
      completedRiskScenarios: completedScenarios,
      candidateTop3Recall: candidateReport?.top3Recall ?? null,
      safeDecisionCases: decisionReport?.safeDecisionPassed ?? null,
      pilotInputRuns: pilotAvailable ? Number(pilot.inputRuns) : null,
      pilotFeedbackRuns: pilotAvailable ? Number(pilot.feedbackRuns) : null
    },
    pilotReportStatus: pilotReport?.reportStatus || "unavailable",
    pilotReportNote: pilotReport?.note || (["unavailable", "stale"].includes(pilotReport?.reportStatus || "unavailable")
      ? "尚未取得远端试点报告；当前试点件数不明，不代表今天没有用户使用。"
      : null),
    monitoring: summarizeMonitoringReport(monitoringReport, now),
    releaseEvidence: { gatePassed: releaseEvidence.gatePassed, blockedBy: releaseEvidence.blockedBy, errors: releaseEvidence.errors },
    remaining,
    optional: providers.openAiFallback ? [] : ["配置 OPENAI_API_KEY 以启用 GPT-5.4 mini 质量备用；Qwen 主流程不因此停止。"],
    nextCommands: !pilotAvailable
      ? ["npm run release:pilot-remote"]
      : remaining.mobileAudits || remaining.riskScenarios
      ? ["npm run audit:mobile", "npm run eval:release-gate"]
      : remaining.liveInputRuns || remaining.feedbackRuns
        ? ["npm run pilot:gate"]
        : ["npm run eval:release-gate", "npm run pilot:gate"]
  };
}

export function summarizeMonitoringReport(report, now = new Date(), maxAgeMs = 26 * 60 * 60 * 1_000) {
  if (!report || typeof report !== "object") {
    return {
      status: "unavailable",
      reportedStatus: null,
      freshness: "unavailable",
      date: null,
      generatedAt: null,
      alerts: { total: 0, critical: 0, warning: 0, info: 0 },
      historicalAlerts: null,
      dailyAllReleases: null,
      dailyCurrentRelease: null,
      note: "尚未生成每日监测报告；这不代表今天没有用户使用。"
    };
  }
  const alerts = Array.isArray(report.alerts) ? report.alerts : [];
  const generatedAt = String(report.generatedAt || "");
  const timestamp = Date.parse(generatedAt);
  const age = Number.isFinite(timestamp) ? new Date(now).getTime() - timestamp : Infinity;
  const freshness = age >= 0 && age <= maxAgeMs ? "fresh" : "stale";
  const reportedStatus = ["healthy", "warning", "critical"].includes(report.status) ? report.status : "unavailable";
  const reportedAlerts = countMonitoringAlerts(alerts);
  const isCurrent = freshness === "fresh";
  return {
    status: isCurrent ? reportedStatus : "stale",
    reportedStatus,
    freshness,
    date: report.date || null,
    generatedAt: generatedAt || null,
    alerts: isCurrent ? reportedAlerts : { total: 0, critical: 0, warning: 0, info: 0 },
    historicalAlerts: isCurrent ? null : reportedAlerts,
    dailyAllReleases: compactMonitoringMetrics(report.dailyAllReleases),
    dailyCurrentRelease: compactMonitoringMetrics(report.dailyCurrentRelease),
    note: !isCurrent
      ? "本地每日监测报告已过期；报告中的告警仅代表历史检查结果，不代表当前生产故障。请重新生成报告后再判断当前状态。"
      : reportedStatus === "critical" ? "当前每日监测报告发现需要处理的告警。" : null
  };
}

function countMonitoringAlerts(alerts) {
  return {
    total: alerts.length,
    critical: alerts.filter((alert) => alert?.severity === "critical").length,
    warning: alerts.filter((alert) => alert?.severity === "warning").length,
    info: alerts.filter((alert) => alert?.severity === "info").length
  };
}

function compactMonitoringMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return null;
  return {
    inputRuns: Number(metrics.inputRuns) || 0,
    feedbackRuns: Number(metrics.feedbackRuns) || 0,
    analysisCompletedRuns: Number(metrics.analysisCompletedRuns) || 0,
    primaryActionRuns: Number(metrics.primaryActionRuns) || 0
  };
}
