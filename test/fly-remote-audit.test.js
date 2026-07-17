import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFlyRemoteState, parseFlyChecksJson, parseFlyJson, REQUIRED_FLY_SECRETS } from "../server/fly-remote-audit.mjs";

const valid = {
  machines: [{ id: "machine-1", state: "started", region: "nrt", image_ref: { tag: "deployment-TEST", digest: `sha256:${"b".repeat(64)}` }, config: { guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 }, mounts: [{ volume: "volume-1", path: "/app/data" }], services: [{ internal_port: 4173, checks: [{ path: "/healthz" }], autostart: true, autostop: true, min_machines_running: 0 }] } }],
  volumes: [{ id: "volume-1", state: "created", attached_machine_id: "machine-1", name: "tabitabi_data", region: "nrt", size_gb: 1, encrypted: true, snapshot_retention: 7, auto_backup_enabled: true }],
  checks: [{ machineId: "machine-1", name: "http_service", status: "passing" }],
  secrets: REQUIRED_FLY_SECRETS.map((name) => ({ name, status: "Deployed" })),
  releases: [{ Status: "complete", Version: 5, CreatedAt: "2026-07-18T10:00:00.000Z", ImageRef: "registry.fly.io/tabitabi-jp:deployment-TEST" }]
};

test("accepts exactly one healthy Tokyo machine and one 1 GB Tokyo volume", () => {
  assert.equal(evaluateFlyRemoteState(valid).passed, true);
});

test("rejects extra machines, wrong volume shape, or missing health checks", () => {
  const result = evaluateFlyRemoteState({
    machines: [...valid.machines, structuredClone(valid.machines[0])],
    volumes: [{ ...valid.volumes[0], size_gb: 2 }],
    checks: []
  });
  assert.equal(result.passed, false);
  assert.ok(result.missing.includes("exactlyOneMachine"));
  assert.ok(result.missing.includes("volumeSize"));
  assert.ok(result.missing.includes("healthChecksPresent"));
});

test("fails closed for stopped machines, unattached volumes, warnings, and missing CPU kind", () => {
  for (const changed of [
    { machines: [{ ...valid.machines[0], state: "stopped" }] },
    { volumes: [{ ...valid.volumes[0], attached_machine_id: null }] },
    { volumes: [{ ...valid.volumes[0], snapshot_retention: 5 }] },
    { volumes: [{ ...valid.volumes[0], encrypted: false }] },
    { secrets: valid.secrets.slice(1) },
    { secrets: valid.secrets.map((item, index) => index === 0 ? { ...item, status: "Staged" } : item) },
    { machines: withService({ autostart: false }) },
    { machines: withService({ autostop: false }) },
    { machines: withService({ min_machines_running: 1 }) },
    { machines: withService({ internal_port: 9999 }) },
    { checks: [...valid.checks, { machineId: "machine-1", name: "secondary", status: "warning" }] },
    { machines: [{ ...valid.machines[0], config: { ...valid.machines[0].config, guest: { cpus: 1, memory_mb: 512 } } }] }
  ]) assert.equal(evaluateFlyRemoteState({ ...valid, ...changed }).passed, false);
});

function withService(overrides) {
  const machine = structuredClone(valid.machines[0]);
  machine.config.services[0] = { ...machine.config.services[0], ...overrides };
  return [machine];
}

test("requires Fly JSON commands to return arrays", () => {
  assert.deepEqual(parseFlyJson("[]", "machines"), []);
  assert.throws(() => parseFlyJson("{}", "machines"), /JSON array/);
  assert.throws(() => parseFlyJson("not-json", "machines"), /valid JSON/);
});

test("normalizes the current checks map shape and preserves Machine ownership", () => {
  assert.deepEqual(parseFlyChecksJson(JSON.stringify({
    "machine-1": [{ name: "http_service", status: "passing" }]
  })), [{ machineId: "machine-1", name: "http_service", status: "passing" }]);
  assert.throws(() => parseFlyChecksJson("[]"), /checks map/);
});

test("selects the newest complete release when the same image tag appears more than once", () => {
  const releases = [
    { Status: "complete", Version: 5, CreatedAt: "2026-07-18T09:00:00.000Z", ImageRef: "registry.fly.io/tabitabi-jp:deployment-TEST" },
    { Status: "complete", Version: 7, CreatedAt: "2026-07-18T11:00:00.000Z", ImageRef: "registry.fly.io/tabitabi-jp:deployment-TEST" }
  ];
  const result = evaluateFlyRemoteState({ ...valid, releases });
  assert.equal(result.deployment.releaseVersion, 7);
  assert.equal(result.deployment.releaseCreatedAt, "2026-07-18T11:00:00.000Z");
});
