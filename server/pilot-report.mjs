import { readFile } from "node:fs/promises";
import { evaluatePilotGate, summarizePilotMetrics } from "./pilot-metrics.mjs";

export const PILOT_REPORT_NOTE = "正式远端报告只计算当前部署版本中 trafficType=product、sourceMode=live 且带一次性 analysisRunId 的流程；审计、演示和其他版本事件不进入试用门槛。7 日回访与付费意愿分布只报告，不作为当前通过条件。";

export async function loadPilotReport(eventsPath, now = new Date(), { releaseRevision = "" } = {}) {
  const events = await readEventLines(eventsPath);
  const metrics = summarizePilotMetrics(events, { releaseRevision });
  return {
    generatedAt: now.toISOString(),
    ...evaluatePilotGate(metrics),
    metrics,
    note: PILOT_REPORT_NOTE
  };
}

export async function readEventLines(path) {
  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
