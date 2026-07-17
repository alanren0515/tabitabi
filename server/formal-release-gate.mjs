import { evaluatePilotGate } from "./pilot-metrics.mjs";

export const FORMAL_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export function evaluateFormalReleaseGate({
  releaseEvidence,
  pilotEvidence,
  preflightEvidence,
  flyEvidence,
  smokeEvidence,
  app = "tabitabi-jp",
  currentRevision = "",
  repositoryClean = false,
  now = Date.now(),
  maxAgeMs = FORMAL_EVIDENCE_MAX_AGE_MS
} = {}) {
  const recomputedPilot = evaluatePilotGate(pilotEvidence?.metrics || {});
  const pilotConsistent = pilotEvidence?.gatePassed === recomputedPilot.gatePassed
    && sameMap(pilotEvidence?.gates, recomputedPilot.gates)
    && sameList(pilotEvidence?.blockedBy, recomputedPilot.blockedBy);
  const pilotProvenance = pilotEvidence?.schemaVersion === 1 && pilotEvidence?.source === "fly-volume"
    && pilotEvidence?.app === app && pilotEvidence?.volume === "tabitabi_data";
  const revisions = [releaseEvidence?.revision, preflightEvidence?.revision, flyEvidence?.revision, smokeEvidence?.revision,
    smokeEvidence?.releaseRevision, pilotEvidence?.auditRevision, pilotEvidence?.releaseRevision];
  const sameRevision = /^[a-f0-9]{40}$/.test(currentRevision) && revisions.every((value) => value === currentRevision);
  const imageDigest = String(flyEvidence?.deployment?.imageDigest || "");
  const imageTag = String(flyEvidence?.deployment?.imageTag || "");
  const sameImage = /^sha256:[a-f0-9]{64}$/.test(imageDigest) && /^deployment-[A-Z0-9]+$/.test(imageTag)
    && String(pilotEvidence?.imageRef || "").endsWith(`:${imageTag}`);
  const deployedAt = Date.parse(String(flyEvidence?.deployment?.releaseCreatedAt || ""));
  const evidenceAfterDeployment = Number.isFinite(deployedAt) && [releaseEvidence, pilotEvidence, preflightEvidence, flyEvidence, smokeEvidence]
    .every((report) => Date.parse(String(report?.generatedAt || "")) >= deployedAt);
  const gates = {
    repositoryClean: repositoryClean === true && [releaseEvidence, pilotEvidence, preflightEvidence, flyEvidence, smokeEvidence].every((report) => report?.repositoryClean === true),
    releaseRevision: sameRevision,
    deployedImage: sameImage && evidenceAfterDeployment,
    technicalRelease: releaseEvidence?.gatePassed === true && fresh(releaseEvidence, now, maxAgeMs),
    productionPilot: pilotProvenance && pilotConsistent && recomputedPilot.gatePassed === true && fresh(pilotEvidence, now, maxAgeMs),
    deploymentPreflight: preflightEvidence?.passed === true && fresh(preflightEvidence, now, maxAgeMs),
    flyRemoteState: flyEvidence?.passed === true && flyEvidence?.app === app && fresh(flyEvidence, now, maxAgeMs),
    providerFreeSmoke: smokeEvidence?.passed === true && smokeEvidence?.live === false
      && smokeEvidence?.baseUrl === `https://${app}.fly.dev` && fresh(smokeEvidence, now, maxAgeMs)
  };
  const blockedBy = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    generatedAt: new Date(now).toISOString(),
    app,
    releaseId: sameRevision && /^sha256:[a-f0-9]{64}$/.test(imageDigest) ? `${app}:${currentRevision}:${imageDigest}` : null,
    gatePassed: blockedBy.length === 0,
    gates,
    blockedBy,
    pilot: {
      inputRuns: pilotEvidence?.metrics?.inputRuns ?? 0,
      feedbackRuns: pilotEvidence?.metrics?.feedbackRuns ?? 0,
      actionRate: pilotEvidence?.metrics?.actionRate ?? null,
      helpfulRate: pilotEvidence?.metrics?.helpfulRate ?? null,
      pilotBlockedBy: recomputedPilot.blockedBy
    },
    note: "正式发布要求技术评测、线上真实 pilot、部署预检、Fly 远端状态和 provider-free smoke 同时通过；任何报告超过 24 小时必须重新生成。"
  };
}

function sameMap(left, right) {
  const keys = Object.keys(right || {});
  return keys.length > 0 && keys.length === Object.keys(left || {}).length && keys.every((key) => left?.[key] === right[key]);
}

function sameList(left, right) {
  return Array.isArray(left) && Array.isArray(right) && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function fresh(report, now, maxAgeMs) {
  const generatedAt = Date.parse(String(report?.generatedAt || ""));
  return Number.isFinite(generatedAt) && generatedAt <= now && now - generatedAt <= maxAgeMs;
}
