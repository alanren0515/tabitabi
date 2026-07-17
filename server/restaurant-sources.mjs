import { buildReservationOptions, primaryReservationAction } from "./reservation-options.mjs";
import { buildEvidenceGatedDecision } from "./decision-engine.mjs";

const GOOGLE_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_DETAILS_BASE = "https://places.googleapis.com/v1/places";
const HOTPEPPER_URL = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
const SOURCE_TIMEOUT_MS = 12_000;

export class DataSourceError extends Error {
  constructor(source, status, message) {
    super(message);
    this.name = "DataSourceError";
    this.source = source;
    this.status = status;
  }
}

export async function searchGooglePlaces({ query, clues = {}, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new DataSourceError("google_places", 503, "GOOGLE_MAPS_API_KEY is not configured");
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) throw new DataSourceError("google_places", 400, "A restaurant query is required");

  const retrievedAt = new Date().toISOString();
  const response = await fetchSource(fetchImpl, GOOGLE_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.primaryTypeDisplayName",
        "places.businessStatus",
        "places.googleMapsUri",
        "places.location",
        "places.attributions"
      ].join(",")
    },
    body: JSON.stringify({
      textQuery: cleanQuery,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 3
    })
  }, "google_places");

  const payload = await readSourceResponse(response, "google_places");
  const candidates = (payload.places || [])
    .slice(0, 3)
    .map((place, index) => normalizePlaceCandidate(place, index, clues))
    .filter((candidate) => !isClearlyNonRestaurantCategory(candidate.category))
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((candidate, index, ranked) => ({ ...candidate, rank: index + 1, candidateCount: ranked.length }));
  return { candidates, retrievedAt, attribution: "Google Maps" };
}

function isClearlyNonRestaurantCategory(value) {
  return /(?:^|\s)(?:駅|鉄道駅|地下鉄駅|バス停|空港|駐車場|学校|病院|公園|神社|寺|station|transit station)(?:$|\s)/iu.test(String(value || "").trim());
}

