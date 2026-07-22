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

export function assertAuthorizedEvaluationBudget({ capabilities, authorizedLimits, requiredCalls }) {
  for (const [bucket, required] of Object.entries(requiredCalls)) {
    const authorized = Number.parseInt(String(authorizedLimits[bucket] ?? ""), 10);
    if (!Number.isInteger(authorized) || authorized < 1) {
      throw new Error(`缺少 ${bucket} 的本轮评测授权上限`);
    }
    const state = capabilities?.dailyBudget?.buckets?.[bucket];
    if (!state || !Number.isInteger(state.used) || !Number.isInteger(state.limit)) {
      throw new Error(`服务未提供 ${bucket} 的可验证预算状态`);
    }
    if (state.limit > authorized) {
      throw new Error(`${bucket} 的服务端硬上限 ${state.limit} 高于本轮授权 ${authorized}`);
    }
    if (state.used + required > authorized) {
      throw new Error(`${bucket} 当前已用 ${state.used}，再执行 ${required} 次会超过本轮授权 ${authorized}`);
    }
  }
}
