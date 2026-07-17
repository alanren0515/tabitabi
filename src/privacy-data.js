import { PENDING_STORAGE_KEY } from "./analysis-queue.js";
import { PILOT_ACCESS_SESSION_KEY } from "./settings.js";

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
    fields: ["店舗識別子と保存した名称", "予定日・時間・人数・状況", "入力した検索の手掛かりと確認待ちの店舗", "任意の予約名・既定人数・電話文例・履歴設定", "保存・確認・初回および最終アクセス時刻"],
    sessionFields: ["招待アクセスコード（現在のタブを閉じると消去）"],
    thirdPartyDetailsPersisted: false
  };
}

export function deleteLocalData(storage, sessionStorage) {
  storage.removeItem(LOCAL_STORAGE_KEY);
  storage.removeItem(RECENT_STORAGE_KEY);
  storage.removeItem(SETTINGS_STORAGE_KEY);
  storage.removeItem(PENDING_STORAGE_KEY);
  storage.removeItem(VISIT_STORAGE_KEY);
  sessionStorage?.removeItem(PILOT_ACCESS_SESSION_KEY);
  return { deletedKeys: [LOCAL_STORAGE_KEY, RECENT_STORAGE_KEY, SETTINGS_STORAGE_KEY, PENDING_STORAGE_KEY, VISIT_STORAGE_KEY, PILOT_ACCESS_SESSION_KEY] };
}
