import { platformForUrl, reservationLinkPriority } from "./reservation-options.mjs";
import { safeFetchHtml, SafeHtmlFetchError, validatePublicHttpUrl } from "./safe-html-fetch.mjs";

export async function discoverReservationLinks({ websiteUri, fetchImpl, requestImpl = fetchImpl, lookupImpl, timeoutMs = 5_000 }) {
  let currentUrl = validatePublicWebsiteUrl(websiteUri);
  if (!currentUrl) return { links: [], status: "invalid_url" };
  let fetched;
  try {
    fetched = await safeFetchHtml({
      url: currentUrl, requestImpl, lookupImpl, timeoutMs,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "TabiTabi-LinkDiscovery/0.1" }
    });
  } catch (error) {
    if (!(error instanceof SafeHtmlFetchError)) throw error;
    const status = error.code === "TOO_LARGE" ? "too_large"
      : ["UNSAFE_HOST", "UNSAFE_REDIRECT", "TOO_MANY_REDIRECTS", "INVALID_URL"].includes(error.code) ? "unsafe_redirect"
        : error.code === "NOT_HTML" ? "not_html" : "upstream_error";
    return { links: [], status };
  }
  const { html, sourceUrl } = fetched;
  currentUrl = sourceUrl;

  const links = [];
  const socialLinks = [];
  for (const anchor of extractAnchors(html)) {
    const href = anchor.href;
    let absolute;
    try { absolute = new URL(decodeHtmlEntities(href), currentUrl).href; } catch { continue; }
    const socialLink = officialSocialLinkForUrl(absolute);
    if (socialLink && !socialLinks.some((item) => item.provider === socialLink.provider && item.handle === socialLink.handle)) socialLinks.push(socialLink);
    const platform = platformForUrl(absolute) || officialBookingLinkForAnchor({ absolute, anchorText: anchor.text, currentUrl });
    if (!platform) continue;
    const candidate = { provider: platform.provider, label: platform.label, url: absolute };
    const existingIndex = links.findIndex((item) => item.provider === platform.provider);
    if (existingIndex < 0) links.push(candidate);
    else if (reservationLinkPriority(platform.provider, absolute) > reservationLinkPriority(platform.provider, links[existingIndex].url)) links[existingIndex] = candidate;
  }
  return {
    links,
    socialLinks,
    reservationPolicy: extractOfficialReservationPolicy(html, currentUrl),
    operationalStatus: extractOfficialOperationalStatus(html, currentUrl),
    officialContact: extractOfficialContact(html, currentUrl),
    diningNotices: extractOfficialDiningNotices(html, currentUrl),
    queuePolicy: extractOfficialQueuePolicy(html, currentUrl),
    status: "success",
    sourceUrl: currentUrl,
    retrievedAt: new Date().toISOString()
  };
}

export function extractOfficialQueuePolicy(html, sourceUrl = "") {
  const text = htmlToVisibleText(html);
  const rules = [
    { mode: "numbered_ticket", label: "整理券取号", pattern: /(?:整理券|番号券)[^。\n]{0,35}(?:配布|発券|お渡し|取得|制)/u },
    { mode: "app_waitlist", label: "App / 网页排队取号", pattern: /(?:(?:順番待ち|ウェイティング|来店受付)[^。\n]{0,45}(?:アプリ|アプリケーション|LINE|EPARK|オンライン|WEB|Web)|(?:アプリ|アプリケーション|LINE|EPARK|オンライン|WEB|Web)[^。\n]{0,45}(?:順番待ち|ウェイティング|来店受付))/u },
    { mode: "name_list", label: "到店登记姓名", pattern: /(?:店頭|店舗|入口)[^。\n]{0,35}(?:記名|お名前.{0,8}(?:記入|ご記入)|受付表)/u },
    { mode: "onsite_queue", label: "现场按顺序排队", pattern: /(?:ご来店順|先着順|店頭にお並び|列にお並び)[^。\n]{0,35}(?:ご案内|受付|入店|ください|いただき)/u }
  ];
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    return {
      mode: rule.mode,
      label: rule.label,
      excerpt: excerptAround(text, match.index, match[0].length),
      sourceUrl,
      certainty: "high"
    };
  }
  return null;
}

export function officialSocialLinkForUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const hostname = url.hostname.toLowerCase();
  if (!['instagram.com', 'www.instagram.com'].includes(hostname)) return null;
  let segments;
  try { segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (segments[0] === '_u') segments = segments.slice(1);
  if (segments.length !== 1) return null;
  const handle = segments[0];
  const reserved = new Set(['accounts', 'about', 'developer', 'directory', 'explore', 'legal', 'p', 'reel', 'reels', 'stories', 'tv']);
  if (reserved.has(handle.toLowerCase()) || !/^[a-z0-9._]{1,30}$/i.test(handle)) return null;
  return { provider: 'instagram', label: 'Instagram', handle: `@${handle}`, url: `https://www.instagram.com/${handle}/` };
}

