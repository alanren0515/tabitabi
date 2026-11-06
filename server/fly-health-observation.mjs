import { setTimeout as sleepTimer } from "node:timers/promises";
import { evaluateFlyRemoteState } from "./fly-remote-audit.mjs";

const EVENT_TYPES = new Set(["start", "cordon", "uncordon"]);
const CHECK_STATUSES = new Set(["passing", "pass", "warning", "critical"]);
const MACHINE_STATES = new Set(["created", "starting", "started", "stopping", "stopped", "replacing", "destroying", "destroyed", "suspending", "suspended"]);
const RECENT_EVENT_MS = 60_000;
const EVENT_SETTLE_MS = 50_000;
const READ_BUDGET_MS = 30_000;
const FINISH_MARGIN_MS = 5_000;

// This is a single bounded observation, never a retry loop. Callers retain
// responsibility for each reader's 30-second timeout and sanitized failures.
export async function observeFlyHealthTransition({ state, deadline, readMachines, readChecks, now = Date.now, sleep = sleepTimer }) {
  const initialAt = now();
  const evidence = {
    attempted: false, reason: "other_gates_failed", trigger: null, waitMs: 0,
    initial: safeSnapshot(state), final: null,
    observedAt: { initial: safeTime(initialAt), machines: null, checks: null }, accepted: false
  };
  const unchanged = (reason) => ({ state, evidence: { ...evidence, reason } });
  const initial = evaluateFlyRemoteState(state);
  if (initial.passed) return unchanged("already_healthy");
  if (!onlyHealthFailed(initial)) return unchanged("other_gates_failed");
  if (!Number.isFinite(initialAt)) return unchanged("clock_invalid");

  const identity = machineIdentity(state.machines);
  if (!identity) return unchanged("machine_identity_missing");
  const originalChecks = checkIdentities(state.checks);
  if (!originalChecks) return unchanged("check_set_invalid");
  const event = recentEvent(state.machines[0].events, initialAt);
  if (!event) return unchanged("recent_event_missing");
  evidence.trigger = event;
  if (!Number.isFinite(deadline)) return unchanged("deadline_invalid");
  if (initialAt >= deadline) return unchanged("deadline_expired");
  const waitMs = Math.max(0, event.timestamp + EVENT_SETTLE_MS - initialAt);
  if (initialAt + waitMs + 2 * READ_BUDGET_MS + FINISH_MARGIN_MS > deadline) return unchanged("budget_insufficient");

  evidence.attempted = true;
  evidence.waitMs = waitMs;
  if (waitMs > 0) await sleep(waitMs);
  if (!hasBudget(now(), deadline, 2 * READ_BUDGET_MS)) return unchanged("budget_insufficient");
  const machines = await readMachines();
  evidence.observedAt.machines = safeTime(now());
  if (!hasBudget(now(), deadline, READ_BUDGET_MS)) return unchanged("budget_insufficient");
  const checks = await readChecks();
  evidence.observedAt.checks = safeTime(now());
  const fresh = { ...state, machines, checks };
  evidence.final = safeSnapshot(fresh);
  if (!hasBudget(now(), deadline, 0)) return unchanged("deadline_expired");
  const freshIdentity = machineIdentity(machines);
  if (!freshIdentity || !sameIdentity(identity, freshIdentity)) return unchanged("machine_identity_changed");
  const freshChecks = checkIdentities(checks);
  if (!freshChecks || !sameChecks(originalChecks, freshChecks)) return unchanged("check_set_changed");

  const result = evaluateFlyRemoteState(fresh);
  evidence.accepted = result.passed;
  evidence.reason = result.passed ? "observed_healthy" : onlyHealthFailed(result) ? "health_checks_not_passing" : "other_gates_failed";
  if (!result.passed && !onlyHealthFailed(result)) return unchanged("other_gates_failed");
  return { state: fresh, evidence };
}

function onlyHealthFailed(result) {
  return result.missing.length === 1 && result.missing[0] === "healthChecksPassing";
}

function hasBudget(at, deadline, readBudget) {
  return Number.isFinite(at) && at + readBudget + FINISH_MARGIN_MS <= deadline;
}

function machineIdentity(machines) {
  if (!Array.isArray(machines) || machines.length !== 1) return null;
  const machine = machines[0];
  const id = machine?.id;
  const digest = machine?.image_ref?.digest ?? machine?.imageRef?.digest;
  const tag = machine?.image_ref?.tag ?? machine?.imageRef?.tag;
  if (![id, digest, tag].every((value) => typeof value === "string" && value.trim().length > 0)) return null;
  return { id, digest, tag };
}

function sameIdentity(left, right) {
  return left.id === right.id && left.digest === right.digest && left.tag === right.tag;
}

function checkIdentities(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  const identities = checks.map((check) => {
    const machineId = check?.machineId ?? check?.machine_id;
    const name = check?.name;
    return [machineId, name].every((value) => typeof value === "string" && value.trim().length > 0)
      ? JSON.stringify([machineId, name]) : null;
  });
  if (identities.includes(null) || new Set(identities).size !== identities.length) return null;
  return identities.sort();
}

function sameChecks(left, right) {
  return left.length === right.length && left.every((identity, index) => identity === right[index]);
}

function recentEvent(events, at) {
  if (!Array.isArray(events)) return null;
  let latest = null;
  for (const event of events) {
    const type = typeof event?.type === "string" ? event.type.toLowerCase() : "";
    const timestamp = event?.timestamp;
    // Fly's Machine events use epoch milliseconds; reject seconds, strings,
    // future events, and unreasonable ranges rather than guessing their units.
    if (!EVENT_TYPES.has(type) || !Number.isSafeInteger(timestamp)
      || timestamp < Date.UTC(2000, 0, 1) || timestamp >= Date.UTC(2100, 0, 1)
      || timestamp > at || at - timestamp > RECENT_EVENT_MS) continue;
    if (!latest || timestamp > latest.timestamp) latest = { type, timestamp };
  }
  return latest;
}

function safeSnapshot(state) {
  const machine = Array.isArray(state?.machines) ? state.machines[0] : null;
  const checks = Array.isArray(state?.checks) ? state.checks : [];
  return {
    machineState: safeStatus(machine?.state, MACHINE_STATES),
    checkCount: checks.length,
    checkStatuses: checks.slice(0, 32).map((check) => safeStatus(check?.status, CHECK_STATUSES)).sort()
  };
}

function safeStatus(value, known) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return known.has(normalized) ? normalized : "unknown";
}

function safeTime(value) {
  return Number.isFinite(value) ? value : null;
}
