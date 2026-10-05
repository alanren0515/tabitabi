import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { campaignContext, MEASUREMENT_CAMPAIGNS } from "./measurement-campaigns.mjs";
import { createResearchAssociation, createResearchConsentRecord, sanitizeCommercialEvent, validateCommercialEvent, COMMERCIAL_ENUMS } from "./commercial-event-schema.mjs";

const DAY = 24 * 60 * 60 * 1000;
const RETENTION = 30 * DAY;
const FLOW_TTL = 30 * 60 * 1000;
const queues = new Map();
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const tokenValid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const emptyState = () => ({ version: 1, events: [], flows: {}, consents: {}, researchLinks: [] });

export class CommercialStoreError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// One process owns the file. Atomic replacement commits events, dedupe and research joins together.
// The shared queue also serializes independent store instances for this path in the same process.
export function createCommercialStore({ path, now = () => Date.now(), releaseRevision = "", audit = false, campaigns = MEASUREMENT_CAMPAIGNS,
  maxEvents = 5000, maxFlows = 10000, maxConsents = 5000, maxBytes = 10 * 1024 * 1024 } = {}) {
  const file = resolve(path);
  const revision = /^[a-f0-9]{40}$/.test(releaseRevision) ? releaseRevision : null;

  function transact(operation) {
    const prior = queues.get(file) || Promise.resolve();
    const result = prior.then(async () => {
      const clock = now();
      if (!Number.isFinite(clock)) throw new CommercialStoreError("MEASUREMENT_CLOCK_UNAVAILABLE", 503);
      const state = await load();
      prune(state, clock);
      const value = await operation(state, clock);
      const output = JSON.stringify(state);
      if (state.events.length > maxEvents || Object.keys(state.flows).length > maxFlows
        || Object.keys(state.consents).length > maxConsents || Buffer.byteLength(output) > maxBytes) {
        // Never evict unexpired dedupe keys to make space; fail visibly instead.
        throw new CommercialStoreError("MEASUREMENT_CAPACITY_REACHED", 503);
      }
      await persist(output);
      return value;
    });
    const settled = result.catch(() => {});
    queues.set(file, settled);
    settled.finally(() => { if (queues.get(file) === settled) queues.delete(file); });
    return result;
  }

  async function load() {
    try {
      if ((await stat(file)).size > maxBytes) throw new Error("oversized");
      const state = JSON.parse(await readFile(file, "utf8"));
      if (state?.version !== 1 || !Array.isArray(state.events) || !Array.isArray(state.researchLinks)
        || !object(state.flows) || !object(state.consents)
        || state.events.some((item) => !item?.record || !Number.isFinite(Date.parse(item.record.occurredAt)) || !/^[a-f0-9]{64}$/.test(item.fingerprint || ""))
        || Object.values(state.flows).some((flow) => !object(flow) || !Number.isFinite(flow.retainUntil) || !object(flow.stages))
        || Object.values(state.consents).some((grant) => !object(grant) || !Number.isFinite(grant.retainUntil))) throw new Error("invalid state");
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw new CommercialStoreError("MEASUREMENT_STORE_UNAVAILABLE", 503);
    }
  }

  async function persist(output) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(output, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      const directory = await open(dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw new CommercialStoreError("MEASUREMENT_STORE_UNAVAILABLE", 503); }
    finally { await rm(temporary, { force: true }); }
  }

  function authenticateFlow(state, credentials, clock, { allowExpired = false } = {}) {
    const id = credentials?.flowId;
    const token = credentials?.token;
    if (!uuid(id) || !tokenValid(token)) throw new CommercialStoreError("INVALID_MEASUREMENT_FLOW", 401);
    const flow = state.flows[id.toLowerCase()];
    if (!flow || !safeDigestEquals(flow.tokenHash, hash(token))) throw new CommercialStoreError("INVALID_MEASUREMENT_FLOW", 401);
    if (!allowExpired && (clock >= flow.expiresAt || flow.releaseRevision !== revision)) throw new CommercialStoreError("MEASUREMENT_FLOW_EXPIRED", 409);
    return flow;
  }

  return {
    resolveAttribution(credentials) {
      return transact((state, clock) => {
        const flow = authenticateFlow(state, credentials, clock);
        return { [flow.kind === "analysis" ? "analysisRunId" : "interactionId"]: flow.id,
          releaseRevision: flow.releaseRevision, trafficType: flow.trafficType, sourceMode: context(flow).sourceMode };
      });
    },
    registerFlow(body) {
      if (!object(body) || !["analysis", "review"].includes(body.kind) || !uuid(body.sessionId)
        || (body.kind === "analysis" && !COMMERCIAL_ENUMS.inputType.includes(body.inputType))
        || (body.batchId != null && !uuid(body.batchId))) return Promise.reject(new CommercialStoreError("INVALID_MEASUREMENT_FLOW"));
      return transact((state, clock) => {
        const id = randomUUID();
        const token = randomBytes(32).toString("base64url");
        const source = campaignContext(body.campaignId, campaigns);
        const flow = {
          id, kind: body.kind, sessionId: body.sessionId.toLowerCase(), tokenHash: hash(token),
          inputType: body.kind === "analysis" ? body.inputType : null,
          batchId: body.batchId?.toLowerCase() || null,
          createdAt: clock, expiresAt: clock + FLOW_TTL, retainUntil: clock + RETENTION,
          releaseRevision: revision, trafficType: audit || body.trafficType === "audit" ? "audit" : "product",
          channel: source.channel,
          researchSource: exclusionSource(body.researchSource) !== "unknown" ? exclusionSource(body.researchSource)
            : body.batchOriginKnown === false ? "unknown" : source.researchSource,
          reviewIntent: body.kind === "review" && ["saved_plan_refresh", "history_open", "automatic"].includes(body.reviewIntent) ? body.reviewIntent : "unknown",
          demo: body.sourceMode === "demo", invalidSequence: false, stages: {}, attemptedStages: {}
        };
        state.flows[id] = flow;
        return { flowId: id, token, [body.kind === "analysis" ? "analysisRunId" : "interactionId"]: id,
          sessionId: flow.sessionId, expiresAt: new Date(flow.expiresAt).toISOString() };
      });
    },

    // Internal only: successful API handlers supply observations; no public observation endpoint exists.
    observe(credentials, { stage, inputType = null, sourceMode = "live", outcome = "succeeded" }) {
      if (!["input", "search", "details"].includes(stage) || !["live", "demo"].includes(sourceMode)
        || !["started", "succeeded"].includes(outcome)) return Promise.reject(new CommercialStoreError("INVALID_OBSERVATION"));
      return transact((state, clock) => {
        const flow = authenticateFlow(state, credentials, clock);
        if (sourceMode === "demo") flow.demo = true;
        flow.attemptedStages ||= {};
        flow.attemptedStages[stage] = clock;
        if (flow.kind === "analysis") {
          const inputMatches = inputType === flow.inputType || (inputType === "text" && ["restaurant_name", "social_link", "webpage"].includes(flow.inputType));
          if ((stage === "input" && !inputMatches) || (outcome === "succeeded" && ((stage === "search" && flow.stages.input == null)
            || (stage === "details" && flow.stages.search == null)))) flow.invalidSequence = true;
        } else if (stage !== "details") flow.invalidSequence = true;
        if (outcome === "succeeded") flow.stages[stage] = clock;
        refreshFlowEvents(state, flow);
        return { observed: true };
      });
    },

    ingest(body, credentials) {
      const validation = validateCommercialEvent(body);
      if (!validation.valid) return Promise.reject(new CommercialStoreError("INVALID_EVENT"));
      return transact((state, clock) => {
        const input = validation.event;
        const parentId = input.analysisRunId || input.interactionId;
        const fingerprint = hash(JSON.stringify(input));
        const existing = state.events.find((item) => item.record.eventId === input.eventId);
        let flow = null;
        if (parentId) {
          flow = authenticateFlow(state, credentials, clock, { allowExpired: Boolean(existing) });
          if (flow.id !== parentId || flow.sessionId !== input.sessionId
            || (flow.kind === "analysis") !== Boolean(input.analysisRunId) || (input.batchId || null) !== flow.batchId) {
            throw new CommercialStoreError("MEASUREMENT_LINK_MISMATCH", 409);
          }
          if (body.sourceMode === "demo") flow.demo = true;
          if (body.trafficType === "audit") flow.trafficType = "audit";
          if (exclusionSource(body.researchSource) !== "unknown") flow.researchSource = exclusionSource(body.researchSource);
          refreshFlowEvents(state, flow);
        }
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new CommercialStoreError("EVENT_ID_CONFLICT", 409);
          return { accepted: true, duplicate: true, researchLinked: state.researchLinks.some((link) => link.eventId === input.eventId) };
        }
        if (flow) {
          const required = flow.kind === "analysis" ? ["input", "search", "details"] : ["details"];
          if (!flow.demo && ["analysis_completed", "review_completed"].includes(input.event) && required.some((stage) => flow.stages[stage] == null)) throw new CommercialStoreError("COMPLETION_NOT_OBSERVED", 409);
          if (!flow.demo && ["candidates_shown", "candidate_confirmed"].includes(input.event) && flow.stages.search == null) throw new CommercialStoreError("SEARCH_NOT_OBSERVED", 409);
          flow.retainUntil = Math.max(flow.retainUntil, clock + RETENTION);
        }
        const record = sanitizeCommercialEvent(body, new Date(clock), flow ? context(flow) : {
          releaseRevision: revision, trafficType: audit || body.trafficType === "audit" ? "audit" : "product", researchSource: exclusionSource(body.researchSource)
        });
        state.events.push({ fingerprint, record });
        let association = null;
        const grantKey = researchKey(body.research);
        if (grantKey) {
          const consent = state.consents[grantKey];
          association = createResearchAssociation(record, consent, new Date(clock));
          if (association) state.researchLinks.push({ ...association, grantKey });
        }
        return { accepted: true, duplicate: false, researchLinked: Boolean(association) };
      });
    },

    consent(body) {
      const record = createResearchConsentRecord(body, new Date(now()));
      if (!record) return Promise.reject(new CommercialStoreError("INVALID_RESEARCH_CONSENT"));
      if (record.state === "declined" && (body.deviceId != null || body.token != null)) return Promise.reject(new CommercialStoreError("USE_REVOKE_FOR_EXISTING_CONSENT"));
      if (record.state === "declined") return Promise.resolve({ accepted: true, state: "declined" });
      const key = researchKey(body);
      if (!key) return Promise.reject(new CommercialStoreError("INVALID_RESEARCH_CREDENTIALS"));
      return transact((state, clock) => {
        const previous = state.consents[key];
        if (record.state === "revoked") {
          // A tombstone contains no device identifier and prevents delayed acceptance replay.
          state.consents[key] = { state: "revoked", retainUntil: clock + RETENTION };
          state.researchLinks = state.researchLinks.filter((link) => link.grantKey !== key);
          return { accepted: true, state: "revoked" };
        }
        if (previous && previous.state !== "accepted") throw new CommercialStoreError("RESEARCH_GRANT_CLOSED", 409);
        if (previous) return { accepted: true, state: "accepted", expiresAt: previous.expiresAt };
        const requestedAt = typeof body.requestedAt === "string" ? Date.parse(body.requestedAt) : NaN;
        if (!Number.isFinite(requestedAt) || Math.abs(clock - requestedAt) > 5 * 60 * 1000) throw new CommercialStoreError("CONSENT_REQUEST_EXPIRED", 409);
        if (Object.values(state.consents).some((item) => item.state === "accepted" && item.deviceId === record.deviceId)) throw new CommercialStoreError("RESEARCH_DEVICE_ALREADY_REGISTERED", 409);
        state.consents[key] = { ...createResearchConsentRecord(body, new Date(clock)), retainUntil: clock + RETENTION };
        return { accepted: true, state: "accepted", expiresAt: state.consents[key].expiresAt };
      });
    },

    prune() { return transact(() => ({ pruned: true })); }
  };
}

