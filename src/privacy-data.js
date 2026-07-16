import { PENDING_STORAGE_KEY } from "./analysis-queue.js";

export const LOCAL_STORAGE_KEY = "tabitabi-saved";
export const RECENT_STORAGE_KEY = "tabitabi-recent";
export const SETTINGS_STORAGE_KEY = "tabitabi-settings";
export const VISIT_STORAGE_KEY = "tabitabi-visit-state-v1";
export { PENDING_STORAGE_KEY };

export function summarizeLocalData(savedPlans = [], recentAnalyses = [], pendingAnalyses = []) {
  return {
    savedPlanCount: Array.isArray(savedPlans) ? savedPlans.length : 0,
    recentAnalysisCount: Array.isArray(recentAnalyses) ? recentAnalyses.length : 0,
    pendingAnalysisCount: Array.isArray(pendingAnalyses) ? pendingAnalyses.length : 0,
    fields: ["餐厅标识与用户保存的名称", "计划日期、时间、人数和状态", "用户提供的搜索线索与待分析餐厅", "可选预约姓名、试点访问码、默认人数、话术版本和历史记录开关", "保存、分析、首次与最近访问时间"],
    thirdPartyDetailsPersisted: false
  };
}

export function deleteLocalData(storage) {
  storage.removeItem(LOCAL_STORAGE_KEY);
  storage.removeItem(RECENT_STORAGE_KEY);
  storage.removeItem(SETTINGS_STORAGE_KEY);
  storage.removeItem(PENDING_STORAGE_KEY);
  storage.removeItem(VISIT_STORAGE_KEY);
  return { deletedKeys: [LOCAL_STORAGE_KEY, RECENT_STORAGE_KEY, SETTINGS_STORAGE_KEY, PENDING_STORAGE_KEY, VISIT_STORAGE_KEY] };
}
