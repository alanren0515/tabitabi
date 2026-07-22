export const DEFAULT_PROVIDER_INTERVAL_MS = 16_000;

export function providerIntervalFromEnv(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_PROVIDER_INTERVAL_MS), 10);
  return Math.max(0, Number.isFinite(parsed) ? parsed : DEFAULT_PROVIDER_INTERVAL_MS);
}

export function candidateSelectionsForDecision({ report, releaseRevision, caseIds }) {
  if (report?.releaseRevision !== releaseRevision || report?.gatePassed !== true) {
    throw new Error("候选报告必须由同一 release revision 生成并通过门槛");
  }
  const selections = new Map((report.results || []).map((item) => [item.id, item]));
  if (caseIds.some((id) => !selections.get(id)?.matchedPlaceId)) {
    throw new Error("候选报告缺少当前决策案例的已匹配 Place ID");
  }
  return selections;
}
