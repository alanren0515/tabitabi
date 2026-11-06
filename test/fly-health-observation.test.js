import test from "node:test";
import assert from "node:assert/strict";
import { observeFlyHealthTransition } from "../server/fly-health-observation.mjs";
import { evaluateFlyRemoteState, REQUIRED_FLY_SECRETS } from "../server/fly-remote-audit.mjs";

const AT = Date.UTC(2026, 10, 6, 5);

function fixture() {
  return {
    machines: [{ id: "machine-1", state: "started", region: "nrt", image_ref: { tag: "deployment-TEST", digest: `sha256:${"b".repeat(64)}` },
      events: [{ type: "cordon", status: "started", timestamp: AT - 5_000 }, { type: "start", status: "started", timestamp: AT - 10_000 }],
      config: { guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 }, mounts: [{ volume: "volume-1", path: "/app/data" }],
        services: [{ internal_port: 4173, checks: [{ path: "/healthz" }], autostart: true, autostop: true, min_machines_running: 0 }] } }],
    volumes: [{ id: "volume-1", state: "created", attached_machine_id: "machine-1", name: "tabitabi_data", region: "nrt", size_gb: 1, encrypted: true, snapshot_retention: 7, auto_backup_enabled: true }],
    checks: [{ machineId: "machine-1", name: "http_service", status: "warning" }],
    secrets: REQUIRED_FLY_SECRETS.map((name) => ({ name, status: "Deployed" })),
    releases: [{ Status: "complete", Version: 5, CreatedAt: "2026-07-18T10:00:00.000Z", ImageRef: "registry.fly.io/tabitabi-jp:deployment-TEST" }]
  };
}

function scenario({ state = fixture(), freshMachines, freshChecks, deadline = AT + 170_000, machineDuration = 0, checkDuration = 0, sleepOvershoot = 0, machineError, checkError } = {}) {
  const calls = { machines: 0, checks: 0, sleeps: [] };
  const clock = { at: AT };
  const options = {
    state, deadline, now: () => clock.at,
    sleep: async (ms) => { calls.sleeps.push(ms); clock.at += ms + sleepOvershoot; },
    readMachines: async () => {
      calls.machines++; clock.at += machineDuration;
      if (machineError) throw machineError;
      return freshMachines ?? structuredClone(state.machines);
    },
    readChecks: async () => {
      calls.checks++; clock.at += checkDuration;
      if (checkError) throw checkError;
      return freshChecks ?? state.checks.map((check) => ({ ...check, status: "passing" }));
    }
  };
  return { state, calls, clock, run: () => observeFlyHealthTransition(options) };
}

function noReads(calls) {
  assert.deepEqual(calls, { machines: 0, checks: 0, sleeps: [] });
}

test("healthy audits and failures beyond health do not wait or read", async () => {
  const healthy = fixture();
  healthy.checks[0].status = "passing";
  const good = scenario({ state: healthy });
  const result = await good.run();
  assert.equal(result.evidence.reason, "already_healthy");
  assert.equal(result.evidence.attempted, false);
  assert.equal(result.state, healthy);
  noReads(good.calls);

  for (const mutate of [
    (state) => { state.secrets.pop(); },
    (state) => { state.machines[0].state = "stopped"; },
    (state) => { state.machines.push(structuredClone(state.machines[0])); },
    (state) => { state.checks = []; }
  ]) {
    const state = fixture(); mutate(state);
    const run = scenario({ state });
    assert.equal((await run.run()).evidence.reason, "other_gates_failed");
    noReads(run.calls);
  }
});

test("a recent cordon waits until event plus 50 seconds and observes once", async () => {
  const run = scenario();
  const result = await run.run();
  assert.deepEqual(run.calls, { machines: 1, checks: 1, sleeps: [45_000] });
  assert.equal(result.evidence.attempted, true);
  assert.equal(result.evidence.accepted, true);
  assert.equal(result.evidence.reason, "observed_healthy");
  assert.deepEqual(result.evidence.trigger, { type: "cordon", timestamp: AT - 5_000 });
  assert.deepEqual(result.evidence.initial, { machineState: "started", checkCount: 1, checkStatuses: ["warning"] });
  assert.deepEqual(result.evidence.final, { machineState: "started", checkCount: 1, checkStatuses: ["passing"] });
  assert.deepEqual(result.evidence.observedAt, { initial: AT, machines: AT + 45_000, checks: AT + 45_000 });
  assert.equal(evaluateFlyRemoteState(result.state).passed, true);
  assert.equal(run.state.checks[0].status, "warning");
});

