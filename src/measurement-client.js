// Deliberately independent of the server module: only fixed v2 fields leave the browser.
export const MEASUREMENT_SESSION_KEY = "tabitabi.measurement.session.v2";
export const RESEARCH_STORAGE_KEY = "tabitabi.research.v1";
const IDLE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 1500;
const MAX_QUEUE = 32;
const CONSENT_VERSION = "research-v1";
const INPUTS = ["screenshot", "text", "social_link", "webpage", "restaurant_name"];
const RUN_EVENTS = ["analysis_started", "input_submitted", "clues_extracted", "candidates_shown", "candidate_confirmed", "analysis_completed", "analysis_failed"];
const REVIEW_EVENTS = ["review_started", "review_completed", "review_failed"];
const LINKED_EVENTS = ["primary_action_clicked", "issue_reported", "saved_plan_updated"];
const ENUMS = {
  inputType: INPUTS,
  actionCapability: ["direct_booking", "platform_booking", "phone", "map", "listing", "search", "unknown"],
  issueCategory: ["wrong_branch", "wrong_link", "outdated_info", "unclear_condition", "other"],
  failureStage: ["input", "extraction", "search", "confirmation", "details", "review", "unknown"],
  channel: ["direct", "social", "search", "partner", "unknown"],
  researchSource: ["natural", "benchmark", "assigned_task", "incentivized", "reminded", "unknown"],
  deviceCategory: ["mobile", "desktop", "tablet", "unknown"]
};
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const tokenValid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const credentialsValid = (value) => uuid(value?.deviceId) && tokenValid(value?.token);
const sameGrant = (a, b) => credentialsValid(a) && a.deviceId === b?.deviceId && a.token === b?.token;
function browserDefault(key) { try { return globalThis[key]; } catch { return undefined; } }