function prune(state, clock) {
  state.events = state.events.filter((item) => Date.parse(item.record.occurredAt) > clock - RETENTION);
  for (const [id, flow] of Object.entries(state.flows)) if (flow.retainUntil <= clock) delete state.flows[id];
  for (const [key, grant] of Object.entries(state.consents)) {
    if (grant.state === "accepted" && Date.parse(grant.expiresAt) <= clock) {
      state.consents[key] = { state: "expired", retainUntil: Date.parse(grant.expiresAt) + RETENTION };
    } else if (grant.retainUntil <= clock) delete state.consents[key];
  }
  const ids = new Set(state.events.map((item) => item.record.eventId));
  state.researchLinks = state.researchLinks.filter((link) => ids.has(link.eventId) && state.consents[link.grantKey]?.state === "accepted" && Date.parse(link.expiresAt) > clock);
}

function context(flow) {
  // Failed real attempts stay in the funnel; source mode is not a completion signal.
  const attempted = flow.kind === "review" ? flow.attemptedStages?.details != null : flow.attemptedStages?.input != null;
  return { sourceMode: flow.demo ? "demo" : attempted && !flow.invalidSequence ? "live" : "unknown",
    trafficType: flow.trafficType, releaseRevision: flow.releaseRevision, channel: flow.channel, researchSource: flow.researchSource };
}
function refreshFlowEvents(state, flow) {
  for (const item of state.events) if ((item.record.analysisRunId || item.record.interactionId) === flow.id) Object.assign(item.record, context(flow));
}
function exclusionSource(value) { return ["benchmark", "assigned_task", "incentivized", "reminded"].includes(value) ? value : "unknown"; }
function researchKey(value) { return uuid(value?.deviceId) && tokenValid(value?.token) ? hash(`${value.deviceId.toLowerCase()}.${value.token}`) : null; }
function safeDigestEquals(left, right) { return typeof left === "string" && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex")); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