export async function getGooglePlaceDetails({ placeId, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new DataSourceError("google_places", 503, "GOOGLE_MAPS_API_KEY is not configured");
  if (!placeId) throw new DataSourceError("google_places", 400, "placeId is required");

  const response = await fetchSource(fetchImpl, `${GOOGLE_DETAILS_BASE}/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "id",
        "displayName",
        "formattedAddress",
        "businessStatus",
        "googleMapsUri",
        "websiteUri",
        "nationalPhoneNumber",
        "regularOpeningHours",
        "primaryTypeDisplayName",
        "rating",
        "userRatingCount",
        "attributions"
      ].join(",")
    }
  }, "google_places");

  const payload = await readSourceResponse(response, "google_places");
  return normalizePlaceDetails(payload, new Date().toISOString());
}

export async function searchHotPepper({ name, address = "", phone = "", apiKey, fetchImpl = fetch, beforeRequest = async () => {} }) {
  if (!apiKey) return { match: null, retrievedAt: null, available: false };
  const keyword = [name, compactJapaneseAddress(address)].filter(Boolean).join(" ").trim();
  const nameKeyword = String(name || "").trim();
  if (!keyword && !phone) return { match: null, retrievedAt: null, available: true };
  const phoneDigits = phone.replace(/\D/g, "");
  let shops = phoneDigits ? await fetchHotPepperShops({ apiKey, tel: phoneDigits, fetchImpl, beforeRequest }) : [];
  let best = bestHotPepperMatch(shops, { name, address });
  if ((!best || best.score < 6) && keyword) {
    shops = await fetchHotPepperShops({ apiKey, keyword, fetchImpl, beforeRequest });
    best = bestHotPepperMatch(shops, { name, address });
  }
  if ((!best || best.score < 6) && nameKeyword && nameKeyword !== keyword) {
    shops = await fetchHotPepperShops({ apiKey, keyword: nameKeyword, fetchImpl, beforeRequest });
    best = bestHotPepperMatch(shops, { name, address });
  }
  return {
    match: best && best.score >= 6 ? normalizeHotPepperShop(best.shop, best.score) : null,
    retrievedAt: new Date().toISOString(),
    available: true
  };
}

async function fetchHotPepperShops({ apiKey, tel = "", keyword = "", fetchImpl, beforeRequest }) {
  const url = new URL(HOTPEPPER_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("count", "3");
  if (tel) url.searchParams.set("tel", tel);
  else url.searchParams.set("keyword", keyword);
  await beforeRequest();
  const response = await fetchSource(fetchImpl, url, { headers: { Accept: "application/json" } }, "hotpepper");
  const payload = await readSourceResponse(response, "hotpepper");
  return Array.isArray(payload?.results?.shop) ? payload.results.shop : [];
}

function bestHotPepperMatch(shops, clues) {
  return shops
    .map((shop) => ({ shop, score: scoreHotPepperShop(shop, clues) }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

export function buildRestaurantResult({ place, hotPepperResult, discoveredReservationLinks = [], officialWebsiteDiscovery = null, verifiedOfficialSource = null, userClues = {}, planIntent = {} }) {
  const hp = hotPepperResult?.match || null;
  const retrievedAt = place.retrievedAt;
  const officialContact = officialWebsiteDiscovery?.sourceVerified ? officialWebsiteDiscovery.officialContact : null;
  const officialOperationalStatus = officialWebsiteDiscovery?.sourceVerified ? officialWebsiteDiscovery.operationalStatus : null;
  const officialDiningNotices = officialWebsiteDiscovery?.sourceVerified && Array.isArray(officialWebsiteDiscovery.diningNotices) ? officialWebsiteDiscovery.diningNotices : [];
  const officialQueuePolicy = officialWebsiteDiscovery?.sourceVerified ? officialWebsiteDiscovery.queuePolicy || null : null;
  const officialSocialLinks = officialWebsiteDiscovery?.sourceVerified && Array.isArray(officialWebsiteDiscovery.socialLinks) ? officialWebsiteDiscovery.socialLinks : [];
  const effectivePlace = officialOperationalStatus?.businessStatus && place.businessStatus !== "CLOSED_PERMANENTLY"
    ? { ...place, businessStatus: officialOperationalStatus.businessStatus, businessStatusSource: "official_website" }
    : place;
  const sourceConflicts = [
    ...detectUserClueConflicts(place, userClues, verifiedOfficialSource),
    ...detectSourceConflicts(place, hp),
    ...detectOfficialContactConflicts(place, officialContact),
    ...(officialOperationalStatus && place.businessStatus === "OPERATIONAL" ? [{ field: "business_status", severity: "high", googleValue: place.businessStatus, officialValue: officialOperationalStatus.businessStatus, message: "Google Maps では営業中ですが、確認済みの公式サイトには一時休業と明記されています。公式サイトの情報を優先します。" }] : [])
  ];
  const confirmedPhone = officialContact?.phone || place.phone;
  const facts = [];
  addFact(facts, "name", place.name, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "address", place.address, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "address", userClues.address, "user_clue", "", retrievedAt, "low");
  addFact(facts, "business_status", place.businessStatus, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "phone", place.phone, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "opening_hours", place.hours.join(" / "), "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "rating", place.rating, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "user_rating_count", place.userRatingCount, "google_places", place.googleMapsUri, retrievedAt, "medium");
  addFact(facts, "website", place.websiteUri, "google_places", place.googleMapsUri, retrievedAt, "medium");

  if (hp) {
    addFact(facts, "station", hp.station, "hotpepper", hp.url, hotPepperResult.retrievedAt, "medium");
    addFact(facts, "opening_hours", hp.open, "hotpepper", hp.url, hotPepperResult.retrievedAt, "medium");
    addFact(facts, "closed", hp.close, "hotpepper", hp.url, hotPepperResult.retrievedAt, "medium");
    addFact(facts, "budget", hp.budget, "hotpepper", hp.url, hotPepperResult.retrievedAt, "medium");
  }
  const reservationPolicy = officialWebsiteDiscovery?.sourceVerified ? officialWebsiteDiscovery.reservationPolicy || null : null;
  if (reservationPolicy) {
    addFact(facts, "reservation_policy", reservationPolicy.status, "official_website", reservationPolicy.sourceUrl || place.websiteUri, retrievedAt, reservationPolicy.certainty || "high");
  }
  if (officialContact?.phone) {
    addFact(facts, "phone", officialContact.phone, "official_website", officialContact.sourceUrl || verifiedOfficialSource?.url, retrievedAt, "high");
  }
  if (officialOperationalStatus) {
    addFact(facts, "business_status", officialOperationalStatus.businessStatus, "official_website", officialOperationalStatus.sourceUrl || verifiedOfficialSource?.url, retrievedAt, "high");
  }
  for (const notice of officialDiningNotices) addFact(facts, `dining_notice:${notice.type}`, notice.excerpt || notice.label, "official_website", notice.sourceUrl || verifiedOfficialSource?.url, retrievedAt, notice.certainty || "high");
  if (officialQueuePolicy) addFact(facts, "queue_policy", officialQueuePolicy.mode, "official_website", officialQueuePolicy.sourceUrl || verifiedOfficialSource?.url, retrievedAt, officialQueuePolicy.certainty || "high");
  for (const social of officialSocialLinks) addFact(facts, `official_social:${social.provider}`, social.handle || social.url, "official_website", social.url, retrievedAt, "high");

  const closed = ["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(effectivePlace.businessStatus);
  const sources = [
    {
      name: "Google Maps",
      note: "店名、住所、営業状況、電話、営業時間",
      official: false,
      confidence: "medium",
      url: place.googleMapsUri,
      retrievedAt,
      attribution: "Google Maps"
    }
  ];
  for (const attribution of place.attributions || []) {
    if (!attribution?.provider) continue;
    sources.push({
      name: attribution.provider,
      note: "Google Maps に表示された情報提供元",
      official: false,
      confidence: "medium",
      url: attribution.providerUri || place.googleMapsUri,
      retrievedAt
    });
  }
  if (hp) {
    sources.push({
      name: "ホットペッパーグルメ",
      note: "店舗ページ、最寄り駅、予算、営業時間、定休日",
      official: false,
      confidence: "medium",
      url: hp.url,
      retrievedAt: hotPepperResult.retrievedAt
    });
  }
  if (reservationPolicy) {
    sources.push({
      name: "店舗公式サイト",
      note: `予約ルール：${reservationPolicy.excerpt}`,
      official: true,
      confidence: "high",
      url: reservationPolicy.sourceUrl || place.websiteUri,
      retrievedAt
    });
  }
  if (officialContact?.phone && !reservationPolicy) {
    sources.push({
      name: "店舗公式サイト",
      note: `公式電話番号：${officialContact.phone}`,
      official: true,
      confidence: "high",
      url: officialContact.sourceUrl || verifiedOfficialSource?.url,
      retrievedAt
    });
  }
  if (officialOperationalStatus) {
    sources.push({
      name: "店舗公式サイト",
      note: `営業状況：${officialOperationalStatus.excerpt}`,
      official: true,
      confidence: "high",
      url: officialOperationalStatus.sourceUrl || verifiedOfficialSource?.url,
      retrievedAt
    });
  }
  if (officialDiningNotices.length) {
    sources.push({
      name: "店舗公式サイト",
      note: `来店時の注意：${officialDiningNotices.map((item) => item.label).join("、")}`,
      official: true,
      confidence: "high",
      url: officialDiningNotices[0].sourceUrl || verifiedOfficialSource?.url,
      retrievedAt
    });
  }
  if (officialQueuePolicy) {
    sources.push({
      name: "店舗公式サイト",
      note: `順番待ちルール：${officialQueuePolicy.excerpt}`,
      official: true,
      confidence: "high",
      url: officialQueuePolicy.sourceUrl || verifiedOfficialSource?.url,
      retrievedAt
    });
  }
  for (const social of officialSocialLinks) {
    sources.push({
      name: `公式 ${social.label}`,
      note: `確認済みの店舗公式サイトから直接リンク${social.handle ? ` · ${social.handle}` : ""}。SNS投稿の本文は読み取っていません`,
      official: true,
      confidence: "high",
      url: social.url,
      retrievedAt
    });
  }

  const officialDiscoveredLinks = officialWebsiteDiscovery
    ? (officialWebsiteDiscovery.links || []).map((link) => ({ ...link, sourceVerified: Boolean(officialWebsiteDiscovery.sourceVerified) }))
    : [];
  const discoveredLinks = [...officialDiscoveredLinks, ...(Array.isArray(discoveredReservationLinks) ? discoveredReservationLinks : [])];
  const reservationOptions = buildReservationOptions({ place: { ...place, phone: confirmedPhone }, hotPepperMatch: hp, discoveredLinks, officialWebsiteUri: verifiedOfficialSource?.url || "", userClues });
  const decision = buildEvidenceGatedDecision({ place: effectivePlace, reservationOptions, reservationPolicy, queuePolicy: officialQueuePolicy, conflicts: sourceConflicts, facts, planIntent });
  const unresolvedIdentityConflict = sourceConflicts.some((item) => item.severity === "high" && !item.resolvedByOfficial && ["address", "name", "branch"].includes(item.field));
  const primaryAction = closed
    ? { label: officialOperationalStatus ? "公式サイトで営業状況を確認" : "Google Maps で営業状況を確認", url: officialOperationalStatus?.sourceUrl || place.googleMapsUri, type: officialOperationalStatus ? "official_website" : "map" }
    : unresolvedIdentityConflict
      ? { label: "まず Google Maps で店舗を確認", url: place.googleMapsUri, type: "map" }
    : primaryReservationAction(reservationOptions)
      || { label: "Google Maps で確認", url: place.googleMapsUri, type: "map" };

  const reasons = hotPepperResult?.error && !closed
    ? [...decision.reasons, "ホットペッパーグルメとの照合を一時的に利用できません"]
    : decision.reasons;

  const conflictMessages = [
    ...(closed ? [officialOperationalStatus
      ? "確認済み公式サイトの一時休業情報を優先します。第三者サービスにページが残っていても、現在営業中とは限りません。"
      : "Google Maps の営業状況を優先して確認してください。第三者サービスにページが残っていても、現在営業中とは限りません。"] : []),
    ...sourceConflicts.map((item) => item.message)
  ];

  return {
    id: `google:${place.placeId}`,
    placeId: place.placeId,
    sourceMode: "live",
    name: place.name,
    reading: userClues.reading || "",
    area: shortArea(place.address),
    category: place.category || userClues.category || "飲食店",
    price: hp?.budget || "",
    address: place.address,
    station: hp?.station || hp?.access || "地図で要確認",
    hours: place.hours.length ? place.hours.join(" / ") : hp?.open || "要確認",
    closed: hp?.close || "要確認",
    phone: confirmedPhone || "",
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    recommendation: decision.recommendation,
    queue: decision.queue,
    summary: decision.summary,
    nextAction: decision.nextAction,
    planAdvisory: decision.planAdvisory || null,
    reservationGuidance: reservationPolicy?.status === "limited" ? reservationPolicy : null,
    attentionNotices: officialDiningNotices,
    queueGuidance: officialQueuePolicy,
    booking: null,
    primaryAction,
    reservationOptions,
    mapSearchUrl: place.googleMapsUri,
    websiteUrl: place.websiteUri,
    officialSocialLinks,
    officialInstagramUrl: officialSocialLinks.find((item) => item.provider === "instagram")?.url || "",
    dataLabel: "最新情報",
    sourceContext: `${formatRetrievedAt(retrievedAt)} に確認`,
    confidence: decision.confidence,
    reasons,
    decisionEvidence: decision.evidence,
    conflict: conflictMessages.length ? conflictMessages.join(" ") : null,
    conflictTitle: closed ? "営業状況に注意" : sourceConflicts.length ? "情報源が一致しません" : null,
    sources,
    evidenceFacts: facts,
    risks: sourceConflicts,
    userLabel: userClues.originalName || userClues.name || place.name
  };
}

export function detectSourceConflicts(place, hotPepper) {
  if (!hotPepper) return [];
  const conflicts = [];
  const placeAddress = normalizeText(place.address || "");
  const hotPepperAddress = normalizeText(hotPepper.address || "");
  if (placeAddress && hotPepperAddress && !addressOverlap(placeAddress, hotPepperAddress)) {
    conflicts.push({
      field: "address",
      severity: "high",
      googleValue: place.address,
      hotPepperValue: hotPepper.address,
      message: "Google Maps とホットペッパーグルメの住所が一致しません。同名の別支店を照合した可能性があります。"
    });
  }

  const closedWeekdays = extractClosedWeekdays(hotPepper.close || "");
  for (const weekday of closedWeekdays) {
    const googleLine = (place.hours || []).find((line) => String(line).startsWith(`${weekday}曜日`));
    if (googleLine && !/(定休日|休業|休み|closed)/i.test(googleLine)) {
      conflicts.push({
        field: "opening_hours",
        severity: "medium",
        googleValue: googleLine,
        hotPepperValue: hotPepper.close,
        message: `${weekday}曜日の営業情報が Google Maps とホットペッパーグルメで一致しません。`
      });
    }
  }
  return conflicts;
}

export function detectOfficialContactConflicts(place, officialContact) {
  const googlePhone = String(place?.phone || "").replace(/\D/g, "");
  const officialPhone = String(officialContact?.phone || "").replace(/\D/g, "");
  if (!googlePhone || !officialPhone || googlePhone === officialPhone) return [];
  return [{
    field: "phone",
    severity: "medium",
    googleValue: place.phone,
    officialValue: officialContact.phone,
    message: `Google Maps の電話番号（${place.phone}）と確認済み公式サイト（${officialContact.phone}）が異なります。公式サイトの番号を優先表示します。`
  }];
}

export function detectUserClueConflicts(place, userClues = {}, verifiedOfficialSource = null) {
  const conflicts = [];
  const clueAddress = String(userClues.address || "").trim();
  const currentAddress = String(place?.address || "").trim();
  if (isSpecificStreetAddress(clueAddress) && isSpecificStreetAddress(currentAddress)
    && addressesShareLocality(clueAddress, currentAddress) && !streetNumbersCompatible(clueAddress, currentAddress)) {
    const resolvedByOfficial = Boolean(verifiedOfficialSource?.url);
    conflicts.push({
      field: "address",
      severity: "high",
      userValue: clueAddress,
      googleValue: currentAddress,
      resolvedByOfficial,
      resolution: resolvedByOfficial ? "verified_current_official" : "unresolved",
      message: resolvedByOfficial
        ? `入力または画像の住所（${clueAddress}）と現在の住所（${currentAddress}）が異なります。店舗公式ページで現住所を確認済みのため、元の投稿は移転前の可能性があります。`
        : `入力または画像の住所（${clueAddress}）と現在の Google Maps 住所（${currentAddress}）が異なります。古い投稿、移転前の住所、同名支店の可能性があります。`
    });
  }

  const clueArea = String(userClues.area || "").trim();
  if (normalizeText(clueArea).length >= 2 && currentAddress && !normalizeText(currentAddress).includes(normalizeText(clueArea))) {
    conflicts.push({
      field: "area",
      severity: "medium",
      userValue: clueArea,
      googleValue: currentAddress,
      resolvedByOfficial: false,
      resolution: "needs_map_check",
      message: `補足されたエリア（${clueArea}）が現在の Google Maps 住所（${currentAddress}）に含まれません。近隣エリアの広い呼び方または位置のずれの可能性があるため、地図の住所と最寄り駅で確認してください。`
    });
  }
  return conflicts;
}

export function normalizePlaceCandidate(place, index = 0, clues = {}) {
  const name = place?.displayName?.text || "店舗名不明";
  const address = place?.formattedAddress || "住所情報が不足";
  const reasons = [];
  let score = Math.max(1, 10 - index * 2);
  const clueName = normalizeText([clues.name, clues.branch].filter(Boolean).join(" "));
  const clueAddress = normalizeText(clues.address || clues.area || "");
  const clueStation = normalizeText(clues.nearest_station || "").replace(/駅$/, "");
  const normalizedName = normalizeText(name);
  const normalizedAddress = normalizeText(address);
  if (clueName && (normalizedName.includes(clueName) || clueName.includes(normalizedName))) {
    reasons.push("店名がほぼ完全に一致");
    score += 8;
  } else if (clues.name && normalizedName.includes(normalizeText(clues.name))) {
    reasons.push("店名が一致");
    score += 5;
  }
  if (clues.branch && normalizedName.includes(normalizeText(clues.branch))) {
    reasons.push("支店名が一致");
    score += 4;
  }
  if (clueStation.length >= 2 && normalizedName.includes(clueStation)) {
    reasons.push("駅の手掛かりと支店名が一致");
    score += 3;
  }
  if (clueAddress && addressOverlap(clueAddress, normalizedAddress)) {
    reasons.push("住所の手掛かりが一致");
    score += 5;
  }
  if (!reasons.length) reasons.push("Google Maps の検索関連度順");

  return {
    id: place.id,
    placeId: place.id,
    name,
    address,
    area: shortArea(address),
    category: place?.primaryTypeDisplayName?.text || "飲食店",
    rating: Number.isFinite(place.rating) ? place.rating : null,
    userRatingCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : null,
    businessStatus: place.businessStatus || "BUSINESS_STATUS_UNSPECIFIED",
    googleMapsUri: place.googleMapsUri || "",
    location: place.location || null,
    attributions: Array.isArray(place.attributions) ? place.attributions : [],
    matchReasons: reasons,
    matchScore: score,
    sourceMode: "live"
  };
}

export function normalizePlaceDetails(place, retrievedAt) {
  return {
    placeId: place.id,
    name: place?.displayName?.text || "店舗名不明",
    address: place.formattedAddress || "",
    businessStatus: place.businessStatus || "BUSINESS_STATUS_UNSPECIFIED",
    googleMapsUri: place.googleMapsUri || "",
    websiteUri: place.websiteUri || "",
    phone: place.nationalPhoneNumber || "",
    hours: place?.regularOpeningHours?.weekdayDescriptions || [],
    category: place?.primaryTypeDisplayName?.text || "飲食店",
    rating: Number.isFinite(place.rating) ? place.rating : null,
    userRatingCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : null,
    attributions: Array.isArray(place.attributions) ? place.attributions : [],
    retrievedAt
  };
}

async function readSourceResponse(response, source) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.results?.error?.[0]?.message || `${source} request failed`;
    throw new DataSourceError(source, response.status, message);
  }
  return payload;
}

async function fetchSource(fetchImpl, url, options, source) {
  try {
    return await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  } catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "request timed out" : "network request failed";
    throw new DataSourceError(source, 502, `${source} ${reason}`);
  }
}

function normalizeHotPepperShop(shop, score) {
  return {
    id: shop.id,
    name: shop.name || "",
    address: shop.address || "",
    station: shop.station_name || "",
    access: shop.access || "",
    url: shop?.urls?.pc || "",
    open: shop.open || "",
    close: shop.close || "",
    budget: shop?.budget?.name || shop?.budget?.average || "",
    score
  };
}

function scoreHotPepperShop(shop, clues) {
  let score = 0;
  const shopName = normalizeText(shop?.name || "");
  const shopAddress = normalizeText(shop?.address || "");
  const clueName = normalizeText(clues.name || "");
  const clueAddress = normalizeText(clues.address || "");
  if (clueName && namesMeaningfullyOverlap(clues.name, shop?.name)) score += 6;
  if (clueAddress && shopAddress) score += addressOverlap(clueAddress, shopAddress) ? 4 : -6;
  return score;
}

function namesMeaningfullyOverlap(clueName, shopName) {
  const clue = normalizeText(clueName);
  const shop = normalizeText(shopName);
  if (!clue || !shop) return false;
  if (shop.includes(clue) || clue.includes(shop)) return true;
  const fragments = String(clueName || "").normalize("NFKC").toLowerCase().match(/[一-龯ぁ-んァ-ヶa-z0-9]{2,}/g) || [];
  const matchedCharacters = fragments
    .filter((fragment) => shop.includes(normalizeText(fragment)))
    .reduce((sum, fragment) => sum + normalizeText(fragment).length, 0);
  return matchedCharacters >= 5;
}

function addFact(target, field, value, sourceType, sourceUrl, retrievedAt, confidence) {
  if (value === null || value === undefined || value === "") return;
  target.push({ id: `${sourceType}:${field}:${target.filter((fact) => fact.field === field).length + 1}`, field, value, sourceType, sourceUrl, retrievedAt, confidence, isOfficial: sourceType === "official_website" });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/([0-9]+)丁目/g, "$1")
    .replace(/([0-9]+)番地?/g, "$1")
    .replace(/([0-9]+)号/g, "$1")
    .replace(/[\s〒ー‐‑‒–—―−,，.。・/\-]/g, "");
}

function addressOverlap(a, b) {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tokens = a.match(/[一-龯ぁ-んァ-ヶa-z0-9]{2,}/g) || [];
  return tokens.some((token) => token.length >= 3 && b.includes(token));
}

function isSpecificStreetAddress(value) {
  return addressNumbers(value).length >= 2;
}

function streetNumbersCompatible(a, b) {
  const left = addressNumbers(a);
  const right = addressNumbers(b);
  const compared = Math.min(left.length, right.length);
  return compared >= 2 && left.slice(0, compared).every((value, index) => value === right[index]);
}

function addressNumbers(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/〒\s*\d{3}-?\d{4}/g, "")
    .match(/\d+/g) || [];
}

function addressesShareLocality(a, b) {
  const localityTokens = (value) => String(value || "")
    .normalize("NFKC")
    .replace(/〒\s*\d{3}-?\d{4}/g, "")
    .match(/[一-龯ぁ-んァ-ヶ]{2,}/g) || [];
  const left = localityTokens(a);
  const right = localityTokens(b);
  return left.some((token) => token.length >= 2 && right.some((other) => token.includes(other) || other.includes(token)));
}

function compactJapaneseAddress(address) {
  return String(address || "")
    .replace(/^日本、?/, "")
    .replace(/〒\s*\d{3}-?\d{4}\s*/, "")
    .trim();
}

function extractClosedWeekdays(value) {
  const weekdays = ["月", "火", "水", "木", "金", "土", "日"];
  return weekdays.filter((weekday) => new RegExp(`${weekday}(?:曜|曜日)`).test(String(value || "")));
}

function shortArea(address) {
  const match = String(address || "").match(/(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)([^市区町村]{1,8}[市区町村])/);
  return match ? match[0] : String(address || "").split(/[,，]/)[0] || "日本";
}

function formatRetrievedAt(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value));
  } catch {
    return value;
  }
}
