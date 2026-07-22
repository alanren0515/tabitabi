import { findCandidates } from "./analyzer.js";

export function createExampleCandidates(query, { inputType = "example" } = {}) {
  return findCandidates(query).map((candidate) => exampleRestaurant(candidate, { inputType }));
}

export function exampleRestaurant(candidate, { inputType = "example" } = {}) {
  const screenshotSample = inputType === "screenshot";
  const base = { ...candidate, sourceMode: "demo", example: true, exampleInputType: inputType };
  if (screenshotSample) return base;
  return {
    ...base,
    dataLabel: "操作サンプル",
    sourceContext: "TabiTabi 操作サンプル",
    summary: "これは操作方法を確認するための架空データです。実在店舗の検索結果ではありません。",
    reasons: ["ユーザーがサンプル体験を選択", "架空データで画面の流れだけを表示", "営業時間・予約・空席の判断には使用できません"],
    conflict: "この情報は操作確認用です。実際の来店や予約には使用しないでください。",
    conflictTitle: "サンプル情報",
    sources: [{ name: "TabiTabi サンプルデータ", note: "画面と操作の確認用。実在店舗の情報ではありません。", official: false, confidence: "low" }]
  };
}

export function isExampleRestaurant(restaurant) {
  return restaurant?.sourceMode === "demo" || restaurant?.example === true;
}
