const PUBLIC_SMOKE_CHECKS = ["health", "readiness", "capabilities", "pilot", "pilotContent", "privacy", "terms"];
const LEGAL_SCOPES = ["terms", "privacy", "cross_border_processing"];
const RESTORE_CHECKS = ["snapshotAvailable", "restoreCompleted", "eventsReadable", "budgetReadable", "circuitStateReadable", "noSecondProductionMachine"];
const ALERT_CHECKS = ["flyRestartAlert", "providerBudgetAlert", "emergencyStopAlert", "recipientVerified", "drillDelivered"];

export function evaluatePublicLaunchGate({
  formalEvidence,
  publicSmokeEvidence,
  flyEvidence,
  legalReviewEvidence,
  restoreDrillEvidence,
  alertingEvidence,
  app = "tabitabi-jp",
  currentRevision = "",
  repositoryClean = false,
  now = Date.now()
} = {}) {
  const revisionValid = /^[a-f0-9]{40}$/.test(currentRevision);
  const revisionMatches = revisionValid && [formalEvidence?.releaseId?.split(":")[1], publicSmokeEvidence?.revision,
    publicSmokeEvidence?.releaseRevision, flyEvidence?.revision, legalReviewEvidence?.revision].every((value) => value === currentRevision);
  const imageDigest = String(flyEvidence?.deployment?.imageDigest || "");
  const releaseIdMatches = formalEvidence?.releaseId === `${app}:${currentRevision}:${imageDigest}`;
  const publicSmokeAfterDeployment = Date.parse(String(publicSmokeEvidence?.generatedAt || "")) >= Date.parse(String(flyEvidence?.deployment?.releaseCreatedAt || ""));
  const gates = {
    repositoryClean: repositoryClean === true && [formalEvidence, publicSmokeEvidence, flyEvidence].every((item) => item?.repositoryClean === true),
    sameRelease: revisionMatches && releaseIdMatches,
    closedPilotGate: formalEvidence?.gatePassed === true && fresh(formalEvidence, now, 24 * 60 * 60 * 1_000),
    publicDeployment: publicSmokeEvidence?.passed === true && publicSmokeEvidence?.live === false
      && publicSmokeEvidence?.releaseMode === "public" && publicSmokeAfterDeployment
      && exactTrueMap(publicSmokeEvidence?.checks, PUBLIC_SMOKE_CHECKS) && fresh(publicSmokeEvidence, now, 24 * 60 * 60 * 1_000),
    flyPublicState: flyEvidence?.passed === true && flyEvidence?.app === app
      && flyEvidence?.checks?.exactlyOneMachine === true && flyEvidence?.checks?.healthChecksPassing === true
      && flyEvidence?.checks?.requiredSecretsDeployed === true && fresh(flyEvidence, now, 24 * 60 * 60 * 1_000),
    legalReview: legalReviewEvidence?.approved === true && legalReviewEvidence?.operatorName === "Ren"
      && legalReviewEvidence?.contactEmail === "rgq.alan515@gmail.com"
      && LEGAL_SCOPES.every((scope) => legalReviewEvidence?.scopes?.includes(scope))
      && fresh(legalReviewEvidence, now, 90 * 24 * 60 * 60 * 1_000),
    restoreDrill: restoreDrillEvidence?.passed === true && restoreDrillEvidence?.app === app
      && restoreDrillEvidence?.volume === "tabitabi_data" && exactTrueMap(restoreDrillEvidence?.checks, RESTORE_CHECKS)
      && fresh(restoreDrillEvidence, now, 90 * 24 * 60 * 60 * 1_000),
    alertingDrill: alertingEvidence?.passed === true && alertingEvidence?.app === app
      && exactTrueMap(alertingEvidence?.checks, ALERT_CHECKS) && fresh(alertingEvidence, now, 30 * 24 * 60 * 60 * 1_000)
  };
  const blockedBy = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    generatedAt: new Date(now).toISOString(),
    app,
    revision: revisionValid ? currentRevision : null,
    gatePassed: blockedBy.length === 0,
    gates,
    blockedBy,
    note: "公开发布必须在同一代码与镜像上完成封闭试点门禁、明确公开模式冒烟、法律审阅、恢复演练和告警演练。"
  };
}

function exactTrueMap(value, expectedKeys) {
  const keys = Object.keys(value || {}).sort();
  return JSON.stringify(keys) === JSON.stringify([...expectedKeys].sort()) && expectedKeys.every((key) => value[key] === true);
}

function fresh(report, now, maxAgeMs) {
  const generatedAt = Date.parse(String(report?.generatedAt || report?.reviewedAt || ""));
  return Number.isFinite(generatedAt) && generatedAt <= now && now - generatedAt <= maxAgeMs;
}
