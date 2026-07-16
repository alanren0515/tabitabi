export function buildSharePayload(restaurant = {}) {
  const name = clean(restaurant.name) || "餐厅";
  const area = clean(restaurant.area);
  const recommendation = {
    strongly_recommended: "强烈建议预约",
    recommended: "建议预约",
    walk_in_ok: "适合现场去",
    temporarily_unavailable: "暂不推荐前往",
    unknown: "预约信息不足"
  }[restaurant.recommendation] || "预约信息不足";
  const summary = clean(restaurant.summary);
  const nextAction = clean(restaurant.nextAction);
  const address = clean(restaurant.address);
  const url = safeHttpUrl(restaurant.mapSearchUrl || restaurant.primaryAction?.url || "");
  const lines = [
    `TabiTabi 餐厅行动建议：${name}${area ? `（${area}）` : ""}`,
    `结论：${recommendation}`,
    summary ? `依据：${summary}` : "",
    nextAction ? `下一步：${nextAction}` : "",
    address ? `地址：${address}` : "",
    url ? `核对链接：${url}` : "",
    "预约是否成立请以餐厅、平台确认页或确认通知为准。"
  ].filter(Boolean);
  return { title: `${name}｜TabiTabi`, text: lines.join("\n"), ...(url ? { url } : {}) };
}

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500); }
function safeHttpUrl(value) {
  try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
}
