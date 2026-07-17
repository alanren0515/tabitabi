import { demoRestaurants } from "./data.js";

export function normalizeInput(value = "") {
  return value.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function scoreRestaurant(input, restaurant) {
  const normalized = normalizeInput(input);
  if (!normalized) return 0;
  return restaurant.matchTerms.reduce((score, term) => {
    const normalizedTerm = normalizeInput(term);
    if (!normalized.includes(normalizedTerm)) return score;
    return score + (normalizedTerm.length >= 3 ? 3 : 2);
  }, 0);
}

export function findCandidates(input, limit = 3) {
  const ranked = demoRestaurants
    .map((restaurant) => ({ restaurant, score: scoreRestaurant(input, restaurant) }))
    .sort((a, b) => b.score - a.score);
  const matches = ranked.filter((item) => item.score > 0);
  return (matches.length ? matches : ranked)
    .slice(0, limit)
    .map((item, index) => ({ ...item.restaurant, matchScore: item.score, isFallback: matches.length === 0, rank: index + 1 }));
}

export function recommendationLabel(value) {
  return {
    strongly_recommended: "予約を強く推奨",
    recommended: "予約がおすすめ",
    walk_in_ok: "直接来店を検討",
    temporarily_unavailable: "来店は一旦見送り",
    unknown: "情報を確認中"
  }[value] || "情報を確認中";
}

export function confidenceLabel(value) {
  return { high: "確度：高", medium: "確度：中", low: "確度：低" }[value] || "確度：低";
}

export function buildPhoneScript({ date, time, party = 2, name, mode = "reservation", now = new Date() } = {}) {
  const jaDate = formatPhoneDate(date, "ja", now) || "ご希望の日付";
  const jaTime = formatPhoneTime(time, "ja") || "ご希望の時間";
  const zhDate = formatPhoneDate(date, "zh", now) || "希望日期";
  const zhTime = formatPhoneTime(time, "zh") || "希望时间";
  const reservationName = String(name || "").trim();
  const jaNameSentence = reservationName ? `名前は${reservationName}です。` : "";
  const zhNameSentence = reservationName ? `我的名字是${reservationName}。` : "";
  if (mode === "walk_in") {
    return {
      ja: `お忙しいところ失礼いたします。${jaDate}の${jaTime}ごろに${party}名で伺いたいのですが、営業していますか。予約なしで伺う場合、待ち時間の目安はありますでしょうか。`,
      zh: `您好，打扰了。我们想在${zhDate}${zhTime}左右 ${party} 位到店，请问当天营业吗？不预约直接到店的话，通常需要等候多久？`,
      jaShort: `${jaDate}の${jaTime}ごろ、${party}名で伺えますか。待ち時間はありますか。`,
      zhShort: `${zhDate}${zhTime}左右 ${party} 位可以到店吗？需要等候吗？`,
      jaEasy: `すみません。日本語があまり話せません。ゆっくりお願いできますか。${jaDate}、${jaTime}ごろ、${party}名で行きたいです。営業していますか。予約なしでも大丈夫ですか。待ち時間はありますか。`,
      zhEasy: `不好意思，我不太会说日语，可以请您说慢一点吗？我们想在${zhDate}${zhTime}左右 ${party} 位到店。当天营业吗？不预约也可以吗？需要等候吗？`
    };
  }
  return {
    ja: `お忙しいところ失礼いたします。${jaDate}の${jaTime}ごろに、${party}名で予約できますでしょうか。${jaNameSentence}`,
    zh: `您好，打扰了。请问${zhDate}${zhTime}左右，可以预约 ${party} 位吗？${zhNameSentence}`,
    jaShort: `${jaDate}の${jaTime}ごろ、${party}名で予約できますか。${jaNameSentence}`,
    zhShort: `${zhDate}${zhTime}左右可以预约 ${party} 位吗？${zhNameSentence}`,
    jaEasy: `すみません。日本語があまり話せません。ゆっくりお願いできますか。${jaDate}、${jaTime}ごろ、${party}名です。予約できますか。${jaNameSentence}`,
    zhEasy: `不好意思，我不太会说日语，可以请您说慢一点吗？想预约${zhDate}${zhTime}左右，${party} 位。${zhNameSentence}`
  };
}

function formatPhoneDate(value, locale, now) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return text;
  const includeYear = Number.isFinite(now?.getFullYear?.()) && year !== now.getFullYear();
  return `${includeYear ? `${year}年` : ""}${month}月${day}日`;
}

function formatPhoneTime(value, locale) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return text;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (locale === "ja") return `${hour}時${minute ? `${minute}分` : ""}`;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
