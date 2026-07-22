import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeploymentPreflight, flyApplicationName, parseEnvironmentFile } from "../server/deployment-preflight.mjs";

const valid = {
  env: { DASHSCOPE_API_KEY: "key", DASHSCOPE_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", QWEN_VISION_MODEL: "qwen3.6-flash", GOOGLE_MAPS_API_KEY: "key", PILOT_ACCESS_CODE: "a-strong-random-access-code", PUBLIC_OPERATOR_NAME: "TabiTabi", PUBLIC_CONTACT_EMAIL: "support@example.com" },
  flyConfig: 'primary_region = "nrt"\n[env]\nPAID_API_EMERGENCY_STOP = "false"\n[mounts]\nsource = "tabitabi_data"\ndestination = "/app/data"\nscheduled_snapshots = true\nsnapshot_retention = 7\n[http_service]\nforce_https = true\nauto_start_machines = true\nauto_stop_machines = "stop"\nmin_machines_running = 0\n[[http_service.checks]]\npath = "/healthz"\n[[vm]]\nsize = "shared-cpu-1x"\nmemory = "512mb"\ncpus = 1',
  dockerfile: `FROM node:22@sha256:${"a".repeat(64)}`,
  releaseGate: { gatePassed: true }
};

test("passes only when production configuration and release evidence are complete", () => {
  assert.equal(evaluateDeploymentPreflight(valid).passed, true);
  const failed = evaluateDeploymentPreflight({ ...valid, env: { ...valid.env, PUBLIC_CONTACT_EMAIL: "" }, releaseGate: { gatePassed: false } });
  assert.deepEqual(failed.missing, ["contactEmail", "releaseEvidence"]);
});

test("requires the reviewed emergency-stop switch in Fly configuration", () => {
  const flyConfig = valid.flyConfig.replace('PAID_API_EMERGENCY_STOP = "false"', 'PAID_API_EMERGENCY_STOP = "true"');
  assert.equal(evaluateDeploymentPreflight({ ...valid, flyConfig }).checks.emergencyStopReady, false);
});

test("rejects lookalike Qwen endpoints, unsafe budgets, and Fly values found only in comments", () => {
  const env = { ...valid.env, DASHSCOPE_BASE_URL: "https://attacker.example/compatible-mode/v1", DAILY_PLACES_SEARCH_LIMIT: "91" };
  const flyConfig = `${valid.flyConfig.replace('auto_start_machines = true', 'auto_start_machines = false')}\n# auto_start_machines = true`;
  const result = evaluateDeploymentPreflight({ ...valid, env, flyConfig });
  assert.equal(result.checks.qwenEndpoint, false);
  assert.equal(result.checks.providerBudgetCaps, false);
  assert.equal(result.checks.flyIdleLifecycle, false);
});

test("fails deployment when model attempt, fallback, or output ceilings are raised", () => {
  for (const override of [
    { DAILY_VISION_REQUEST_LIMIT: "61" },
    { DAILY_QWEN_ATTEMPT_LIMIT: "61" },
    { DAILY_OPENAI_FALLBACK_LIMIT: "11" },
    { DAILY_HOTPEPPER_ATTEMPT_LIMIT: "61" },
    { VISION_MAX_OUTPUT_TOKENS: "1801" }
  ]) {
    const result = evaluateDeploymentPreflight({ ...valid, env: { ...valid.env, ...override } });
    assert.equal(result.checks.providerBudgetCaps, false);
  }
});

test("accepts an Alibaba Model Studio workspace endpoint only on the approved path", () => {
  const workspace = { ...valid.env, DASHSCOPE_BASE_URL: "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" };
  assert.equal(evaluateDeploymentPreflight({ ...valid, env: workspace }).checks.qwenEndpoint, true);
  workspace.DASHSCOPE_BASE_URL = "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/other";
  assert.equal(evaluateDeploymentPreflight({ ...valid, env: workspace }).checks.qwenEndpoint, false);
  workspace.DASHSCOPE_BASE_URL = "https://workspace-id.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
  assert.equal(evaluateDeploymentPreflight({ ...valid, env: workspace }).checks.qwenEndpoint, false);
});

test("parses local environment files without exposing or evaluating values", () => {
  assert.deepEqual(parseEnvironmentFile("A=one\nB='two words'\n# C=no\nBAD-NAME=x\n"), { A: "one", B: "two words" });
  assert.equal(flyApplicationName('app = "tabitabi-jp"\n'), "tabitabi-jp");
  assert.equal(flyApplicationName('app = "../../bad"\n'), "");
});

test("accepts fresh same-app Fly evidence instead of recovering the pilot secret locally", () => {
  const now = Date.parse("2026-07-23T00:00:00Z");
  const env = { ...valid.env, PILOT_ACCESS_CODE: "" };
  const flyConfig = `app = "tabitabi-jp"\n${valid.flyConfig}`;
  const remoteSecretEvidence = { generatedAt: "2026-07-22T23:00:00Z", app: "tabitabi-jp", checks: { requiredSecretsDeployed: true } };
  assert.equal(evaluateDeploymentPreflight({ ...valid, env, flyConfig, remoteSecretEvidence, now }).checks.pilotAccessCode, true);
  assert.equal(evaluateDeploymentPreflight({ ...valid, env, flyConfig, remoteSecretEvidence: { ...remoteSecretEvidence, app: "other" }, now }).checks.pilotAccessCode, false);
  assert.equal(evaluateDeploymentPreflight({ ...valid, env, flyConfig, remoteSecretEvidence: { ...remoteSecretEvidence, generatedAt: "2026-07-20T00:00:00Z" }, now }).checks.pilotAccessCode, false);
});
