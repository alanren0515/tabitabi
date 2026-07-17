export function buildSharePayload(restaurant = {}) {
  const name = clean(restaurant.name) || "店舗";
  const area = clean(restaurant.area);
  const recommendation = {
    strongly_recommended: "予約を強くおすすめ",
    recommended: "予約をおすすめ",
    walk_in_ok: "适合现场去",
    temporarily_unavailable: "来店前に営業状況を要確認",
    unknown: "予約情報は未確認"
  }[restaurant.recommendation] || "予約情報は未確認";
  const summary = clean(restaurant.summary);
  const nextAction = clean(restaurant.nextAction);
  const address = clean(restaurant.address);
  const url = safeHttpUrl(restaurant.mapSearchUrl || restaurant.primaryAction?.url || "");
  const lines = [
    `TabiTabi 店舗確認：${name}${area ? `（${area}）` : ""}`,
    `確認結果：${recommendation}`,
    summary ? `依据：${summary}` : "",
    nextAction ? `下一步：${nextAction}` : "",
    address ? `地址：${address}` : "",
    url ? `確認リンク：${url}` : "",
    "予約成立は、店舗または予約サービスの確認画面・確認通知で判断してください。"
  ].filter(Boolean);
  return { title: `${name}｜TabiTabi`, text: lines.join("\n"), ...(url ? { url } : {}) };
}

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500); }
function safeHttpUrl(value) {
  try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
}
