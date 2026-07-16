import { expandRestaurantAlias } from "./restaurant-aliases.mjs";
import { platformForUrl, reservationLinkPriority } from "./reservation-options.mjs";

const SOCIAL_HOSTS = [
  { platform: "tiktok", hosts: ["tiktok.com", "vm.tiktok.com"] },
  { platform: "instagram", hosts: ["instagram.com"] },
  { platform: "xiaohongshu", hosts: ["xiaohongshu.com", "xhslink.com"] },
  { platform: "x", hosts: ["x.com", "twitter.com"] }
];

const DATE_PATTERN_SOURCE = String.raw`(?:(?<yearA>\d{4})[年\/-](?<monthA>\d{1,2})[月\/-](?<dayA>\d{1,2})日?|(?<monthB>\d{1,2})月(?<dayB>\d{1,2})日?|(?<![\p{L}\p{N}\/-])(?<monthC>\d{1,2})\/(?<dayC>\d{1,2})(?![\d\/-]))`;
const AREA_NAMES = new Set(["東京", "東京都", "大阪", "京都", "福岡", "札幌", "名古屋", "新宿", "銀座", "渋谷", "上野", "池袋", "六本木", "浅草", "横浜", "神保町", "淡路町", "小川町", "神田", "御茶ノ水"]);

export function parseTextInput(value) {
  const text = String(value || "").normalize("NFKC").trim();
  if (!text) throw new TextInputError("EMPTY_INPUT", "Text input is required", 400);
  if (text.length > 4000) throw new TextInputError("INPUT_TOO_LONG", "Text input is too long", 413);

  const urls = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => safeUrl(match[0])).filter(Boolean);
  const socialLinks = urls.map(classifySocialUrl).filter(Boolean);
  const reservationLinks = urls.map(classifyReservationPlatformUrl).filter(Boolean);
  const webpageLinks = urls
    .filter((item) => !classifySocialUrl(item) && !classifyReservationPlatformUrl(item))
    .map((item) => ({ platform: "web", label: "公开网页", url: item.url.href }));
  const textWithoutUrls = urls.reduce((current, url) => current.replace(url.original, " "), text);
  const plan = extractPlan(textWithoutUrls);
  const clues = extractRestaurantClues(textWithoutUrls, plan);
  const mentionedPlatform = detectMentionedSocialPlatform(textWithoutUrls);
  const linkOnly = socialLinks.length > 0 && !clues.name;
  const reservationLinkOnly = reservationLinks.length > 0 && !clues.name && !linkOnly;
  const webpageOnly = webpageLinks.length > 0 && !clues.name && !linkOnly && !reservationLinkOnly;
  const primaryLink = socialLinks[0] || reservationLinks[0] || webpageLinks[0] || mentionedPlatform;

  return {
    kind: linkOnly ? "social_link" : reservationLinkOnly ? "reservation_link" : webpageOnly ? "webpage_link" : "text_clues",
    platform: primaryLink?.platform || "other",
    platformLabel: primaryLink?.label || "",
    contentRead: false,
    links: [...socialLinks, ...reservationLinks, ...webpageLinks],
    clues,
    plan,
    searchQuery: [clues.name, clues.branch, clues.area, clues.address, clues.nearest_station].filter(Boolean).join(" "),
    requiresContent: linkOnly || reservationLinkOnly,
    requiresWebpage: webpageOnly,
    warnings: linkOnly
      ? ["系统只识别了链接所属平台，未读取登录后或动态加载的帖子正文", "请补充截图、帖子正文或餐厅名后再匹配店铺"]
      : reservationLinkOnly
        ? [
            `系统识别出 ${primaryLink.label} ${primaryLink.linkType === "booking_flow" ? "预约路径" : "店铺/平台链接"}，但不会抓取该第三方平台页面正文`,
            "链接本身不能证明对应哪家分店或预约已经成立；请补充截图、餐厅名或地址后再核对"
          ]
      : webpageOnly
        ? ["系统尚未读取这个公开网页；继续后只提取标题和餐厅结构化数据", "网页内容只作为线索，仍需通过 Google Maps 和用户确认核对餐厅身份"]
        : []
  };
}

export class TextInputError extends Error {
  constructor(code, message, status) { super(message); this.name = "TextInputError"; this.code = code; this.status = status; }
}

