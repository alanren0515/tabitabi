import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_WINDOW_MS = 5 * 60_000;
const DEFAULT_OPEN_MS = 6 * 60 * 60_000;
const DEFAULT_LIMITS = Object.freeze({ qwen: 10, openai: 3, google_places: 20, hotpepper: 20 });
const PROVIDERS = new Set(Object.keys(DEFAULT_LIMITS));

export class ProviderCircuitOpenError extends Error {
  constructor({ provider, reason, openUntil }) {
    super("Paid provider circuit is open");
    this.name = "ProviderCircuitOpenError";
    this.code = "PROVIDER_CIRCUIT_OPEN";
    this.status = 503;
    this.provider = provider;
    this.reason = reason;
    this.openUntil = openUntil;
  }
}

export function createProviderCircuitBreaker({
  path,
  now = () => new Date(),
  windowMs = DEFAULT_WINDOW_MS,
  openMs = DEFAULT_OPEN_MS,
  providerLimits = DEFAULT_LIMITS,
  failureLimit = 5,
  authFailureLimit = 2
}) {
  let queue = Promise.resolve();
  function serialize(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    admit(provider) {
      return serialize(() => admitProviderAttempt({ path, provider, now: now(), windowMs, openMs, providerLimits }));
    },
    recordOutcome(provider, outcome = {}) {
      return serialize(() => recordProviderOutcome({ path, provider, outcome, now: now(), windowMs, openMs, failureLimit, authFailureLimit }));
    },
    snapshot() {
      return serialize(async () => publicCircuitSnapshot(await readState(path), now()));
    }
  };
}

async function admitProviderAttempt({ path, provider, now, windowMs, openMs, providerLimits }) {
  assertKnownProvider(provider);
  const timestamp = now.getTime();
  const state = normalizeState(await readState(path), timestamp, windowMs);
  assertStateUsable(state, provider, timestamp);
  const providerState = state.providers[provider] || freshProviderState();
  const limit = Number(providerLimits[provider]) || 1;
  if (providerState.attempts.length >= limit) {
    openProvider(providerState, `burst:${provider}`, timestamp, openMs);
    state.providers[provider] = providerState;
    await writeState(path, state);
    throw circuitError(provider, providerState);
  }
  providerState.attempts.push({ provider, at: timestamp });
  providerState.updatedAt = new Date(timestamp).toISOString();
  state.providers[provider] = providerState;
  await writeState(path, state);
  return { provider, remaining: Math.max(0, limit - providerState.attempts.length) };
}

async function recordProviderOutcome({ path, provider, outcome, now, windowMs, openMs, failureLimit, authFailureLimit }) {
  assertKnownProvider(provider);
  const timestamp = now.getTime();
  const state = normalizeState(await readState(path), timestamp, windowMs);
  if (state.corrupt) throw circuitError(provider, { reason: "state_corrupt", openUntil: timestamp + DEFAULT_OPEN_MS });
  if (outcome.status !== "error") return publicCircuitSnapshot(state, now);
  const providerState = state.providers[provider] || freshProviderState();
  const errorCode = String(outcome.errorCode || "unknown").slice(0, 80);
  providerState.failures.push({ provider, errorCode, at: timestamp });
  const authFailures = providerState.failures.filter((item) => ["authentication", "rate_limit"].includes(item.errorCode));
  if (authFailures.length >= authFailureLimit) openProvider(providerState, `${authFailures.at(-1).errorCode}:${provider}`, timestamp, openMs);
  else if (providerState.failures.length >= failureLimit) openProvider(providerState, `failures:${provider}`, timestamp, openMs);
  providerState.updatedAt = new Date(timestamp).toISOString();
  state.providers[provider] = providerState;
  await writeState(path, state);
  return publicCircuitSnapshot(state, now);
}

function normalizeState(value, timestamp, windowMs) {
  if (value?.corrupt) return { version: 1, providers: {}, corrupt: true };
  const cutoff = timestamp - windowMs;
  const providers = {};
  for (const [provider, valueState] of Object.entries(value.providers || {})) {
    const providerState = {
      openUntil: Number(valueState.openUntil) || 0,
      reason: String(valueState.reason || "").slice(0, 120),
      attempts: valueState.attempts.filter(validRecord).filter((item) => item.at > cutoff),
      failures: valueState.failures.filter(validRecord).filter((item) => item.at > cutoff),
      updatedAt: typeof valueState.updatedAt === "string" ? valueState.updatedAt : null
    };
    if (providerState.openUntil && providerState.openUntil <= timestamp) providers[provider] = freshProviderState();
    else providers[provider] = providerState;
  }
  return { version: 1, providers };
}

function assertStateUsable(state, provider, timestamp) {
  if (state.corrupt) throw circuitError(provider, { reason: "state_corrupt", openUntil: timestamp + DEFAULT_OPEN_MS });
  const providerState = state.providers[provider];
  if (providerState?.openUntil > timestamp) throw circuitError(provider, providerState);
}

function freshProviderState() {
  return { openUntil: 0, reason: "", attempts: [], failures: [], updatedAt: null };
}

function validRecord(item) {
  return item && PROVIDERS.has(item.provider) && Number.isFinite(item.at)
    && (item.errorCode === undefined || typeof item.errorCode === "string");
}

function validState(value) {
  if (!value || value.version !== 1 || !value.providers || typeof value.providers !== "object" || Array.isArray(value.providers)) return false;
  return Object.entries(value.providers).every(([provider, state]) => PROVIDERS.has(provider)
    && state && typeof state === "object" && !Array.isArray(state)
    && Number.isFinite(state.openUntil) && typeof state.reason === "string"
    && Array.isArray(state.attempts) && state.attempts.every(validRecord)
    && Array.isArray(state.failures) && state.failures.every(validRecord)
    && (state.updatedAt === null || typeof state.updatedAt === "string"));
}

function openProvider(state, reason, timestamp, openMs) {
  state.openUntil = timestamp + openMs;
  state.reason = reason;
  state.updatedAt = new Date(timestamp).toISOString();
}

function circuitError(provider, state) {
  return new ProviderCircuitOpenError({ provider, reason: state.reason || "automatic_guard", openUntil: new Date(state.openUntil).toISOString() });
}

function publicCircuitSnapshot(state, now) {
  const timestamp = new Date(now).getTime();
  if (state?.corrupt) return { open: true, reason: "state_corrupt", openUntil: null, degradedProviders: [{ provider: "all", reason: "state_corrupt", openUntil: null }] };
  const degraded = Object.entries(state?.providers || {})
    .filter(([, value]) => value.openUntil > timestamp)
    .map(([provider, value]) => ({ provider, reason: value.reason || "automatic_guard", openUntil: new Date(value.openUntil).toISOString() }));
  return {
    open: degraded.length > 0,
    reason: degraded.length === 1 ? degraded[0].reason : degraded.length ? "multiple_providers" : null,
    openUntil: degraded.length ? degraded.map((item) => item.openUntil).sort().at(-1) : null,
    degradedProviders: degraded
  };
}

async function readState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return validState(value) ? value : { corrupt: true };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, providers: {} };
    if (error instanceof SyntaxError) return { corrupt: true };
    throw error;
  }
}

async function writeState(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function assertKnownProvider(provider) {
  if (!PROVIDERS.has(provider)) throw new TypeError("Unknown provider circuit");
}