test("a recent event already past plus 50 seconds observes immediately", async () => {
  for (const type of ["start", "cordon", "uncordon"]) {
    const state = fixture();
    state.machines[0].events = [{ type, timestamp: AT - 55_000 }];
    const run = scenario({ state });
    const result = await run.run();
    assert.deepEqual(run.calls, { machines: 1, checks: 1, sleeps: [] });
    assert.equal(result.evidence.waitMs, 0);
    assert.equal(result.evidence.accepted, true);
    assert.equal(result.evidence.trigger.type, type);
  }
});

test("insufficient read budget never starts waiting or refreshes", async () => {
  const run = scenario({ deadline: AT + 45_000 + 65_000 - 1 });
  const result = await run.run();
  assert.equal(result.state, run.state);
  assert.equal(result.evidence.reason, "budget_insufficient");
  assert.equal(result.evidence.attempted, false);
  noReads(run.calls);
  const exact = scenario({ deadline: AT + 45_000 + 65_000 });
  assert.equal((await exact.run()).evidence.accepted, true);
});

test("missing, old, future, unsupported, and seconds-based events never authorize observation", async () => {
  for (const events of [
    undefined, [], [{ type: "cordon", timestamp: AT - 60_001 }],
    [{ type: "uncordon", timestamp: AT + 1 }], [{ type: "update", timestamp: AT }],
    [{ type: "start", timestamp: Math.floor(AT / 1000) }], [{ type: "start", timestamp: String(AT) }]
  ]) {
    const state = fixture(); state.machines[0].events = events;
    const run = scenario({ state });
    const result = await run.run();
    assert.equal(result.state, state);
    assert.equal(result.evidence.reason, "recent_event_missing");
    noReads(run.calls);
  }
});

test("expired or invalid deadlines keep the initial failure without waiting", async () => {
  for (const deadline of [AT, AT - 1, NaN, undefined]) {
    const run = scenario({ deadline });
    // Undefined is the scenario's useful default, so supply it directly here.
    const result = deadline === undefined
      ? await observeFlyHealthTransition({ state: run.state, deadline, now: () => AT }) : await run.run();
    assert.equal(result.state, run.state);
    assert.equal(result.evidence.reason, Number.isFinite(deadline) ? "deadline_expired" : "deadline_invalid");
    noReads(run.calls);
  }
});

test("persistent critical checks remain failing after the single observation", async () => {
  const run = scenario({ freshChecks: [{ machineId: "machine-1", name: "http_service", status: "critical" }] });
  const result = await run.run();
  assert.equal(result.evidence.attempted, true);
  assert.equal(result.evidence.accepted, false);
  assert.equal(result.evidence.reason, "health_checks_not_passing");
  assert.equal(evaluateFlyRemoteState(result.state).passed, false);
  assert.equal(result.state.checks[0].status, "critical");
  assert.deepEqual(run.calls, { machines: 1, checks: 1, sleeps: [45_000] });
});

test("Machine and image identity drift reject fresh passing evidence", async () => {
  for (const mutate of [
    (machines) => { machines[0].id = "machine-2"; },
    (machines) => { machines[0].image_ref.digest = `sha256:${"c".repeat(64)}`; },
    (machines) => { machines[0].image_ref.tag = "deployment-OTHER"; },
    (machines) => { delete machines[0].image_ref.digest; },
    (machines) => { machines.push(structuredClone(machines[0])); },
    (machines) => { machines.splice(0); }
  ]) {
    const freshMachines = fixture().machines; mutate(freshMachines);
    const run = scenario({ freshMachines });
    const result = await run.run();
    assert.equal(result.state, run.state);
    assert.equal(result.evidence.reason, "machine_identity_changed");
    assert.equal(result.evidence.accepted, false);
    assert.equal(run.calls.machines, 1);
    assert.equal(run.calls.checks, 1);
  }
});

