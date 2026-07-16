export function visibleCandidates(candidates = [], rejectedIds = []) {
  const rejected = new Set(rejectedIds);
  return candidates.filter((candidate) => !rejected.has(candidate.id));
}

const IDENTITY_REASONS = new Set(["店名高度一致", "店名一致", "分店名一致"]);
const LOCATION_REASONS = new Set(["分店名一致", "地址线索一致", "车站线索与分店名一致"]);

function finiteScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

export function candidateDecision(candidates = []) {
  const ranked = [...candidates].sort((left, right) => {
    const leftRank = Number.isFinite(Number(left.rank)) ? Number(left.rank) : Number.MAX_SAFE_INTEGER;
    const rightRank = Number.isFinite(Number(right.rank)) ? Number(right.rank) : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  if (!ranked.length) return { kind: "none", leadId: "", leadScore: 0, scoreGap: 0 };

  const lead = ranked[0];
  const runnerUp = ranked[1];
  const leadScore = finiteScore(lead.matchScore);
  const scoreGap = runnerUp ? leadScore - finiteScore(runnerUp.matchScore) : leadScore;
  const reasons = Array.isArray(lead.matchReasons) ? lead.matchReasons : [];
  const hasIdentityEvidence = reasons.some((reason) => IDENTITY_REASONS.has(reason));
  const hasLocationEvidence = reasons.some((reason) => LOCATION_REASONS.has(reason));

  if (ranked.length === 1 && leadScore >= 18 && hasIdentityEvidence) {
    return { kind: "likely_single", leadId: lead.id, leadScore, scoreGap };
  }
  if (leadScore >= 18 && scoreGap >= 5 && hasIdentityEvidence && hasLocationEvidence) {
    return { kind: "likely_with_alternatives", leadId: lead.id, leadScore, scoreGap };
  }
  return { kind: "ambiguous", leadId: lead.id, leadScore, scoreGap };
}

export function candidateDecisionCopy({ fallback = false, decision, candidateCount = 0, input = "" } = {}) {
  if (fallback) {
    return {
      heading: "我们还不能确定是哪家",
      summary: "当前没有实时数据源，请选择演示候选体验后续流程。"
    };
  }
  if (decision?.kind === "likely_single") {
    return {
      heading: "系统判断最可能是这家",
      summary: `根据“${input}”的店名和位置线索，目前只有一个强匹配结果。仍请你确认。`
    };
  }
  if (decision?.kind === "likely_with_alternatives") {
    return {
      heading: "系统已有首选，也保留其他可能",
      summary: `第一家与“${input}”的线索明显更接近；如果不对，请从其他候选中选择。`
    };
  }
  if (candidateCount === 1) {
    return {
      heading: "目前只找到一个可能候选",
      summary: `这个结果与“${input}”有部分线索一致，但证据还不够强。请核对店名、分店和地址后再确认。`
    };
  }
  return {
    heading: "目前不能唯一确定是哪家",
    summary: `根据“${input}”找到了几个接近的结果，请用店名、分店或地址来判断。`
  };
}

export function rejectCandidate(candidates = [], rejectedIds = [], candidateId = "") {
  if (!candidates.some((candidate) => candidate.id === candidateId)) return [...new Set(rejectedIds)];
  return [...new Set([...rejectedIds, candidateId])];
}

export function restoreCandidates() {
  return [];
}
