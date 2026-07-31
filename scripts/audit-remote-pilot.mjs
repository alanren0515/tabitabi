import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { currentGitState } from "../server/release-revision.mjs";
import { invalidateReleaseEvidence, writeReleaseEvidence } from "../server/release-evidence-store.mjs";
import { buildRemotePilotFailureEvidence } from "../server/remote-pilot-audit.mjs";

const run = promisify(execFile);
const app = flyApplicationName(await readFile("fly.toml", "utf8"));
if (!app) throw new Error("fly.toml must contain a valid committed app name");
const remoteCommand = "node /app/server/remote-pilot-report.mjs";
const git = await currentGitState();

try {
  await invalidateReleaseEvidence("data/release-evidence/latest-remote-pilot.json");
  const runtime = await createFlyCliRuntime();
  let stdout;
  try {
    ({ stdout } = await run("flyctl", ["ssh", "console", "-a", app, "-C", remoteCommand], { env: runtime.env, timeout: 45_000, maxBuffer: 512 * 1024 }));
  } finally {
    await runtime.cleanup();
  }
  const marker = String(stdout).split(/\r?\n/).find((line) => line.startsWith("TABITABI_REPORT="));
  if (!marker) throw new Error("Remote pilot report marker was not returned");
  const report = JSON.parse(marker.slice("TABITABI_REPORT=".length));
  report.auditRevision = git.revision;
  report.repositoryClean = git.clean;
  await writeReleaseEvidence("data/release-evidence/latest-remote-pilot.json", report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.gatePassed) process.exitCode = 1;
} catch (error) {
  const report = buildRemotePilotFailureEvidence({ app, revision: git.revision, repositoryClean: git.clean, error });
  await writeReleaseEvidence("data/release-evidence/latest-remote-pilot.json", report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
