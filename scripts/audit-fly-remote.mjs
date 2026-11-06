import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { evaluateFlyRemoteState, parseFlyChecksJson, parseFlyJson } from "../server/fly-remote-audit.mjs";
import { classifyFlyCliError, createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { invalidateReleaseEvidence, writeReleaseEvidence } from "../server/release-evidence-store.mjs";
import { currentGitState } from "../server/release-revision.mjs";
import { probeFlySecretMetadata, safeDiagnosticTerms } from "./fly-secret-access-diagnostic.mjs";
import { observeFlyHealthTransition } from "../server/fly-health-observation.mjs";

const run = promisify(execFile);
const { FLY_SECRET_METADATA_TOKEN: configuredMetadataToken, ...defaultFlyEnv } = process.env;
const metadataToken = String(configuredMetadataToken || "").trim();
const auditDeadline = Date.now() + 170_000;
let stage = "configuration";
let app;
const remoteState = {};
const collection = {};
let healthObservation;

try {
  app = flyApplicationName(await readFile("fly.toml", "utf8"));
  if (!app) throw new Error("fly.toml must contain a valid committed app name");
  await invalidateReleaseEvidence("data/release-evidence/latest-fly.json");
  const runtime = await createFlyCliRuntime({ env: defaultFlyEnv });
  try {
    const requests = [
      ["machines", (env) => flyJson(["machine", "list", "-a", app, "--json"], env)],
      ["volumes", (env) => flyJson(["volumes", "list", "-a", app, "--json"], env)],
      ["checks", (env) => flyChecksJson(["checks", "list", "-a", app, "--json"], env)],
      ["secrets", (env) => flyJson(["secrets", "list", "-a", app, "--json"], env)],
      ["releases", (env) => flyJson(["releases", "-a", app, "--json"], env)]
    ];
    // Each metadata command is independent; one denied request must not hide
    // later evidence. Never retry or replace a failed response with other data.
    for (const [name, request] of requests) {
      stage = name;
      await collectSource(name, request, runtime.env);
    }
    if (Object.values(collection).every((item) => item.status === "succeeded")) {
      stage = "evaluation";
      evaluateCollectedState();
      stage = "health_observation";
      const observed = await observeFlyHealthTransition({
        state: remoteState, deadline: auditDeadline,
        readMachines: () => {
          stage = "health_machine_refresh";
          return flyJson(["machine", "list", "-a", app, "--json"], runtime.env);
        },
        readChecks: () => {
          stage = "health_checks_refresh";
          return flyChecksJson(["checks", "list", "-a", app, "--json"], runtime.env);
        }
      });
      Object.assign(remoteState, observed.state);
      healthObservation = observed.evidence;
    }
  } finally {
    try { await runtime.cleanup(); }
    catch (error) { stage = "cleanup"; throw error; }
  }
  stage = "evaluation";
  const result = evaluateCollectedState();
  const firstFailure = Object.values(collection).find((item) => item.status === "failed");
  const { status: ignoredStatus, ...failure } = firstFailure || {};
  stage = "revision";
  const git = await currentGitState();
  const report = { generatedAt: new Date().toISOString(), app, revision: git.revision, repositoryClean: git.clean, ...result, ...failure, healthObservation };
  stage = "evidence";
  await writeReleaseEvidence("data/release-evidence/latest-fly.json", report);
  if (firstFailure) console.error(JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  let result;
  try { result = evaluateCollectedState(); }
  catch { result = { collectionComplete: false, collection }; }
  const report = { generatedAt: new Date().toISOString(), app, ...result, passed: false, ...await boundedFailure(stage, error), healthObservation };
  await writeReleaseEvidence("data/release-evidence/latest-fly.json", report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

async function collectSource(name, request, defaultEnv) {
  let scopedRuntime;
  let env = defaultEnv;
  let value;
  let failure;
  try {
    if (name === "secrets" && metadataToken) {
      // An explicit metadata credential never falls back to another login.
      // Supplying FLY_API_TOKEN keeps this isolated runtime's config empty.
      env = { ...defaultFlyEnv, FLY_API_TOKEN: metadataToken };
      delete env.FLY_ACCESS_TOKEN;
      scopedRuntime = await createFlyCliRuntime({ env });
      env = scopedRuntime.env;
    }
    value = await request(env);
  } catch (error) {
    failure = await boundedFailure(name, error, env);
  } finally {
    try { await scopedRuntime?.cleanup(); }
    catch (error) {
      const cleanupFailure = await boundedFailure("cleanup", error, env);
      failure = failure ? { ...failure, cleanupFailure } : cleanupFailure;
    }
  }
  if (failure) collection[name] = { status: "failed", ...failure };
  else {
    remoteState[name] = value;
    collection[name] = { status: "succeeded" };
  }
}

function evaluateCollectedState() {
  // Missing sources stay absent, so the evaluator's defaults fail their checks.
  // Releases have no readiness check of their own: incomplete collection must
  // independently keep the overall audit failing even if every check is true.
  const result = evaluateFlyRemoteState(remoteState);
  const collectionComplete = Object.keys(collection).length === 5
    && Object.values(collection).every((item) => item.status === "succeeded");
  return { ...result, passed: result.passed && collectionComplete, collectionComplete, collection };
}

async function boundedFailure(failedStage, error, env = defaultFlyEnv) {
  const failure = { stage: failedStage,
    errorCategory: classifyFlyCliError(error).category,
    cliExitCode: Number.isInteger(error?.code) ? error.code : null,
    cliFailureTerms: safeDiagnosticTerms(error?.stderr || error?.message), error: safeMessage(error) };
  if (failedStage === "secrets") {
    failure.metadataAccess = await probeFlySecretMetadata({ app, env });
    if (failure.metadataAccess.access === "denied") {
      failure.errorCategory = "secretMetadataAccessDenied";
      failure.error = "Fly rejected Secret metadata access for the scoped monitoring credential. Keep the deployed-secret check failing until the approved access scope is supported.";
    }
  }
  return failure;
}

async function flyJson(args, env) {
  const label = `flyctl ${args[0]} ${args[1]}`;
  const { stdout } = await run("flyctl", args, { env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return parseFlyJson(stdout, label);
}

async function flyChecksJson(args, env) {
  const { stdout } = await run("flyctl", args, { env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return parseFlyChecksJson(stdout);
}

export function safeMessage(error) {
  return classifyFlyCliError(error).message;
}
