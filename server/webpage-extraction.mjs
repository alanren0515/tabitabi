import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { validatePublicWebsiteUrl } from "./reservation-link-discovery.mjs";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const RESTAURANT_TYPES = new Set(["restaurant", "foodestablishment", "cafeorcoffeeshop", "barorpub", "bakery", "icecreamshop"]);

export async function extractPublicWebpageClues({ url, fetchImpl = fetch, lookupImpl = lookup, timeoutMs = 8_000 }) {
  let currentUrl = validatePublicWebsiteUrl(url);
  if (!currentUrl) throw new WebpageExtractionError("INVALID_URL", "A public http(s) URL is required", 400);

  let response;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHostname(currentUrl, lookupImpl);
    response = await fetchImpl(currentUrl, {
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "TabiTabi-WebpageClues/0.1" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === MAX_REDIRECTS) throw new WebpageExtractionError("TOO_MANY_REDIRECTS", "The webpage redirected too many times", 400);
    const location = response.headers.get("location");
    const nextUrl = location ? validatePublicWebsiteUrl(new URL(location, currentUrl).href) : "";
    if (!nextUrl) throw new WebpageExtractionError("UNSAFE_REDIRECT", "The webpage redirected to an unsafe URL", 400);
    currentUrl = nextUrl;
  }

  if (!response?.ok) throw new WebpageExtractionError("UPSTREAM_ERROR", `The webpage returned HTTP ${response?.status || 0}`, 502);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new WebpageExtractionError("NOT_HTML", "The URL did not return an HTML page", 400);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) throw new WebpageExtractionError("TOO_LARGE", "The webpage is too large to inspect", 413);
  const html = (await response.text()).slice(0, MAX_HTML_BYTES + 1);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new WebpageExtractionError("TOO_LARGE", "The webpage is too large to inspect", 413);

  const structured = findRestaurantJsonLd(html);
  const pageTitle = metaContent(html, "property", "og:title") || tagText(html, "title");
  const heading = tagText(html, "h1");
  const name = cleanName(structured?.name || heading || pageTitle);
  const address = structuredAddress(structured?.address);
  const category = cleanText(structured?.servesCuisine || structured?.['@type'] || "").slice(0, 120);
  const confidence = structured?.name && address ? "high" : structured?.name ? "medium" : "low";
  return {
    sourceUrl: currentUrl,
    contentRead: true,
    extractionScope: "public_html_metadata_and_restaurant_jsonld",
    pageTitle: cleanText(pageTitle).slice(0, 240),
    clues: { name: name.slice(0, 200), branch: "", area: addressArea(address), category, address: address.slice(0, 260) },
    confidence,
    requiresUserConfirmation: true,
    warnings: [
      "网页内容只作为用户提交的线索，不视为餐厅官方事实",
      confidence === "low" ? "未找到餐厅结构化数据，店名可能只是文章标题，请人工修改后再搜索" : "请核对店名、分店和地址后再搜索 Google Maps"
    ]
  };
}

export class WebpageExtractionError extends Error {
  constructor(code, message, status) { super(message); this.name = "WebpageExtractionError"; this.code = code; this.status = status; }
}

async function assertPublicHostname(value, lookupImpl) {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [{ address: hostname, family: literalVersion }] : await lookupImpl(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new WebpageExtractionError("UNSAFE_HOST", "The webpage hostname resolves to a private or reserved address", 400);
}

function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && [18, 19].includes(b)) || a >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  }
  return true;
}

function findRestaurantJsonLd(html) {
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([^]*?)<\/script\s*>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      const nodes = flattenJsonLd(parsed);
      const restaurant = nodes.find((node) => typesFor(node).some((type) => RESTAURANT_TYPES.has(type.toLowerCase())));
      if (restaurant) return restaurant;
    } catch { /* Ignore malformed third-party JSON-LD. */ }
  }
  return null;
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  return [value, ...flattenJsonLd(value['@graph'] || [])];
}

function typesFor(node) { return Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']].filter(Boolean); }

function structuredAddress(value) {
  if (typeof value === "string") return cleanText(value);
  if (!value || typeof value !== "object") return "";
  return [value.postalCode, value.addressRegion, value.addressLocality, value.streetAddress].map(cleanText).filter(Boolean).join(" ");
}

function addressArea(value) {
  const match = String(value || "").match(/(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)([^市区町村]{1,8}[市区町村])?/);
  return match?.[0] || "";
}

function metaContent(html, key, value) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attribute = attr(tag, key);
    if (attribute?.toLowerCase() === value.toLowerCase()) return decodeHtml(attr(tag, "content") || "");
  }
  return "";
}

function tagText(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([^]*?)<\\/${tag}\\s*>`, "i").exec(String(html));
  return match ? cleanText(match[1].replace(/<[^>]+>/g, " ")) : "";
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function cleanName(value) {
  return cleanText(value).replace(/\s*[|｜]\s*[^|｜]{2,50}$/u, "").trim();
}

function cleanText(value = "") { return decodeHtml(String(value)).replace(/\s+/g, " ").trim(); }
function decodeHtml(value) {
  return String(value).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
