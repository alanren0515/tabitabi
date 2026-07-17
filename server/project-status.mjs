import { evaluateReleaseEvidence } from "./release-evidence.mjs";

export function buildProjectStatus({
  providers = {}, cases = [], audits = [], matrix = [], candidateReport = null, decisionReport = null, pilotReport = null
} = {}) {
  const fullAudits = audits.filter((item) => item?.status === "audited").length;
  const decisionAudits = audits.filter((item) => ["audited", "decision_audited"].includes(item?.status)).length;
  const completedScenarios = matrix.filter((item) => item?.status === "confirmed").length;
  const confirmedCases = cases.filter((item) => item?.verificationStatus === "confirmed").length;
  const pilot = pilotReport?.metrics || {};
  const releaseEvidence = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults: candidateReport, decisionResults: decisionReport });
  const remaining = {
    mobileAudits: Math.max(30 - fullAudits, 0),
    riskScenarios: Math.max(30 - completedScenarios, 0),
    liveInputRuns: Math.max(20 - (Number(pilot.inputRuns) || 0), 0),
    feedbackRuns: Math.max(10 - (Number(pilot.feedbackRuns) || 0), 0)
  };
  const releaseReady = releaseEvidence.gatePassed;
  const pilotReady = remaining.liveInputRuns === 0 && remaining.feedbackRuns === 0 && pilotReport?.gatePassed === true;
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
      pilotInputRuns: Number(pilot.inputRuns) || 0,
      pilotFeedbackRuns: Number(pilot.feedbackRuns) || 0
    },
    releaseEvidence: { gatePassed: releaseEvidence.gatePassed, blockedBy: releaseEvidence.blockedBy, errors: releaseEvidence.errors },
    remaining,
    optional: providers.openAiFallback ? [] : ["配置 OPENAI_API_KEY 以启用 GPT-5.4 mini 质量备用；Qwen 主流程不因此停止。"],
    nextCommands: remaining.mobileAudits || remaining.riskScenarios
      ? ["npm run audit:mobile", "npm run eval:release-gate"]
      : remaining.liveInputRuns || remaining.feedbackRuns
        ? ["npm run pilot:gate"]
        : ["npm run eval:release-gate", "npm run pilot:gate"]
  };
}
