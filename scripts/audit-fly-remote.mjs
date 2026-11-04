import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { evaluateFlyRemoteState, parseFlyChecksJson, parseFlyJson } from "../server/fly-remote-audit.mjs";
import { classifyFlyCliError, createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { invalidateReleaseEvidence, writeReleaseEvidence } from "../server/release-evidence-store.mjs";
import { currentGitState } from "../server/release-revision.mjs";
import { probeFlySecretMetadata } from "./fly-secret-access-diagnostic.mjs";

const run = promisify(execFile);
let stage = "configuration";
let app;

try {
  app = flyApplicationName(await readFile("fly.toml", "utf8"));
  if (!app) throw new Error("fly.toml must contain a valid committed app name");
  await invalidateReleaseEvidence("data/release-evidence/latest-fly.json");
  const runtime = await createFlyCliRuntime();
  let machineResult;
  let volumeResult;
  let checkResult;
  let secretResult;
  let releaseResult;
  try {
    stage = "machines";
    machineResult = await flyJson(["machine", "list", "-a", app, "--json"], runtime.env);
    stage = "volumes";
    volumeResult = await flyJson(["volumes", "list", "-a", app, "--json"], runtime.env);
    stage = "checks";
    checkResult = await flyChecksJson(["checks", "list", "-a", app, "--json"], runtime.env);
    stage = "secrets";
    secretResult = await flyJson(["secrets", "list", "-a", app, "--json"], runtime.env);
    stage = "releases";
    releaseResult = await flyJson(["releases", "-a", app, "--json"], runtime.env);
  } finally {
    await runtime.cleanup();
  }
  const result = evaluateFlyRemoteState({ machines: machineResult, volumes: volumeResult, checks: checkResult, secrets: secretResult, releases: releaseResult });
  const git = await currentGitState();
  const report = { generatedAt: new Date().toISOString(), app, revision: git.revision, repositoryClean: git.clean, ...result };
  await writeReleaseEvidence("data/release-evidence/latest-fly.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  const report = { generatedAt: new Date().toISOString(), passed: false, stage,
    errorCategory: classifyFlyCliError(error).category,
    cliExitCode: Number.isInteger(error?.code) ? error.code : null, error: safeMessage(error) };
  if (stage === "secrets") report.metadataAccess = await probeFlySecretMetadata({ app });
  await writeReleaseEvidence("data/release-evidence/latest-fly.json", report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
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