function extractPlan(text) {
  const date = text.match(new RegExp(DATE_PATTERN_SOURCE, "u"));
  const time = text.match(/(?:上午|下午|晚上|晚餐|中午)?\s*([01]?\d|2[0-3])[:：时点]([0-5]\d)?/);
  const party = text.match(/(\d{1,2})\s*(?:个)?(?:人|位|名)/);
  const year = date?.groups?.yearA || new Date().getFullYear();
  const month = date?.groups?.monthA || date?.groups?.monthB || date?.groups?.monthC;
  const day = date?.groups?.dayA || date?.groups?.dayB || date?.groups?.dayC;
  return {
    planDate: date ? `${year}-${pad(month)}-${pad(day)}` : "",
    planTime: time ? `${pad(time[1])}:${pad(time[2] || "00")}` : "",
    partySize: party ? Math.min(20, Math.max(1, Number(party[1]))) : null
  };
}

function extractRestaurantClues(text, plan) {
  let cleaned = text
    .replace(new RegExp(DATE_PATTERN_SOURCE, "gu"), " ")
    .replace(/(?:上午|下午|晚上|晚餐|中午)?\s*(?:[01]?\d|2[0-3])[:：时点](?:[0-5]\d)?(?:分)?/g, " ")
    .replace(/\d{1,2}\s*(?:个)?(?:人|位|名)/g, " ")
    .replace(/(?:想去|想吃|预订|预约|订位|帮我查|帮我找|查一下|请问|计划|餐厅|饭店)/g, " ")
    .replace(/(?:来自|来源(?:是)?|平台(?:是)?|from)\s*x\b(?:\s*(?:截图|帖子|reels?))?/gi, " ")
    .replace(/(?:来自|来源(?:是)?|平台(?:是)?|from)?\s*(?:instagram|insta|ins|ig|tiktok|抖音|小红书|xiaohongshu|twitter)(?:\s*(?:截图|帖子|reels?))?/gi, " ")
    .replace(/[，,。；;！!？?]/g, " ")
    .replace(/\s+/g, " ").trim();
  const stationToken = cleaned.split(/\s+/).find((token) => /駅(?:附近|周辺|近く)?$/u.test(token));
  const nearestStation = stationToken?.match(/^(.{1,40}?駅)/u)?.[1] || "";
  if (stationToken) cleaned = cleaned.replace(stationToken, " ").replace(/\s+/g, " ").trim();
  const alias = expandRestaurantAlias(cleaned);
  cleaned = alias.queryText;
  const areaToken = cleaned.split(/\s+/).find((token) => AREA_NAMES.has(token)) || "";
  const branchMatch = cleaned.match(/([\p{L}\p{N}]{1,20}(?:店|本店))/u);
  const address = cleaned.split(/\s+/).find((token) => /\d/.test(token) && (/[都道府県市区町村]/u.test(token) || /\d[-‐‑‒–—―−]\d/u.test(token))) || "";
  const branchCandidate = branchMatch?.[1] || "";
  const branch = branchCandidate && branchCandidate !== cleaned ? branchCandidate : "";
  let nameText = cleaned;
  for (const removable of [address, areaToken, branch]) {
    if (removable) nameText = nameText.replace(removable, " ");
  }
  nameText = nameText.replace(/\s+/g, " ").trim();
  const name = (alias.canonicalName || nameText).slice(0, 200);
  return {
    name,
    branch: branch && branch !== name ? branch : "",
    area: areaToken,
    category: "",
    address,
    nearest_station: nearestStation,
    originalName: alias.canonicalName ? alias.matchedAlias : "",
    aliasExpanded: alias.expanded && Boolean(alias.canonicalName)
  };
}

function detectMentionedSocialPlatform(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\b(?:instagram|insta)\b|(?:来自|来源(?:是)?|平台(?:是)?)\s*(?:ins|ig)\b/i.test(normalized)) return { platform: "instagram", label: "Instagram" };
  if (/\btiktok\b|抖音/i.test(normalized)) return { platform: "tiktok", label: "TikTok" };
  if (/小红书|xiaohongshu/i.test(normalized)) return { platform: "xiaohongshu", label: "小红书" };
  if (/\btwitter\b|(?:来自|来源(?:是)?|平台(?:是)?|from)\s*x\b/i.test(normalized)) return { platform: "x", label: "X" };
  return null;
}

function classifySocialUrl(item) {
  const hostname = item.url.hostname.toLowerCase().replace(/^www\./, "");
  const match = SOCIAL_HOSTS.find((entry) => entry.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)));
  return match ? { platform: match.platform, url: item.url.href } : null;
}

function classifyReservationPlatformUrl(item) {
  const match = platformForUrl(item.url.href);
  if (!match) return null;
  return {
    platform: match.provider,
    label: match.label,
    url: item.url.href,
    linkType: reservationLinkPriority(match.provider, item.url.href) > 50 ? "booking_flow" : "listing"
  };
}

function safeUrl(original) {
  try { const url = new URL(original); return ["http:", "https:"].includes(url.protocol) ? { original, url } : null; } catch { return null; }
}
function pad(value) { return String(value).padStart(2, "0"); }