export function extractOfficialDiningNotices(html, sourceUrl = "") {
  const text = htmlToVisibleText(html);
  const rules = [
    { type: "cash_only", label: "仅限现金", pattern: /(?:お支払い|支払い)[^。\n]{0,20}(?:現金のみ|現金に限)/u },
    { type: "children_restriction", label: "儿童到店限制", pattern: /(?:お子様|子供|未就学児|乳幼児)[^。\n]{0,35}(?:入店不可|ご入店いただけません|利用不可|お断り)/u },
    { type: "seat_charge", label: "可能收取席位费", pattern: /(?:チャージ|席料|テーブルチャージ)(?:料)?\s*[:：]?\s*(?:お一人様)?\s*[¥￥]?\s*\d{2,6}\s*円/u },
    { type: "non_smoking", label: "全席禁烟", pattern: /(?:店内|全席)[^。\n]{0,10}(?:禁煙|禁烟)/u },
    { type: "dress_code", label: "着装要求", pattern: /(?:ドレスコード|服装)[^。\n]{0,45}(?:お願い|ご遠慮|禁止|着用)/u }
  ];
  return rules.flatMap((rule) => {
    const match = rule.pattern.exec(text);
    return match ? [{ type: rule.type, label: rule.label, excerpt: excerptAround(text, match.index, match[0].length), sourceUrl, certainty: "high" }] : [];
  });
}

export function extractOfficialOperationalStatus(html, sourceUrl = "") {
  const text = htmlToVisibleText(html);
  const firstOperatingRule = firstMatchIndex(text, [
    /(?:当店|本店|この店舗)[^。\n]{0,32}(?:通常通り|通常どおり)営業/u,
    /(?:当店|本店|この店舗)[^。\n]{0,32}営業を再開/u
  ]);
  const rules = [
    /(?:誠に勝手ながら[、,]?\s*)?当面の間(?:[、,]?\s*)(?:臨時)?休業(?:と|させて|いたし|致し)/u,
    /(?:店舗|レストラン|当店)[^。\n]{0,40}当面の間(?:[、,]?\s*)(?:臨時)?休業/u
  ];
  for (const rule of rules) {
    const match = rule.exec(text);
    if (!match) continue;
    if (firstOperatingRule >= 0 && firstOperatingRule < match.index) return null;
    return {
      status: "temporarily_closed",
      businessStatus: "CLOSED_TEMPORARILY",
      certainty: "high",
      excerpt: excerptAround(text, match.index, match[0].length),
      sourceUrl
    };
  }
  return null;
}

export function extractOfficialContact(html, sourceUrl = "") {
  const text = htmlToVisibleText(html);
  const match = text.match(/(?:電話番号|電話|TEL)\s*[:：]?\s*((?:0\d{1,4})[-‐‑‒–—―−ー\s]\d{1,4}[-‐‑‒–—―−ー\s]\d{3,4})/iu);
  if (!match) return null;
  return {
    phone: match[1].replace(/[‐‑‒–—―−ー\s]+/g, "-"),
    excerpt: excerptAround(text, match.index, match[0].length),
    sourceUrl
  };
}

export function extractOfficialReservationPolicy(html, sourceUrl = "") {
  const text = htmlToVisibleText(html);
  const limitedPolicy = extractLimitedReservationPolicyMatch(text, sourceUrl);
  const firstPositiveRule = firstMatchIndex(text, [
    /(?:ご)?予約\s*[:：]?\s*(?:は)?\s*(?:可能|可)(?!否)/u,
    /予約\s*[:：]?\s*(?:平日のみ|土日祝のみ|\d{1,2}時[^\n。]{0,24})?\s*\d+名様から可能/u,
    /(?:ご)?予約\s*(?:を)?\s*(?:承って|受け付けて|受付して)\s*おります/u
  ]);
  const rules = [
    /(?:ご)?予約\s*(?:は|を)?\s*(?:承って|承つて|受け付けて|受けつけて|受付して|お受けして)\s*(?:おりません|いません)/u,
    /(?:ご)?予約\s*(?:は)?\s*(?:できません|いただけません|承りません)/u,
    /予約\s*(?:は|を)?\s*(?:行って|行つて)\s*おりません/u,
    /予約\s*可否\s*[:：]?\s*予約\s*[:：]?\s*不可(?!\s*の(?:日時|日|時間|席))/u,
    /(?:^|[。！？!\n・｜|])\s*(?:ご)?予約\s*[:：]?\s*不可(?!\s*の(?:日時|日|時間|席))/u
  ];
  let notAcceptedPolicy = null;
  for (const rule of rules) {
    const match = rule.exec(text);
    if (!match) continue;
    const matchedText = match[0].replace(/^[。！？!\n・｜|]\s*/u, "").trim();
    const matchStart = match.index + match[0].indexOf(matchedText);
    if (firstPositiveRule >= 0 && firstPositiveRule < matchStart) break;
    notAcceptedPolicy = {
      status: "not_accepted",
      certainty: "high",
      excerpt: matchedText.replace(/\s+/g, " ").trim(),
      sourceUrl,
      matchIndex: matchStart
    };
    break;
  }
  const selected = !limitedPolicy
    ? notAcceptedPolicy
    : !notAcceptedPolicy
      ? limitedPolicy
      : limitedPolicy.matchIndex < notAcceptedPolicy.matchIndex
        ? limitedPolicy
        : notAcceptedPolicy;
  if (!selected) return null;
  const { matchIndex, ...policy } = selected;
  return policy;
}

