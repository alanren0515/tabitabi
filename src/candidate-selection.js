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
      heading: "店舗をまだ特定できません",
      summary: "現在は実データを取得できないため、デモ候補で後続の流れを確認できます。"
    };
  }
  if (decision?.kind === "likely_single") {
    return {
      heading: "このお店ですか？",
      summary: "店名と住所が合っていれば、そのまま進んでください。"
    };
  }
  if (decision?.kind === "likely_with_alternatives") {
    return {
      heading: "このお店ですか？",
      summary: "違う場合は、ほかの候補を選べます。"
    };
  }
  if (candidateCount === 1) {
    return {
      heading: "このお店ですか？",
      summary: "店名・支店・住所を確認してください。"
    };
  }
  return {
    heading: "どのお店ですか？",
    summary: "店名と住所を見比べて選んでください。"
  };
}

export function rejectCandidate(candidates = [], rejectedIds = [], candidateId = "") {
  if (!candidates.some((candidate) => candidate.id === candidateId)) return [...new Set(rejectedIds)];
  return [...new Set([...rejectedIds, candidateId])];
}

export function restoreCandidates() {
  return [];
}
