const RESTAURANT_ALIASES = [
  { canonical: "一蘭", aliases: ["一兰拉面", "一蘭拉麵", "一兰", "一蘭"] },
  { canonical: "一風堂", aliases: ["一风堂拉面", "一風堂拉麵", "一风堂", "一風堂"] },
  { canonical: "鳥貴族", aliases: ["鸟贵族", "鳥貴族"] },
  { canonical: "すしざんまい", aliases: ["寿司三昧", "壽司三昧", "すしざんまい"] },
  { canonical: "かに道楽", aliases: ["蟹道乐", "蟹道樂", "かに道楽"] },
  { canonical: "牛たん炭焼 利久", aliases: ["牛舌利久", "牛舌 利久", "牛たん炭焼 利久"] },
  { canonical: "矢場とん", aliases: ["矢场味噌猪排", "矢場味噌豬排", "矢場とん"] },
  { canonical: "串かつだるま", aliases: ["达摩炸串", "達摩炸串", "串かつだるま"] }
];

const LOCATION_REPLACEMENTS = [
  ["难波", "なんば"], ["難波", "なんば"], ["涩谷", "渋谷"], ["澀谷", "渋谷"],
  ["银座", "銀座"], ["东京", "東京"], ["福冈", "福岡"], ["横滨", "横浜"]
];

export function expandRestaurantAlias(value) {
  const original = String(value || "").normalize("NFKC").trim();
  let queryText = original;
  for (const [from, to] of LOCATION_REPLACEMENTS) queryText = queryText.replaceAll(from, to);
  const compact = queryText.toLowerCase().replace(/\s+/g, "");
  const match = RESTAURANT_ALIASES
    .flatMap((entry) => entry.aliases.map((alias) => ({ ...entry, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .find((entry) => compact.includes(entry.alias.normalize("NFKC").toLowerCase().replace(/\s+/g, "")));
  if (!match) return { canonicalName: "", matchedAlias: "", queryText, expanded: queryText !== original };

  const escaped = match.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  queryText = queryText.replace(new RegExp(escaped, "iu"), match.canonical);
  return {
    canonicalName: match.canonical,
    matchedAlias: match.alias,
    queryText,
    expanded: match.canonical !== match.alias || queryText !== original
  };
}