function extractLimitedReservationPolicyMatch(text, sourceUrl) {
  const firstUnrestrictedPositive = firstMatchIndex(text, [
    /(?:ご)?予約\s*[:：]?\s*(?:は)?\s*(?:可能|可)(?!否)/u,
    /(?:ご)?予約\s*(?:を)?\s*(?:承って|受け付けて|受付して)\s*おります/u
  ]);
  const rules = [
    { restrictionType: "weekdays_only", label: "仅平日接受预约", pattern: /(?:予約可否\s*[:：]?\s*)?(?:ご)?予約(?:は|を)?[^。\n]{0,18}平日のみ[^。\n]{0,18}(?:可能|承|受付|受け付)/u },
    { restrictionType: "weekends_only", label: "仅周末及节假日接受预约", pattern: /(?:予約可否\s*[:：]?\s*)?(?:ご)?予約(?:は|を)?[^。\n]{0,18}(?:土日祝|土曜・日曜・祝日)(?:のみ)?[^。\n]{0,18}(?:可能|承|受付|受け付)/u },
    { restrictionType: "dinner_only", label: "仅晚餐时段接受预约", pattern: /(?:予約可否\s*[:：]?\s*)?(?:ご)?予約(?:は|を)?[^。\n]{0,18}(?:ディナー|夜)(?:タイム)?のみ[^。\n]{0,18}(?:可能|承|受付|受け付)?/u },
    { restrictionType: "lunch_unavailable", label: "午餐时段不接受预约", pattern: /(?:ランチ|昼)(?:タイム|営業)?の?(?:ご)?予約(?:は|を)?[^。\n]{0,24}(?:承っておりません|受け付けておりません|お受けしておりません|不可|できません)/u },
    { restrictionType: "minimum_party", label: "达到指定人数才接受预约", pattern: /(?:ご)?予約(?:は|を)?[^。\n]{0,20}(\d{1,2})名(?:様)?(?:以上|から)[^。\n]{0,20}(?:可能|承|受付|受け付)/u }
  ];
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    if (firstUnrestrictedPositive >= 0 && firstUnrestrictedPositive < match.index) return null;
    return {
      status: "limited",
      restrictionType: rule.restrictionType,
      label: rule.label,
      minimumParty: rule.restrictionType === "minimum_party" ? Number(match[1]) : null,
      certainty: "high",
      excerpt: match[0].replace(/\s+/g, " ").trim(),
      sourceUrl,
      matchIndex: match.index
    };
  }
  return null;
}

function firstMatchIndex(text, rules) {
  return rules.reduce((earliest, rule) => {
    const index = text.search(rule);
    return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
  }, -1);
}

export function validatePublicWebsiteUrl(value) {
  return validatePublicHttpUrl(value);
}

function extractAnchors(html) {
  return [...String(html).matchAll(/<a\b([^>]*)>([^]*?)<\/a\s*>/gi)].flatMap((match) => {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1] || "");
    if (!href) return [];
    return [{ href: href[1] || href[2] || href[3] || "", text: htmlToVisibleText(match[2] || "") }];
  });
}

function officialBookingLinkForAnchor({ absolute, anchorText, currentUrl }) {
  let target;
  let source;
  try {
    target = new URL(absolute);
    source = new URL(currentUrl);
  } catch {
    return null;
  }
  if (target.origin !== source.origin) return null;
  if (!/(?:予約(?:する|はこちら|受付|ページ)?|reserve|reservation|book(?:ing)?)/iu.test(anchorText)) return null;
  if (!/(?:^|\/)(?:reserve|reservation|booking|yoyaku|plan(?:_list)?)(?:[\/_.-]|$)/i.test(target.pathname)) return null;
  return { provider: "official_booking", label: "官网预约" };
}

function decodeHtmlEntities(value) {
  return String(value).replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/");
}

function htmlToVisibleText(html) {
  return String(html)
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|li|section|article|header|footer|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .normalize("NFKC")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function excerptAround(text, start, length) {
  const left = Math.max(0, start - 45);
  const right = Math.min(text.length, start + length + 45);
  return `${left ? "…" : ""}${text.slice(left, right).replace(/\s+/g, " ").trim()}${right < text.length ? "…" : ""}`;
}
