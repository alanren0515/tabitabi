import { candidateDecisionCopy } from "./candidate-selection.js";

export function localizedCandidateDecisionCopy({ locale = "ja", translate, fallback = false, decision, candidateCount = 0, input = "" } = {}) {
  if (fallback && locale === "ja") return candidateDecisionCopy({ fallback, decision, candidateCount, input });
  if (fallback) return { heading: translate("candidate.fallbackHeading"), summary: translate("candidate.fallbackSummary") };
  if (decision?.kind === "likely_single") return { heading: translate("candidate.singleHeading"), summary: translate("candidate.singleSummary", { input }) };
  if (decision?.kind === "likely_with_alternatives") return { heading: translate("candidate.leadHeading"), summary: translate("candidate.leadSummary", { input }) };
  if (candidateCount === 1) return { heading: translate("candidate.uncertainHeading"), summary: translate("candidate.uncertainSummary", { input }) };
  return { heading: translate("candidate.ambiguousHeading"), summary: translate("candidate.ambiguousSummary", { input }) };
}
