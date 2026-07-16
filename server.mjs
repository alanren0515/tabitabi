import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { buildRestaurantResult, DataSourceError, getGooglePlaceDetails, searchGooglePlaces, searchHotPepper } from "./server/restaurant-sources.mjs";
import { extractScreenshotWithFallback, getVisionCapabilities, validateImageDataUrl, VisionExtractionError } from "./server/vision-extraction.mjs";
import { createRequestCache } from "./server/request-cache.mjs";
import { createFixedWindowRateLimiter, requestClientKey } from "./server/rate-limiter.mjs";
import { discoverReservationLinks } from "./server/reservation-link-discovery.mjs";
import { findVerifiedOfficialSource } from "./server/verified-official-sources.mjs";
import { parseTextInput, TextInputError } from "./server/text-input.mjs";
import { sanitizeEvent } from "./server/event-sanitizer.mjs";
import { extractPublicWebpageClues, WebpageExtractionError } from "./server/webpage-extraction.mjs";
import { normalizeUserProvidedReservationLinks } from "./server/reservation-options.mjs";
import { browserSecurityHeaders } from "./server/http-headers.mjs";
import { resolveStaticFile } from "./server/static-path.mjs";
import { AuditWorkbenchError, auditAccessInfo, auditLanMode, auditRequestAuthorized, auditSessionCookie, auditWorkbenchEnabled, readAuditBundle, saveAuditEvidence, saveAuditUpdates } from "./server/audit-workbench.mjs";
import { createJsonlStore } from "./server/jsonl-store.mjs";
import { serviceReadiness } from "./server/readiness.mjs";
import { createDailyBudgetStore, dailyBudgetSnapshot, DailyBudgetExceededError } from "./server/daily-budget.mjs";
import { pilotAccessAuthorized, pilotAccessRequired, protectedPilotApiPath } from "./server/pilot-access.mjs";

const ROOT = resolve(process.cwd());
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const placesSearchCache = createRequestCache({ ttlMs: 60_000, maxEntries: 200 });
const placesDetailsCache = createRequestCache({ ttlMs: 60_000, maxEntries: 300 });
const reservationLinkCache = createRequestCache({ ttlMs: 10 * 60_000, maxEntries: 300 });
const screenshotLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
const placesSearchLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const placesDetailsLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const webpageLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });

await loadLocalEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const auditWorkbench = auditWorkbenchEnabled(process.env);
const lanAudit = auditLanMode(process.env);
const visionCapabilities = getVisionCapabilities(process.env);
const readiness = serviceReadiness({ visionCapabilities, env: process.env });
const retentionDays = boundedEnvInteger(process.env.LOG_RETENTION_DAYS, 1, 365, 30);
const eventLog = createJsonlStore({
  path: join(ROOT, "data", "events.jsonl"),
  maxAgeMs: retentionDays * 24 * 60 * 60 * 1_000,
  maxLines: boundedEnvInteger(process.env.EVENT_LOG_MAX_LINES, 100, 500_000, 50_000),
  maxBytes: boundedEnvInteger(process.env.EVENT_LOG_MAX_BYTES, 64 * 1024, 100 * 1024 * 1024, 10 * 1024 * 1024)
});
const sourceMetricLog = createJsonlStore({
  path: join(ROOT, "data", "source-metrics.jsonl"),
  maxAgeMs: retentionDays * 24 * 60 * 60 * 1_000,
  maxLines: boundedEnvInteger(process.env.SOURCE_LOG_MAX_LINES, 100, 500_000, 50_000),
  maxBytes: boundedEnvInteger(process.env.SOURCE_LOG_MAX_BYTES, 64 * 1024, 100 * 1024 * 1024, 10 * 1024 * 1024)
});
const dailyBudget = createDailyBudgetStore({ path: join(ROOT, "data", "daily-budget.json") });
const dailyLimits = {
  visionRequests: boundedEnvInteger(process.env.DAILY_VISION_REQUEST_LIMIT, 1, 10_000, 90),
  placesSearch: boundedEnvInteger(process.env.DAILY_PLACES_SEARCH_LIMIT, 1, 10_000, 90),
  placesDetails: boundedEnvInteger(process.env.DAILY_PLACES_DETAILS_LIMIT, 1, 10_000, 90)
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url || "/", "http://tabitabi.invalid").pathname;
    if (lanAudit && requestPath.startsWith("/api/") && !auditRequestAuthorized(request, process.env)) {
      sendJson(response, 401, { code: "AUDIT_AUTH_REQUIRED", error: "手机审计会话已过期或无效，请在 Mac 终端重新运行 npm run audit:mobile 并打开新地址。" });
      return;
    }
    if (protectedPilotApiPath(request.method, requestPath) && !pilotAccessAuthorized(request, process.env)) {
      sendJson(response, 401, { code: "PILOT_ACCESS_REQUIRED", error: "需要有效的试点访问码。请在设置页保存后重试。" });
      return;
    }
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { status: "ok", visionExtraction: visionCapabilities.visionExtraction, placesSearch: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
      return;
    }
    if (request.method === "GET" && request.url === "/readyz") {
      sendJson(response, readiness.ready ? 200 : 503, readiness);
      return;
    }
    if (request.method === "GET" && request.url === "/api/capabilities") {
      const dailyBudgetStatus = dailyBudgetSnapshot(await dailyBudget.read(), {
        vision_requests: dailyLimits.visionRequests,
        places_search: dailyLimits.placesSearch,
        places_details: dailyLimits.placesDetails
      });
      sendJson(response, 200, {
        ...visionCapabilities,
        placesSearch: Boolean(process.env.GOOGLE_MAPS_API_KEY),
        hotPepper: Boolean(process.env.HOTPEPPER_API_KEY),
        webpageExtraction: true,
        pilotAccessRequired: pilotAccessRequired(process.env),
        dailyBudget: dailyBudgetStatus
      });
      return;
    }
    if (auditWorkbench && request.method === "GET" && requestPath === "/api/audit/bundle") {
      sendJson(response, 200, withAuditAccess(await readAuditBundle(ROOT)));
      return;
    }
    if (auditWorkbench && request.method === "POST" && requestPath === "/api/audit/save") {
      try {
        sendJson(response, 200, withAuditAccess(await saveAuditUpdates(ROOT, await readJsonBody(request))));
      } catch (error) {
        if (error instanceof AuditWorkbenchError) {
          sendJson(response, error.status, { code: "INVALID_AUDIT", error: error.message });
          return;
        }
        throw error;
      }
      return;
    }
    if (auditWorkbench && request.method === "POST" && requestPath === "/api/audit/evidence") {
      try {
        sendJson(response, 201, await saveAuditEvidence(ROOT, await readJsonBody(request)));
      } catch (error) {
        if (error instanceof AuditWorkbenchError) {
          sendJson(response, error.status, { code: "INVALID_EVIDENCE", error: error.message });
          return;
        }
        throw error;
      }
      return;
    }
    if (auditWorkbench && ["GET", "HEAD"].includes(request.method) && requestPath === "/audit") {
      if (!auditRequestAuthorized(request, process.env)) {
        sendJson(response, 401, { code: "AUDIT_AUTH_REQUIRED", error: "手机审计会话已过期或无效，请重新打开 Mac 终端当前显示的地址。" });
        return;
      }
      const cookie = auditSessionCookie(process.env);
      await serveStatic(request, response, "/audit.html", { ...(cookie ? { "Set-Cookie": cookie } : {}), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/extract-screenshot") {
      if (!allowExpensiveRequest(request, response, screenshotLimiter)) return;
      await handleScreenshotExtraction(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/extract-text") {
      await handleTextExtraction(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/extract-webpage") {
      if (!allowExpensiveRequest(request, response, webpageLimiter)) return;
      await handleWebpageExtraction(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/restaurants/search") {
      if (!allowExpensiveRequest(request, response, placesSearchLimiter)) return;
      await handleRestaurantSearch(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/restaurants/candidate-preview") {
      if (!allowExpensiveRequest(request, response, placesDetailsLimiter)) return;
      await handleCandidatePreview(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/restaurants/details") {
      if (!allowExpensiveRequest(request, response, placesDetailsLimiter)) return;
      await handleRestaurantDetails(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/events") {
      await handleEvent(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent && error?.statusCode === 413) sendJson(response, 413, { code: "BODY_TOO_LARGE", error: "Request body is too large" });
    else if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
    else response.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TabiTabi running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (auditWorkbench && !lanAudit) console.log(`Local audit workbench: http://${HOST}:${PORT}/audit`);
  if (auditWorkbench && lanAudit) {
    console.log("Mobile audit URLs (same trusted Wi-Fi only; token expires when this process stops):");
    for (const address of localLanAddresses()) console.log(`  http://${address}:${PORT}/audit?token=${encodeURIComponent(process.env.AUDIT_TOKEN)}`);
  }
  console.log(visionCapabilities.visionExtraction
    ? `Vision extraction enabled with ${visionCapabilities.models.map((item) => `${item.provider}:${item.model}`).join(" -> ")}`
    : "Vision API keys not set; the supplied TikTok sample still works in local demo mode.");
  console.log(process.env.GOOGLE_MAPS_API_KEY ? "Google Places candidate search enabled." : "Google Places key not set; candidate search uses explicit demo fallback.");
  console.log(process.env.HOTPEPPER_API_KEY ? "Hot Pepper enrichment enabled." : "Hot Pepper key not set; enrichment is skipped.");
  if (!readiness.ready) console.log(`Production readiness missing: ${readiness.missing.join(", ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) console.error(`Unable to close cleanly after ${signal}`, error);
      process.exitCode = error ? 1 : 0;
    });
  });
}

async function handleRestaurantSearch(request, response) {
  const body = await readJsonBody(request);
  const startedAt = Date.now();
  try {
    const cacheKey = stableCacheKey([body?.query, body?.clues || {}]);
    const { value: result, cacheStatus } = await placesSearchCache.getOrLoad(cacheKey, async () => {
      const budget = await dailyBudget.consume("places_search", dailyLimits.placesSearch);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return searchGooglePlaces({ query: body?.query, clues: body?.clues || {}, apiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
    await recordSourceMetric({ source: "google_places", operation: "text_search", skuClass: "pro", status: "success", durationMs: Date.now() - startedAt, resultCount: result.candidates.length, cacheStatus });
    sendJson(response, 200, { ...result, mode: "live", cacheStatus });
  } catch (error) {
    await recordSourceMetric({ source: "google_places", operation: "text_search", skuClass: "pro", status: "error", durationMs: Date.now() - startedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Restaurant search failed");
  }
}

async function handleCandidatePreview(request, response) {
  const body = await readJsonBody(request);
  const startedAt = Date.now();
  try {
    const placeId = String(body?.placeId || "").trim();
    const { value: place, cacheStatus } = await placesDetailsCache.getOrLoad(placeId, async () => {
      const budget = await dailyBudget.consume("places_details", dailyLimits.placesDetails);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return getGooglePlaceDetails({ placeId, apiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
    await recordSourceMetric({ source: "google_places", operation: "candidate_preview", skuClass: "enterprise", status: "success", durationMs: Date.now() - startedAt, resultCount: 1, cacheStatus });
    sendJson(response, 200, {
      preview: {
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        googleMapsUri: place.googleMapsUri
      },
      mode: "live",
      cacheStatus
    });
  } catch (error) {
    await recordSourceMetric({ source: "google_places", operation: "candidate_preview", skuClass: "enterprise", status: "error", durationMs: Date.now() - startedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Candidate preview failed");
  }
}

async function handleTextExtraction(request, response) {
  try {
    const body = await readJsonBody(request);
    sendJson(response, 200, parseTextInput(body?.text));
  } catch (error) {
    if (error instanceof TextInputError) {
      sendJson(response, error.status, { code: error.code, error: error.message });
      return;
    }
    throw error;
  }
}

async function handleWebpageExtraction(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await extractPublicWebpageClues({ url: body?.url });
    sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof WebpageExtractionError) {
      sendJson(response, error.status, { code: error.code, error: error.message });
      return;
    }
    console.error("Webpage clue extraction failed", error?.name || "unknown");
    sendJson(response, 502, { code: "WEBPAGE_ERROR", error: "The public webpage could not be inspected" });
  }
}

async function handleRestaurantDetails(request, response) {
  const body = await readJsonBody(request);
  const googleStartedAt = Date.now();
  try {
    const { value: place, cacheStatus } = await placesDetailsCache.getOrLoad(String(body?.placeId || ""), async () => {
      const budget = await dailyBudget.consume("places_details", dailyLimits.placesDetails);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return getGooglePlaceDetails({ placeId: body?.placeId, apiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
    await recordSourceMetric({ source: "google_places", operation: "place_details", skuClass: "enterprise", status: "success", durationMs: Date.now() - googleStartedAt, resultCount: 1, cacheStatus });
    const hotPepperStartedAt = Date.now();
    let hotPepperResult;
    try {
      hotPepperResult = await searchHotPepper({
        name: place.name,
        address: place.address,
        phone: place.phone,
        apiKey: process.env.HOTPEPPER_API_KEY
      });
      if (hotPepperResult.available) {
        await recordSourceMetric({ source: "hotpepper", operation: "shop_search", skuClass: "api", status: "success", durationMs: Date.now() - hotPepperStartedAt, resultCount: hotPepperResult.match ? 1 : 0 });
      }
    } catch (error) {
      console.error("Hot Pepper enrichment skipped", error instanceof DataSourceError ? error.status : "unknown");
      await recordSourceMetric({ source: "hotpepper", operation: "shop_search", skuClass: "api", status: "error", durationMs: Date.now() - hotPepperStartedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
      hotPepperResult = { match: null, retrievedAt: null, available: Boolean(process.env.HOTPEPPER_API_KEY), error: true };
    }
    let officialWebsiteDiscovery = { links: [], socialLinks: [], reservationPolicy: null, operationalStatus: null, diningNotices: [] };
    const verifiedOfficialSource = findVerifiedOfficialSource(place);
    const discoveryWebsiteUri = verifiedOfficialSource?.url || place.websiteUri;
    if (discoveryWebsiteUri) {
      const discoveryStartedAt = Date.now();
      try {
        const { value: discovery, cacheStatus: discoveryCacheStatus } = await reservationLinkCache.getOrLoad(discoveryWebsiteUri, () => discoverReservationLinks({ websiteUri: discoveryWebsiteUri }));
        officialWebsiteDiscovery = {
          links: discovery.links || [],
          socialLinks: discovery.socialLinks || [],
          reservationPolicy: discovery.reservationPolicy || null,
          operationalStatus: discovery.operationalStatus || null,
          officialContact: discovery.officialContact || null,
          diningNotices: discovery.diningNotices || [],
          sourceUrl: discovery.sourceUrl || discoveryWebsiteUri,
          sourceVerified: Boolean(verifiedOfficialSource),
          sourceLabel: verifiedOfficialSource?.label || ""
        };
        await recordSourceMetric({ source: "official_website", operation: "reservation_link_discovery", skuClass: "html", status: "success", durationMs: Date.now() - discoveryStartedAt, resultCount: officialWebsiteDiscovery.links.length + officialWebsiteDiscovery.socialLinks.length + (officialWebsiteDiscovery.reservationPolicy ? 1 : 0) + (officialWebsiteDiscovery.operationalStatus ? 1 : 0) + officialWebsiteDiscovery.diningNotices.length, cacheStatus: discoveryCacheStatus, qualityReason: discovery.status });
      } catch (error) {
        console.error("Official website reservation discovery skipped", error?.name || "unknown");
        await recordSourceMetric({ source: "official_website", operation: "reservation_link_discovery", skuClass: "html", status: "error", durationMs: Date.now() - discoveryStartedAt, errorCode: error?.name || "unknown" });
      }
    }
    const userProvidedReservationLinks = normalizeUserProvidedReservationLinks(body?.userProvidedLinks);
    const restaurant = buildRestaurantResult({ place, hotPepperResult, discoveredReservationLinks: userProvidedReservationLinks, officialWebsiteDiscovery, verifiedOfficialSource, userClues: body?.clues || {}, planIntent: body?.plan || {} });
    sendJson(response, 200, { restaurant, mode: "live", hotPepperAvailable: hotPepperResult.available, cacheStatus });
  } catch (error) {
    await recordSourceMetric({ source: "google_places", operation: "place_details", skuClass: "enterprise", status: "error", durationMs: Date.now() - googleStartedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Restaurant details failed");
  }
}

function sendSourceError(response, error, fallbackMessage) {
  if (error instanceof DailyBudgetExceededError) {
    sendDailyBudgetError(response, error);
    return;
  }
  if (error instanceof DataSourceError) {
    const code = error.source === "google_places" && error.status === 503
      ? "GOOGLE_PLACES_KEY_MISSING"
      : `${error.source.toUpperCase()}_ERROR`;
    const responseStatus = error.status === 503 ? 503 : error.status === 400 ? 400 : 502;
    sendJson(response, responseStatus, { code, error: error.message });
    return;
  }
  console.error(error);
  sendJson(response, 500, { code: "DATA_SOURCE_ERROR", error: fallbackMessage });
}

function sendDailyBudgetError(response, error) {
  response.setHeader("Retry-After", "86400");
  sendJson(response, 429, { code: error.code, error: "今日应用调用预算已用完，请明天再试。", bucket: error.bucket, date: error.date });
}

function allowExpensiveRequest(request, response, limiter) {
  const key = requestClientKey(request, process.env.TRUST_PROXY === "true");
  const result = limiter(key);
  response.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (result.allowed) return true;
  response.setHeader("Retry-After", String(result.retryAfterSeconds));
  sendJson(response, 429, { code: "RATE_LIMITED", error: "Too many requests; please retry shortly" });
  return false;
}

async function handleEvent(request, response) {
  const body = await readJsonBody(request);
  const record = sanitizeEvent(body);
  if (!record) {
    sendJson(response, 400, { code: "INVALID_EVENT", error: "Unsupported event" });
    return;
  }
  await eventLog.append(record);
  sendJson(response, 202, { accepted: true });
}

async function recordSourceMetric(record) {
  try {
    await sourceMetricLog.append({ ...record, occurredAt: new Date().toISOString() });
  } catch (error) {
    console.error("Unable to record source metric", error.code || error.name);
  }
}

function boundedEnvInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function handleScreenshotExtraction(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error.statusCode === 413) {
      sendJson(response, 413, { code: "IMAGE_TOO_LARGE", error: "The screenshot payload is too large" });
      return;
    }
    throw error;
  }
  const imageDataUrl = body?.imageDataUrl;
  let result;
  try {
    validateImageDataUrl(imageDataUrl);
    const budget = await dailyBudget.consume("vision_requests", dailyLimits.visionRequests);
    response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
    result = await extractScreenshotWithFallback({ imageDataUrl, env: process.env });
  } catch (error) {
    if (error instanceof DailyBudgetExceededError) {
      sendDailyBudgetError(response, error);
      return;
    }
    if (error instanceof VisionExtractionError) {
      await recordVisionAttempts(error.attempts || []);
      sendJson(response, error.status, { code: error.code, error: publicVisionError(error.code) });
      return;
    }
    console.error("Unexpected screenshot extraction error", error?.name || "unknown");
    sendJson(response, 500, { code: "VISION_INTERNAL_ERROR", error: "Screenshot extraction failed unexpectedly" });
    return;
  }
  await recordVisionAttempts(result.attempts);
  sendJson(response, 200, {
    extraction: result.extraction,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.usedFallback,
    fallbackReason: result.fallbackReason,
    requiresUserConfirmation: result.requiresUserConfirmation
  });
}

async function recordVisionAttempts(attempts) {
  for (const attempt of attempts || []) {
    await recordSourceMetric({
      source: attempt.provider,
      operation: "screenshot_extraction",
      skuClass: attempt.model,
      status: attempt.status,
      durationMs: attempt.durationMs,
      inputTokens: attempt.usage?.inputTokens ?? null,
      outputTokens: attempt.usage?.outputTokens ?? null,
      totalTokens: attempt.usage?.totalTokens ?? null,
      imageTokens: attempt.usage?.imageTokens ?? null,
      fallbackReason: attempt.fallbackReason || null,
      qualityReason: attempt.qualityReason || null,
      errorCode: attempt.errorCode || null,
      providerRequestId: attempt.requestId || null
    });
  }
}

function publicVisionError(code) {
  return {
    INVALID_IMAGE: "A valid PNG, JPEG, or WebP screenshot is required",
    VISION_NOT_CONFIGURED: "Screenshot extraction is not configured",
    VISION_TIMEOUT: "Screenshot extraction timed out",
    VISION_RATE_LIMITED: "Screenshot extraction is temporarily busy",
    VISION_AUTH_ERROR: "Screenshot extraction configuration needs attention",
    VISION_CONTENT_BLOCKED: "This screenshot could not be processed",
    INVALID_MODEL_OUTPUT: "The screenshot could not be read reliably",
    EMPTY_MODEL_OUTPUT: "The screenshot did not produce a usable result"
  }[code] || "Screenshot extraction is temporarily unavailable";
}

function stableCacheKey([query, clues]) {
  const normalizedClues = Object.fromEntries(Object.entries(clues || {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([String(query || "").normalize("NFKC").trim().toLowerCase(), normalizedClues]);
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

async function serveStatic(request, response, overrideUrl = "", extraHeaders = {}) {
  const resolved = resolveStaticFile(ROOT, overrideUrl || request.url || "/", { allowAuditEntry: overrideUrl === "/audit.html" });
  if (!resolved.ok) {
    sendJson(response, resolved.status, { error: resolved.error });
    return;
  }

  try {
    const content = await readFile(resolved.filePath);
    response.writeHead(200, {
      ...browserSecurityHeaders(),
      "Content-Type": contentType(extname(resolved.filePath)),
      "Cache-Control": "no-cache",
      ...extraHeaders
    });
    if (request.method === "HEAD") response.end();
    else response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") sendJson(response, 404, { error: "Not found" });
    else throw error;
  }
}

function localLanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses.length ? [...new Set(addresses)] : ["<这台 Mac 的局域网 IP>"];
}

function withAuditAccess(bundle) {
  return { ...bundle, access: auditAccessInfo(process.env) };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...browserSecurityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function contentType(extension) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

async function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await readFile(join(ROOT, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