export function createMeasurementClient({
  fetchImpl = browserDefault("fetch"), storage = browserDefault("localStorage"),
  sessionStorage = browserDefault("sessionStorage"), cryptoImpl = browserDefault("crypto"),
  now = Date.now, headers = () => ({}), onChange = () => {}
} = {}) {
  let activeFlow = null;
  let flowGeneration = 0;
  let memorySession = null;
  let research = { state: "not_asked" };
  let storageFailed = false;
  let consentGeneration = 0;
  let accepting = null;
  let revoking = null;
  let pumping = false;
  const queue = [];
  const clock = () => Number(now());
  const publicResearch = () => ({ state: research.state, expiresAt: research.state === "accepted" ? research.expiresAt : null });
  function notify() { try { onChange(publicResearch()); } catch { /* UI cannot break core operations. */ } }
  function setResearch(value) { research = value; notify(); }
  function newId() { try { const id = cryptoImpl.randomUUID(); return uuid(id) ? id.toLowerCase() : null; } catch { return null; } }
  function newToken() {
    try {
      const bytes = cryptoImpl.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    } catch { return null; }
  }
  function stripQueuedResearch() { for (const item of queue) item.grant = null; }
  function storageError() {
    storageFailed = true;
    stripQueuedResearch();
    if (research.state !== "pending_revocation") setResearch({ state: "unavailable" });
  }
  function persist(value) {
    try {
      if (!storage) throw new Error("storage unavailable");
      storage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(value));
      storageFailed = false;
      setResearch(value);
      return true;
    } catch { storageError(); return false; }
  }
  function readResearch() {
    if (storageFailed) return research;
    try {
      if (!storage) throw new Error("storage unavailable");
      const raw = storage.getItem(RESEARCH_STORAGE_KEY);
      const value = raw == null ? { state: "not_asked" } : JSON.parse(raw);
      if (!value || !["not_asked", "pending_accept", "accepted", "declined", "pending_revocation", "revoked", "expired"].includes(value.state)) throw new Error("invalid research state");
      if (["accepted", "pending_accept", "pending_revocation"].includes(value.state) && !credentialsValid(value)) throw new Error("invalid research credentials");
      if (value.state === "accepted" && (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock())) {
        stripQueuedResearch();
        persist({ state: "expired" });
        return research;
      }
      if (JSON.stringify(value) !== JSON.stringify(research)) setResearch(value);
      if (value.state !== "accepted") stripQueuedResearch();
      return research;
    } catch { storageError(); return research; }
  }
  function sessionId() {
    let value = memorySession;
    try {
      const raw = sessionStorage?.getItem(MEASUREMENT_SESSION_KEY);
      if (raw) value = JSON.parse(raw);
    } catch { /* A memory-only session still supports core measurement. */ }
    const time = clock();
    if (!uuid(value?.id) || !Number.isFinite(value?.lastActive) || time - value.lastActive >= IDLE_MS || time < value.lastActive) {
      const id = newId();
      if (!id) return null;
      value = { id, lastActive: time };
    } else value = { id: value.id, lastActive: time };
    memorySession = value;
    try { sessionStorage?.setItem(MEASUREMENT_SESSION_KEY, JSON.stringify(value)); } catch { /* memory fallback */ }
    return value.id;
  }
  async function post(path, body, extraHeaders = {}) {
    let timer;
    let controller;
    try {
      controller = new AbortController();
      const operation = Promise.resolve().then(async () => {
        const response = await fetchImpl(path, {
          method: "POST", headers: { ...headers(), "Content-Type": "application/json", ...extraHeaders },
          body: JSON.stringify(body), signal: controller.signal, cache: "no-store"
        });
        let data = null;
        try { data = await response.json(); } catch { /* invalid acknowledgement is failure */ }
        return { ok: response.ok, status: response.status, data, retryable: response.status === 429 || response.status >= 500 };
      });
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({ ok: false, retryable: true }); }, TIMEOUT_MS);
      });
      return await Promise.race([operation, timeout]);
    } catch { return { ok: false, retryable: true }; }
    finally { clearTimeout(timer); }
  }
  async function consentPost(body) {
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await post("/api/research-consent", body);
      if (!result.retryable) break;
    }
    return result;
  }
  function reset() { flowGeneration += 1; activeFlow = null; }
  async function start(options = {}) {
    reset();
    const generation = flowGeneration;
    try {
      const { kind, inputType, sourceMode, trafficType, batchId, batchOriginKnown, reviewIntent, campaignId } = options;
      if (!["analysis", "review"].includes(kind) || (kind === "analysis" && !INPUTS.includes(inputType))) return null;
      const session = sessionId();
      if (!session) return null;
      const body = { kind, sessionId: session, sourceMode: sourceMode === "demo" ? "demo" : "unknown", trafficType: trafficType === "audit" ? "audit" : "product" };
      if (kind === "analysis") body.inputType = inputType;
      if (uuid(batchId)) body.batchId = batchId;
      if (typeof batchOriginKnown === "boolean") body.batchOriginKnown = batchOriginKnown;
      if (["saved_plan_refresh", "history_open", "automatic", "unknown"].includes(reviewIntent)) body.reviewIntent = reviewIntent;
      if (typeof campaignId === "string" && /^[a-z0-9_-]{1,40}$/.test(campaignId)) body.campaignId = campaignId;
      const result = await post("/api/measurement-flows", body);
      const data = result.data;
      const link = kind === "analysis" ? "analysisRunId" : "interactionId";
      if (!result.ok || !uuid(data?.flowId) || !tokenValid(data?.token) || data?.sessionId !== session
        || !uuid(data?.[link]) || !(Date.parse(data?.expiresAt) > clock()) || generation !== flowGeneration) return null;
      activeFlow = Object.freeze({ ...body, flowId: data.flowId, token: data.token, [link]: data[link], expiresAt: data.expiresAt });
      return activeFlow;
    } catch { return null; }
  }
  function requestHeaders(inputType) {
    if (!activeFlow || !(Date.parse(activeFlow.expiresAt) > clock())) return {};
    // URL entries can contain usable restaurant clues before webpage extraction.
    if (inputType && inputType !== activeFlow.inputType && !(inputType === "text" && ["restaurant_name", "social_link", "webpage"].includes(activeFlow.inputType))) return {};
    return { "X-Measurement-Flow": activeFlow.flowId, "X-Measurement-Token": activeFlow.token };
  }
  async function drain() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const item = queue[0];
        let accepted = false;
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const grant = readResearch();
            const payload = { ...item.body };
            if (!storageFailed && grant.state === "accepted" && sameGrant(grant, item.grant)) {
              payload.research = { consentVersion: CONSENT_VERSION, deviceId: grant.deviceId, token: grant.token };
            }
            const response = await post("/api/events", payload, item.headers);
            accepted = response.ok && response.data?.accepted === true;
            if (accepted || !response.retryable) break;
          }
        } catch { /* Measurement never rejects a core action. */ }
        queue.shift();
        item.resolve(accepted);
      }
    } finally { pumping = false; }
  }
  function emit(event, fields = {}) {
    try {
      if (![...RUN_EVENTS, ...REVIEW_EVENTS, ...LINKED_EVENTS, "app_visit"].includes(event) || queue.length >= MAX_QUEUE) return Promise.resolve(false);
      const flow = event === "app_visit" ? null : activeFlow;
      if (event !== "app_visit" && (!flow || (RUN_EVENTS.includes(event) && flow.kind !== "analysis") || (REVIEW_EVENTS.includes(event) && flow.kind !== "review"))) return Promise.resolve(false);
      const currentSession = sessionId();
      const eventId = newId();
      if (!currentSession || !eventId) return Promise.resolve(false);
      const body = { schemaVersion: 2, event, eventId, sessionId: flow?.sessionId || currentSession };
      if (flow) {
        body[flow.kind === "analysis" ? "analysisRunId" : "interactionId"] = flow.analysisRunId || flow.interactionId;
        if (flow.batchId) body.batchId = flow.batchId;
      }
      for (const [key, values] of Object.entries(ENUMS)) if (values.includes(fields?.[key])) body[key] = fields[key];
      if (body.issueCategory && event !== "issue_reported") delete body.issueCategory;
      if ((event === "primary_action_clicked" && !body.actionCapability) || (event === "issue_reported" && !body.issueCategory)
        || (["analysis_failed", "review_failed"].includes(event) && !body.failureStage)) return Promise.resolve(false);
      if (flow?.inputType) body.inputType = flow.inputType;
      body.sourceMode = fields?.sourceMode === "demo" || flow?.sourceMode === "demo" ? "demo" : "unknown";
      body.trafficType = fields?.trafficType === "audit" || flow?.trafficType === "audit" ? "audit" : "product";
      const grant = readResearch();
      const envelope = {
        body, headers: flow ? { "X-Measurement-Flow": flow.flowId, "X-Measurement-Token": flow.token } : {},
        grant: !storageFailed && grant.state === "accepted" ? { deviceId: grant.deviceId, token: grant.token } : null
      };
      const pending = new Promise((resolve) => { queue.push({ ...envelope, resolve }); });
      void drain().catch(() => { while (queue.length) queue.shift().resolve(false); });
      return pending;
    } catch { return Promise.resolve(false); }
  }
  async function acceptResearch() {
    readResearch();
    if (research.state === "accepted" || research.state === "pending_revocation" || storageFailed) return publicResearch();
    if (accepting) return accepting;
    const generation = ++consentGeneration;
    let grant = research.state === "pending_accept" ? research : {
      state: "pending_accept", deviceId: newId(), token: newToken(), requestedAt: new Date(clock()).toISOString()
    };
    grant = { ...grant, requestedAt: new Date(clock()).toISOString() };
    if (!credentialsValid(grant) || !persist(grant)) return publicResearch();
    accepting = (async () => {
      try {
        const response = await consentPost({ consentVersion: CONSENT_VERSION, state: "accepted", deviceId: grant.deviceId, token: grant.token, requestedAt: grant.requestedAt });
        const latest = readResearch();
        if (generation !== consentGeneration || storageFailed || latest.state !== "pending_accept" || !sameGrant(latest, grant)) return publicResearch();
        if (response.ok && response.data?.accepted === true && response.data.state === "accepted" && Date.parse(response.data.expiresAt) > clock()) {
          persist({ ...grant, state: "accepted", expiresAt: response.data.expiresAt });
        }
        return publicResearch();
      } catch { return publicResearch(); }
      finally { accepting = null; }
    })();
    return accepting;
  }
  async function sendRevocation(grant) {
    if (revoking) return revoking;
    revoking = (async () => {
      try {
        const response = await consentPost({ consentVersion: CONSENT_VERSION, state: "revoked", deviceId: grant.deviceId, token: grant.token });
        // A different tab may already have finished withdrawal; never overwrite a new grant.
        const latest = readResearch();
        if (response.ok && response.data?.accepted === true && response.data.state === "revoked"
          && latest.state === "pending_revocation" && sameGrant(latest, grant)) persist({ state: "revoked" });
        return publicResearch();
      } catch { return publicResearch(); }
      finally { revoking = null; }
    })();
    return revoking;
  }
  async function revokeResearch() {
    const grant = readResearch();
    consentGeneration += 1;
    stripQueuedResearch();
    if (!credentialsValid(grant)) {
      persist({ state: "revoked" });
      return publicResearch();
    }
    const pending = { ...grant, state: "pending_revocation" };
    setResearch(pending); // Stop association even if durable storage is unavailable.
    persist(pending);
    return sendRevocation(pending);
  }
  async function declineResearch() {
    const grant = readResearch();
    if (credentialsValid(grant)) return revokeResearch();
    consentGeneration += 1;
    stripQueuedResearch();
    persist({ state: "declined" });
    await consentPost({ consentVersion: CONSENT_VERSION, state: "declined" });
    return publicResearch();
  }
  async function syncResearch() {
    readResearch();
    if (research.state === "pending_revocation") return sendRevocation(research);
    return publicResearch();
  }
  async function retryResearch() {
    readResearch();
    if (research.state === "pending_revocation") return sendRevocation(research);
    if (research.state === "pending_accept") return acceptResearch();
    return publicResearch();
  }
  function clearLocalSession() {
    reset();
    memorySession = null;
    try { sessionStorage?.removeItem(MEASUREMENT_SESSION_KEY); } catch { /* no storage dependency */ }
  }
  // Reload retries only outstanding withdrawal; participation always requires an explicit action.
  void syncResearch().catch(() => {});
  return {
    start, reset, requestHeaders, emit, newBatchId: newId,
    acceptResearch, declineResearch, revokeResearch, retryResearch, syncResearch, clearLocalSession,
    get flow() { return activeFlow; },
    get research() { readResearch(); return publicResearch(); },
    get researchState() { readResearch(); return publicResearch(); }
  };
}

// A link to a platform listing does not establish a booking-capable destination.
export function measurementActionCapability(type, option) {
  if (type === "phone") return "phone";
  if (["map", "open_map"].includes(type)) return "map";
  if (["discover_platform", "search"].includes(type)) return "search";
  if (option?.capability?.recommended && ["instant", "request", "instant_or_request", "provider_determined"].includes(option.capability.bookingMode)) {
    return option.officiality === "restaurant_official" ? "direct_booking" : "platform_booking";
  }
  return ["open_booking_source", "official_website"].includes(type) ? "listing" : "unknown";
}
