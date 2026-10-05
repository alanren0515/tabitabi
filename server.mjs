import { getOfferResearchConfig, validateConsumerPriceSignal } from "./server/offer-research.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { buildRestaurantResult, DataSourceError, getGooglePlaceDetails, searchGooglePlaces, searchHotPepper } from "./server/restaurant-sources.mjs";
import { extractScreenshotWithFallback, getVisionCapabilities, validateImageDataUrl, VisionExtractionError } from "./server/vision-extraction.mjs";
import { createRequestCostTracker } from "./server/request-costs.mjs";
import { createRequestCache } from "./server/request-cache.mjs";
import { createFixedWindowRateLimiter, createSlidingWindowRateLimiter, requestClientKey } from "./server/rate-limiter.mjs";
import { discoverReservationLinks } from "./server/reservation-link-discovery.mjs";
import { findVerifiedOfficialSource } from "./server/verified-official-sources.mjs";
import { parseTextInput, TextInputError } from "./server/text-input.mjs";
import { sanitizeEvent } from "./server/event-sanitizer.mjs";
import { CommercialStoreError, createCommercialStore } from "./server/commercial-store.mjs";
import { extractPublicWebpageClues, WebpageExtractionError } from "./server/webpage-extraction.mjs";
import { normalizeUserProvidedReservationLinks } from "./server/reservation-options.mjs";
import { browserSecurityHeaders } from "./server/http-headers.mjs";
import { resolveStaticFile } from "./server/static-path.mjs";
import { AuditWorkbenchError, auditAccessInfo, auditLanMode, auditRequestAuthorized, auditSessionCookie, auditWorkbenchEnabled, readAuditBundle, saveAuditEvidence, saveAuditUpdates } from "./server/audit-workbench.mjs";
import { createJsonlStore } from "./server/jsonl-store.mjs";
import { serviceReadiness } from "./server/readiness.mjs";
import { createDailyBudgetStore, dailyBudgetSnapshot, DailyBudgetExceededError, DailyBudgetUnavailableError } from "./server/daily-budget.mjs";
import { pilotAccessAuthorized, pilotAccessRequired, protectedPilotApiPath } from "./server/pilot-access.mjs";
import { installFatalProcessHandlers } from "./server/process-failures.mjs";
import { probeWritableDataStore } from "./server/data-store-readiness.mjs";
import { createVisionConcurrencyGate, imageContentFingerprint, VisionConcurrencyError } from "./server/vision-abuse-protection.mjs";
import { createProviderCircuitBreaker, ProviderCircuitOpenError } from "./server/provider-circuit-breaker.mjs";
import { publicReleaseMode, releaseAccessConfigured, releaseAccessMode } from "./server/release-mode.mjs";

const ROOT = resolve(process.cwd());
const offerResearchConfig = getOfferResearchConfig();
const priceSignalLog = createJsonlStore({path:join(ROOT,"data","price-signals.jsonl"),maxAgeMs:30*24*60*60*1000,maxLines:10_000,maxBytes:1024*1024});
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const placesSearchCache = createRequestCache({ ttlMs: 60_000, maxEntries: 200 });
const placesDetailsCache = createRequestCache({ ttlMs: 60_000, maxEntries: 300 });
const reservationLinkCache = createRequestCache({ ttlMs: 10 * 60_000, maxEntries: 300 });
const visionResultCache = createRequestCache({ ttlMs: 10 * 60_000, maxEntries: 100 });
const visionConcurrency = createVisionConcurrencyGate({ limit: 2 });
const visionUploadConcurrency = createVisionConcurrencyGate({ limit: 4 });
const screenshotLimiter = createFixedWindowRateLimiter({ limit: 4, windowMs: 60_000 });
const screenshotDailyClientLimiter = createSlidingWindowRateLimiter({ limit: 20, windowMs: 24 * 60 * 60_000 });
const placesSearchLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const placesDetailsLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const webpageLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
const eventLimiter = createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000 });
const pilotAuthFailureLimiter = createFixedWindowRateLimiter({ limit: 20, windowMs: 60_000 });

await loadLocalEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const auditWorkbench = auditWorkbenchEnabled(process.env);
const commercialStore = createCommercialStore({ path: join(ROOT, "data", "commercial-state.json"), releaseRevision: process.env.RELEASE_REVISION, audit: auditWorkbench });
await commercialStore.prune().catch(() => console.error("COMMERCIAL_STORE_UNAVAILABLE"));
const commercialCleanup = setInterval(() => commercialStore.prune().catch(() => console.error("COMMERCIAL_CLEANUP_FAILED")), 5 * 60_000);
commercialCleanup.unref();
const lanAudit = auditLanMode(process.env);
const visionCapabilities = getVisionCapabilities(process.env);
const dataStoreWritable = await probeWritableDataStore(join(ROOT, "data"));
const readiness = serviceReadiness({ visionCapabilities, env: process.env, dataStoreWritable });
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
const requestCostLog = createJsonlStore({ path: join(ROOT, "data", "request-costs.jsonl"),
  maxAgeMs: 30 * 24 * 60 * 60 * 1_000, maxLines: 50_000, maxBytes: 10 * 1024 * 1024 });
const requestCosts = createRequestCostTracker({ append: record => requestCostLog.append(record),
  onWriteError: code => console.error(code) });
const requestCostContexts = new WeakMap();
const dailyBudget = createDailyBudgetStore({ path: join(ROOT, "data", "daily-budget.json") });
const providerCircuit = createProviderCircuitBreaker({ path: join(ROOT, "data", "provider-circuit.json") });
const dailyLimits = {
  visionRequests: boundedEnvInteger(process.env.DAILY_VISION_REQUEST_LIMIT, 1, 60, 60),
  visionQwenAttempts: boundedEnvInteger(process.env.DAILY_QWEN_ATTEMPT_LIMIT, 1, 60, 60),
  visionFallbackAttempts: boundedEnvInteger(process.env.DAILY_OPENAI_FALLBACK_LIMIT, 1, 10, 10),
  placesSearch: boundedEnvInteger(process.env.DAILY_PLACES_SEARCH_LIMIT, 1, 10_000, 90),
  placesDetails: boundedEnvInteger(process.env.DAILY_PLACES_DETAILS_LIMIT, 1, 10_000, 90),
  hotPepperAttempts: boundedEnvInteger(process.env.DAILY_HOTPEPPER_ATTEMPT_LIMIT, 1, 60, 60)
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url || "/", "http://tabitabi.invalid").pathname;
    if (lanAudit && requestPath.startsWith("/api/") && !auditRequestAuthorized(request, process.env)) {
      sendJson(response, 401, { code: "AUDIT_AUTH_REQUIRED", error: "モバイル監査セッションが期限切れまたは無効です。Mac のターミナルで npm run audit:mobile を再実行し、新しいURLを開いてください。" });
      return;
    }
    if (protectedPilotApiPath(request.method, requestPath) && !pilotAccessAuthorized(request, process.env)) {
      if (!allowExpensiveRequest(request, response, pilotAuthFailureLimiter)) return;
      sendJson(response, 401, { code: "PILOT_ACCESS_REQUIRED", error: "招待アクセスコードが正しくありません。ホーム画面で入力し直してください。" });
      return;
    }
    if (paidProviderApiPath(request.method, requestPath) && paidApiEmergencyStopped()) {
      if (requestPath === "/api/extract-screenshot") await observeMeasurement(request, "input", "screenshot", "started");
      if (requestPath === "/api/restaurants/details") await observeMeasurement(request, "details", null, "started");
      sendJson(response, 503, { code: "PAID_API_EMERGENCY_STOP", error: "安全のため外部 API 呼び出しを一時停止しています。" });
      return;
    }
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { status: "ok", visionExtraction: visionCapabilities.visionExtraction, placesSearch: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
      return;
    }
    if (request.method === "GET" && request.url === "/readyz") {
      const circuit = await providerCircuit.snapshot();
      const ready = readiness.ready;
      sendJson(response, ready ? 200 : 503, { ...readiness, ready, status: ready ? "ready" : "not_ready", providerCircuit: circuit, emergencyStop: paidApiEmergencyStopped() });
      return;
    }
    if (request.method === "GET" && request.url === "/api/capabilities") {
      const dailyBudgetStatus = dailyBudgetSnapshot(await dailyBudget.read(), {
        vision_requests: dailyLimits.visionRequests,
        vision_qwen_attempts: dailyLimits.visionQwenAttempts,
        vision_openai_fallback_attempts: dailyLimits.visionFallbackAttempts,
        places_search: dailyLimits.placesSearch,
        places_details: dailyLimits.placesDetails,
        hotpepper_attempts: dailyLimits.hotPepperAttempts
      });
      const providerCircuitStatus = await providerCircuit.snapshot();
      sendJson(response, 200, {
        ...visionCapabilities,
        placesSearch: Boolean(process.env.GOOGLE_MAPS_API_KEY),
        hotPepper: Boolean(process.env.HOTPEPPER_API_KEY),
        webpageExtraction: true,
        pilotAccessRequired: pilotAccessRequired(process.env),
        offerResearch: offerResearchConfig,
        publicReleaseMode: publicReleaseMode(process.env),
        releaseAccessMode: releaseAccessMode(process.env),
        releaseAccessConfigured: releaseAccessConfigured(process.env),
        dailyBudget: dailyBudgetStatus,
        providerCircuit: providerCircuitStatus,
        emergencyStop: paidApiEmergencyStopped(),
        releaseRevision: /^[a-f0-9]{40}$/.test(String(process.env.RELEASE_REVISION || "")) ? process.env.RELEASE_REVISION : null,
        publicInfo: publicOperatorInfo(process.env)
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
        sendJson(response, 401, { code: "AUDIT_AUTH_REQUIRED", error: "モバイル監査セッションが期限切れまたは無効です。Mac のターミナルに表示されている現在のURLを開き直してください。" });
        return;
      }
      const cookie = auditSessionCookie(process.env);
      await serveStatic(request, response, "/audit.html", { ...(cookie ? { "Set-Cookie": cookie } : {}), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/extract-screenshot") {
      if (!allowExpensiveRequest(request, response, screenshotLimiter)) return;
      if (!allowExpensiveRequest(request, response, screenshotDailyClientLimiter)) return;
      try {
        await visionUploadConcurrency.run(() => handleScreenshotExtraction(request, response));
      } catch (error) {
        if (!(error instanceof VisionConcurrencyError)) throw error;
        response.setHeader("Retry-After", "5");
        sendJson(response, 429, { code: "VISION_UPLOAD_BUSY", error: "画像の受信が混み合っています。数秒後にもう一度お試しください。" });
      }
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
    if(request.method === "GET" && request.url === "/api/offers") {
      response.setHeader("Cache-Control","no-store");sendJson(response,200,offerResearchConfig);return;
    }
    if(request.method === "POST" && request.url === "/api/price-signals") {
      if(!allowExpensiveRequest(request,response,eventLimiter)) return;
      const result=validateConsumerPriceSignal(await readJsonBody(request),offerResearchConfig);
      if(!result.valid) {sendJson(response,result.errors.includes("inactive_offer")?410:400,{code:"PRICE_SIGNAL_REJECTED",errors:result.errors});return;}
      await priceSignalLog.append({recordedAt:new Date().toISOString(),...result.signal,sourceContextTrust:"client_reported",evidenceLayer:"anonymous_interest",purchaseConfirmed:false});
      sendJson(response,202,{accepted:true,purchaseConfirmed:false});return;
    }
    if (request.method === "POST" && request.url === "/api/events") {
      if (!allowExpensiveRequest(request, response, eventLimiter)) return;
      await handleEvent(request, response);
      return;
    }
    if (request.method === "POST" && ["/api/measurement-flows", "/api/research-consent"].includes(request.url)) {
      if (!allowExpensiveRequest(request, response, eventLimiter)) return;
      const body = await readJsonBody(request);
      const result = request.url === "/api/measurement-flows" ? await commercialStore.registerFlow(body) : await commercialStore.consent(body);
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, result);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const standaloneDocument = ["/pilot", "/privacy", "/terms"].includes(requestPath) ? requestPath.slice(1) : "";
    await serveStatic(request, response, standaloneDocument ? "/index.html" : "", standaloneDocument ? { "X-TabiTabi-Document": standaloneDocument } : {});
  } catch (error) {
    if (error instanceof CommercialStoreError) {
      sendJson(response, error.status, { code: error.code, error: "Measurement request could not be accepted" });
      return;
    }
    console.error("REQUEST_FAILED", safeErrorSummary(error, "request"));
    if (!response.headersSent && error?.statusCode === 413) sendJson(response, 413, { code: "BODY_TOO_LARGE", error: "Request body is too large" });
    else if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
    else response.end();
  }
});

installFatalProcessHandlers({ processImpl: process, close: (done) => server.close(done) });

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
  const costs = await requestCostContext(request);
  await observeMeasurement(request, "search", null, "started");
  const startedAt = Date.now();
  try {
    const cacheKey = stableCacheKey([body?.query, body?.clues || {}]);
    const { value: result, cacheStatus } = await requestCosts.cached(placesSearchCache, cacheKey, costs, "text_search", async (loadId) => {
      await admitProviderCall("google_places");
      const budget = await dailyBudget.consume("places_search", dailyLimits.placesSearch);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return searchGooglePlaces({ query: body?.query, clues: body?.clues || {}, apiKey: process.env.GOOGLE_MAPS_API_KEY,
        fetchImpl: requestCosts.trackedFetch(costs, { provider: "google_places", operation: "text_search", sku: "text_search_pro", loadId }) });
    });
    await providerCircuit.recordOutcome("google_places", { status: "success" });
    await recordSourceMetric({ source: "google_places", operation: "text_search", skuClass: "pro", status: "success", durationMs: Date.now() - startedAt, resultCount: result.candidates.length, cacheStatus });
    await observeMeasurement(request, "search");
    sendJson(response, 200, { ...result, mode: "live", cacheStatus });
  } catch (error) {
    await recordProviderFailure("google_places", error);
    await recordSourceMetric({ source: "google_places", operation: "text_search", skuClass: "pro", status: "error", durationMs: Date.now() - startedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Restaurant search failed");
  }
}

async function handleCandidatePreview(request, response) {
  const body = await readJsonBody(request);
  const costs = await requestCostContext(request);
  const startedAt = Date.now();
  try {
    const placeId = String(body?.placeId || "").trim();
    const { value: place, cacheStatus } = await requestCosts.cached(placesDetailsCache, placeId, costs, "candidate_preview", async (loadId) => {
      await admitProviderCall("google_places");
      const budget = await dailyBudget.consume("places_details", dailyLimits.placesDetails);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return getGooglePlaceDetails({ placeId, apiKey: process.env.GOOGLE_MAPS_API_KEY,
        fetchImpl: requestCosts.trackedFetch(costs, { provider: "google_places", operation: "candidate_preview", sku: "place_details_enterprise", loadId }) });
    });
    await providerCircuit.recordOutcome("google_places", { status: "success" });
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
    await recordProviderFailure("google_places", error);
    await recordSourceMetric({ source: "google_places", operation: "candidate_preview", skuClass: "enterprise", status: "error", durationMs: Date.now() - startedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Candidate preview failed");
  }
}

async function handleTextExtraction(request, response) {
  try {
    const body = await readJsonBody(request);
    await observeMeasurement(request, "input", "text", "started");
    const result = parseTextInput(body?.text);
    if (result.kind === "text_clues" && result.searchQuery) await observeMeasurement(request, "input", "text");
    sendJson(response, 200, result);
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
    await observeMeasurement(request, "input", "webpage", "started");
    const result = await extractPublicWebpageClues({ url: body?.url });
    await observeMeasurement(request, "input", "webpage");
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
  const costs = await requestCostContext(request);
  await observeMeasurement(request, "details", null, "started");
  const googleStartedAt = Date.now();
  try {
    const { value: place, cacheStatus } = await requestCosts.cached(placesDetailsCache, String(body?.placeId || ""), costs, "place_details", async (loadId) => {
      await admitProviderCall("google_places");
      const budget = await dailyBudget.consume("places_details", dailyLimits.placesDetails);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      return getGooglePlaceDetails({ placeId: body?.placeId, apiKey: process.env.GOOGLE_MAPS_API_KEY,
        fetchImpl: requestCosts.trackedFetch(costs, { provider: "google_places", operation: "place_details", sku: "place_details_enterprise", loadId }) });
    });
    await providerCircuit.recordOutcome("google_places", { status: "success" });
    await recordSourceMetric({ source: "google_places", operation: "place_details", skuClass: "enterprise", status: "success", durationMs: Date.now() - googleStartedAt, resultCount: 1, cacheStatus });
    const hotPepperStartedAt = Date.now();
    let hotPepperResult;
    try {
      hotPepperResult = await searchHotPepper({
        name: place.name,
        address: place.address,
        phone: place.phone,
        apiKey: process.env.HOTPEPPER_API_KEY,
        fetchImpl: requestCosts.trackedFetch(costs, { provider: "hotpepper", operation: "shop_search", sku: "gourmet_api" }),
        beforeRequest: async () => {
          await admitProviderCall("hotpepper");
          await dailyBudget.consume("hotpepper_attempts", dailyLimits.hotPepperAttempts);
        }
      });
      await providerCircuit.recordOutcome("hotpepper", { status: "success" });
      if (hotPepperResult.available) {
        await recordSourceMetric({ source: "hotpepper", operation: "shop_search", skuClass: "api", status: "success", durationMs: Date.now() - hotPepperStartedAt, resultCount: hotPepperResult.match ? 1 : 0 });
      }
    } catch (error) {
      await recordProviderFailure("hotpepper", error);
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
          retrievedAt: discovery.retrievedAt || null,
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
    await observeMeasurement(request, "details");
    sendJson(response, 200, { restaurant, mode: "live", hotPepperAvailable: hotPepperResult.available, cacheStatus });
  } catch (error) {
    await recordProviderFailure("google_places", error);
    await recordSourceMetric({ source: "google_places", operation: "place_details", skuClass: "enterprise", status: "error", durationMs: Date.now() - googleStartedAt, errorCode: error instanceof DataSourceError ? error.status : "unknown" });
    sendSourceError(response, error, "Restaurant details failed");
  }
}

function sendSourceError(response, error, fallbackMessage) {
  if (error instanceof ProviderCircuitOpenError) {
    sendProviderCircuitError(response, error);
    return;
  }
  if (error instanceof DailyBudgetExceededError) {
    sendDailyBudgetError(response, error);
    return;
  }
  if (error instanceof DailyBudgetUnavailableError) {
    sendDailyBudgetUnavailableError(response);
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
  console.error("DATA_SOURCE_FAILURE", safeErrorSummary(error, "data_source"));
  sendJson(response, 500, { code: "DATA_SOURCE_ERROR", error: fallbackMessage });
}

function sendProviderCircuitError(response, error) {
  const retryAfterSeconds = error.openUntil
    ? Math.max(60, Math.ceil((new Date(error.openUntil).getTime() - Date.now()) / 1000))
    : 300;
  response.setHeader("Retry-After", String(retryAfterSeconds));
  console.error("SECURITY_CIRCUIT_OPEN", { provider: String(error.provider || "unknown").slice(0, 40), reason: String(error.reason || "automatic_guard").slice(0, 120), openUntil: error.openUntil || null });
  sendJson(response, 503, { code: error.code, error: "異常な外部 API 利用を検知したため、自動的に呼び出しを停止しました。", provider: error.provider || null, openUntil: error.openUntil || null });
}

async function admitProviderCall(provider) {
  if (paidApiEmergencyStopped()) throw new ProviderCircuitOpenError({ reason: "manual_emergency_stop", openUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
  return providerCircuit.admit(provider);
}

async function recordProviderFailure(provider, error) {
  if (error instanceof ProviderCircuitOpenError || error instanceof DailyBudgetExceededError || error instanceof DailyBudgetUnavailableError) return;
  if (!(error instanceof DataSourceError) || error.source !== provider) return;
  if (error instanceof DataSourceError && error.status >= 400 && error.status < 500 && ![401, 403, 429].includes(error.status)) return;
  const errorCode = error instanceof DataSourceError
    ? ([401, 403].includes(error.status) ? "authentication" : error.status === 429 ? "rate_limit" : String(error.status))
    : String(error?.kind || error?.code || "unknown");
  const snapshot = await providerCircuit.recordOutcome(provider, { status: "error", errorCode });
  if (snapshot.open) console.error("SECURITY_CIRCUIT_OPEN", { reason: snapshot.reason, openUntil: snapshot.openUntil });
}

function sendDailyBudgetUnavailableError(response) {
  response.setHeader("Retry-After", "300");
  sendJson(response, 503, { code: "DAILY_BUDGET_UNAVAILABLE", error: "利用上限を安全に確認できないため、現在は有料 API 呼び出しを停止しています。" });
}

function sendDailyBudgetError(response, error) {
  response.setHeader("Retry-After", "86400");
  sendJson(response, 429, { code: error.code, error: "本日の利用上限に達しました。明日もう一度お試しください。", bucket: error.bucket, date: error.date });
}

function allowExpensiveRequest(request, response, limiter) {
  const key = requestClientKey(request, process.env.TRUST_PROXY === "true", Boolean(process.env.FLY_APP_NAME));
  const result = limiter(key);
  response.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (result.allowed) return true;
  response.setHeader("Retry-After", String(result.retryAfterSeconds));
  sendJson(response, 429, { code: "RATE_LIMITED", error: "Too many requests; please retry shortly" });
  return false;
}

async function handleEvent(request, response) {
  const body = await readJsonBody(request);
  if (body?.schemaVersion === 2) {
    const receipt = await commercialStore.ingest(body, measurementCredentials(request));
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 202, receipt);
    return;
  }
  const record = sanitizeEvent(body, new Date(), { releaseRevision: process.env.RELEASE_REVISION });
  if (!record) {
    sendJson(response, 400, { code: "INVALID_EVENT", error: "Unsupported event" });
    return;
  }
  await eventLog.append(record);
  sendJson(response, 202, { accepted: true });
}

function measurementCredentials(request) {
  return { flowId: request.headers["x-measurement-flow"], token: request.headers["x-measurement-token"] };
}

async function requestCostContext(request) {
  if (!requestCostContexts.has(request)) requestCostContexts.set(request, (async () => {
    let attribution = { releaseRevision: process.env.RELEASE_REVISION, trafficType: auditWorkbench ? "audit" : "unknown" };
    if (request.headers["x-measurement-flow"] && request.headers["x-measurement-token"]) {
      try { attribution = await commercialStore.resolveAttribution(measurementCredentials(request)); }
      catch { /* Count unattributed operating costs even if optional measurement is unavailable. */ }
    }
    return requestCosts.context(attribution);
  })());
  return requestCostContexts.get(request);
}

async function observeMeasurement(request, stage, inputType = null, outcome = "succeeded") {
  if (!request.headers["x-measurement-flow"] && !request.headers["x-measurement-token"]) return;
  try { await commercialStore.observe(measurementCredentials(request), { stage, inputType, sourceMode: "live", outcome }); }
  catch { console.error("MEASUREMENT_OBSERVATION_UNAVAILABLE"); }
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
  const costs = await requestCostContext(request);
  const imageDataUrl = body?.imageDataUrl;
  await observeMeasurement(request, "input", "screenshot", "started");
  let result;
  let cacheStatus = "miss";
  try {
    validateImageDataUrl(imageDataUrl);
    const fingerprint = imageContentFingerprint(imageDataUrl);
    const cached = await requestCosts.cached(visionResultCache, fingerprint, costs, "screenshot_extraction", (loadId) => visionConcurrency.run(async () => {
      const budget = await dailyBudget.consume("vision_requests", dailyLimits.visionRequests);
      response.setHeader("X-Daily-Budget-Remaining", String(budget.remaining));
      let activeProvider;
      const measuredFetch = requestCosts.trackedFetch(costs, () => ({ provider: activeProvider.name,
        operation: "screenshot_extraction", sku: activeProvider.model, loadId, fallback: activeProvider.name !== visionCapabilities.primaryProvider }));
      const extracted = await extractScreenshotWithFallback({
        imageDataUrl,
        env: process.env,
        fetchImpl: measuredFetch,
        beforeProviderAttempt: async (provider) => {
          await admitProviderCall(provider.name);
          if (provider.name === "qwen") await dailyBudget.consume("vision_qwen_attempts", dailyLimits.visionQwenAttempts);
          else if (provider.name === "openai") await dailyBudget.consume("vision_openai_fallback_attempts", dailyLimits.visionFallbackAttempts);
          activeProvider = provider;
        }
      });
      await recordVisionAttempts(extracted.attempts);
      return extracted;
    }));
    result = cached.value;
    cacheStatus = cached.cacheStatus;
  } catch (error) {
    if (error instanceof DailyBudgetExceededError) {
      sendDailyBudgetError(response, error);
      return;
    }
    if (error instanceof DailyBudgetUnavailableError) {
      sendDailyBudgetUnavailableError(response);
      return;
    }
    if (error instanceof ProviderCircuitOpenError) {
      sendProviderCircuitError(response, error);
      return;
    }
    if (error instanceof VisionExtractionError) {
      await recordVisionAttempts(error.attempts || []);
      sendJson(response, error.status, { code: error.code, error: publicVisionError(error.code) });
      return;
    }
    if (error instanceof VisionConcurrencyError) {
      response.setHeader("Retry-After", "5");
      sendJson(response, 429, { code: error.code, error: "画像解析が混み合っています。数秒後にもう一度お試しください。" });
      return;
    }
    console.error("Unexpected screenshot extraction error", error?.name || "unknown");
    sendJson(response, 500, { code: "VISION_INTERNAL_ERROR", error: "Screenshot extraction failed unexpectedly" });
    return;
  }
  await observeMeasurement(request, "input", "screenshot");
  sendJson(response, 200, {
    extraction: result.extraction,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.usedFallback,
    fallbackReason: result.fallbackReason,
    requiresUserConfirmation: result.requiresUserConfirmation,
    cacheStatus
  });
}

async function recordVisionAttempts(attempts) {
  for (const attempt of attempts || []) {
    if (attempt.status === "success" || ["authentication", "rate_limit", "timeout", "network", "upstream_5xx"].includes(attempt.errorCode)) {
      await providerCircuit.recordOutcome(attempt.provider, { status: attempt.status, errorCode: attempt.errorCode });
    }
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

function paidApiEmergencyStopped() {
  return process.env.PAID_API_EMERGENCY_STOP === "true";
}

function paidProviderApiPath(method, pathname) {
  if (String(method || "").toUpperCase() !== "POST") return false;
  return pathname === "/api/extract-screenshot" || pathname.startsWith("/api/restaurants/");
}

function safeErrorSummary(error, operation) {
  return {
    operation,
    name: String(error?.name || "UnknownError").slice(0, 80),
    code: typeof error?.code === "string" ? error.code.slice(0, 80) : null,
    source: typeof error?.source === "string" ? error.source.slice(0, 40) : null,
    status: Number.isInteger(error?.status) ? error.status : null
  };
}

function publicVisionError(code) {
  return {
    INVALID_IMAGE: "A valid PNG, JPEG, or WebP screenshot is required",
    IMAGE_TOO_LARGE: "The screenshot file is too large",
    IMAGE_DIMENSIONS_TOO_LARGE: "The screenshot dimensions are too large",
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
  return addresses.length ? [...new Set(addresses)] : ["<この Mac のローカルネットワーク IP>"];
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

function publicOperatorInfo(env = {}) {
  const operatorName = String(env.PUBLIC_OPERATOR_NAME || "Ren").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 120) || "Ren";
  const candidateEmail = String(env.PUBLIC_CONTACT_EMAIL || "rgq.alan515@gmail.com").trim();
  const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail) ? candidateEmail.slice(0, 254) : "rgq.alan515@gmail.com";
  return { operatorName, contactEmail };
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
