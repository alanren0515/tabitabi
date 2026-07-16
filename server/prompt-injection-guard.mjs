const INSTRUCTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)\b/iu,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/iu,
  /\b(?:act|respond|answer)\s+as\s+(?:the\s+)?(?:system|assistant|developer)\b/iu,
  /(?:忽略|无视)(?:此前|之前|以上|上面|所有|全部)(?:的)?(?:指令|提示|规则|要求)/u,
  /(?:系统|开发者)(?:提示词|消息|指令)/u,
  /(?:请|必须)(?:改为|只|直接)?(?:输出|返回)(?:密码|密钥|系统提示|提示词)/u,
  /(?:以前|先ほど|上記|これまで)(?:の)?(?:指示|命令|プロンプト)(?:を)?(?:無視|忘れ)/u,
  /(?:システム|開発者)(?:プロンプト|メッセージ|指示)/u,
  /(?:命令|指示)(?:に)?従(?:え|って)(?:出力|回答)/u
];

const RESTAURANT_FIELDS = ["name", "branch", "category", "address", "area", "nearest_station"];

export function containsInstructionLikeText(value) {
  const text = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  return Boolean(text && INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text)));
}

export function guardVisionIdentityFields(extraction) {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return { extraction, hits: [] };
  const guarded = structuredClone(extraction);
  const hits = [];
  inspectRestaurant(guarded.restaurant, "restaurant", hits);
  for (const [index, restaurant] of (guarded.restaurants || []).entries()) inspectRestaurant(restaurant, `restaurants[${index}]`, hits);
  if (containsInstructionLikeText(guarded.search_query)) hits.push("search_query");
  if (!hits.length) return { extraction: guarded, hits };

  guarded.overall_confidence = "low";
  const uniqueHits = [...new Set(hits)];
  const warning = `识别到疑似指令式文字（字段：${uniqueHits.join("、")}）；该文字只作为截图内容，不会被执行。请人工核对餐厅身份后再继续。`;
  const warnings = Array.isArray(guarded.warnings) ? guarded.warnings.filter((item) => item !== warning) : [];
  guarded.warnings = [...warnings.slice(0, 11), warning];
  return { extraction: guarded, hits: uniqueHits };
}

function inspectRestaurant(restaurant, prefix, hits) {
  if (!restaurant || typeof restaurant !== "object" || Array.isArray(restaurant)) return;
  for (const field of RESTAURANT_FIELDS) {
    if (containsInstructionLikeText(restaurant[field])) hits.push(`${prefix}.${field}`);
  }
}