test("missing initial image or check identity prevents any observation", async () => {
  for (const mutate of [
    (state) => { delete state.machines[0].image_ref.digest; },
    (state) => { delete state.machines[0].image_ref.tag; },
    (state) => { state.checks[0].name = ""; },
    (state) => { state.checks.push({ ...state.checks[0] }); }
  ]) {
    const state = fixture(); mutate(state);
    const run = scenario({ state });
    const result = await run.run();
    assert.equal(result.state, state);
    assert.equal(result.evidence.accepted, false);
    noReads(run.calls);
  }
});

test("missing, renamed, foreign, blank, or duplicate refreshed checks are rejected", async () => {
  const passing = { machineId: "machine-1", name: "http_service", status: "passing" };
  for (const freshChecks of [
    [], [{ ...passing, name: "other" }], [{ ...passing, machineId: "machine-2" }],
    [{ ...passing, name: " " }], [{ ...passing, machineId: "" }], [passing, { ...passing }], [null]
  ]) {
    const run = scenario({ freshChecks });
    const result = await run.run();
    assert.equal(result.state, run.state);
    assert.equal(result.evidence.reason, "check_set_changed");
    assert.equal(result.evidence.accepted, false);
    assert.equal(run.calls.machines, 1);
    assert.equal(run.calls.checks, 1);
  }
});

test("check ordering and supported identity aliases do not change the check set", async () => {
  const state = fixture();
  state.checks.push({ machine_id: "machine-1", name: "secondary", status: "critical" });
  const run = scenario({ state, freshChecks: [
    { machineId: "machine-1", name: "secondary", status: "pass" },
    { machine_id: "machine-1", name: "http_service", status: "passing" }
  ] });
  const result = await run.run();
  assert.equal(result.evidence.accepted, true);
  assert.equal(evaluateFlyRemoteState(result.state).passed, true);
});

test("fresh observations still evaluate every resource gate", async () => {
  const freshMachines = fixture().machines;
  freshMachines[0].region = "iad";
  const run = scenario({ freshMachines });
  const result = await run.run();
  assert.equal(result.evidence.accepted, false);
  assert.equal(result.evidence.reason, "other_gates_failed");
  assert.equal(result.state, run.state);
  assert.equal(evaluateFlyRemoteState(result.state).passed, false);
});

test("oversleep or slow readers cannot consume the reserved remaining read budget", async () => {
  const overslept = scenario({ deadline: AT + 110_000, sleepOvershoot: 1 });
  const first = await overslept.run();
  assert.equal(first.state, overslept.state);
  assert.equal(first.evidence.reason, "budget_insufficient");
  assert.equal(overslept.calls.machines, 0);
  const slowMachine = scenario({ deadline: AT + 110_000, machineDuration: 30_001 });
  assert.equal((await slowMachine.run()).evidence.reason, "budget_insufficient");
  assert.equal(slowMachine.calls.machines, 1);
  assert.equal(slowMachine.calls.checks, 0);
  const slowChecks = scenario({ deadline: AT + 110_000, machineDuration: 30_000, checkDuration: 30_001 });
  const last = await slowChecks.run();
  assert.equal(last.state, slowChecks.state);
  assert.equal(last.evidence.reason, "deadline_expired");
  assert.equal(last.evidence.accepted, false);
});

test("reader errors propagate once without retries", async () => {
  const machineError = new Error("synthetic private provider content");
  const machines = scenario({ machineError });
  await assert.rejects(machines.run, (error) => error === machineError);
  assert.equal(machines.calls.machines, 1);
  assert.equal(machines.calls.checks, 0);
  const checkError = new Error("synthetic private provider content");
  const checks = scenario({ checkError });
  await assert.rejects(checks.run, (error) => error === checkError);
  assert.equal(checks.calls.machines, 1);
  assert.equal(checks.calls.checks, 1);
});

test("observation evidence contains only bounded known statuses and fixed reasons", async () => {
  const state = fixture();
  state.checks[0].status = "synthetic-private-provider-output";
  state.machines[0].events[0].request = { private: "synthetic-private-provider-output" };
  const run = scenario({ state, freshChecks: [{ machineId: "machine-1", name: "http_service", status: "another-private-output" }] });
  const result = await run.run();
  assert.deepEqual(result.evidence.initial.checkStatuses, ["unknown"]);
  assert.deepEqual(result.evidence.final.checkStatuses, ["unknown"]);
  assert.doesNotMatch(JSON.stringify(result.evidence), /synthetic-private-provider-output|another-private-output|machine-1|http_service|sha256/);
  assert.equal(result.evidence.accepted, false);
});
