import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const run = promisify(execFile);
const app = flyApplicationName(await readFile("fly.toml", "utf8"));
if (!app) throw new Error("fly.toml must contain a valid committed app name");
const remoteCommand = `node --input-type=module -e "import('./server/pilot-report.mjs').then(async({loadPilotReport})=>console.log('TABITABI_REPORT='+JSON.stringify({schemaVersion:1,source:'fly-volume',app:${JSON.stringify(app)},volume:'tabitabi_data',releaseRevision:process.env.RELEASE_REVISION||null,imageRef:process.env.FLY_IMAGE_REF||null,...await loadPilotReport('/app/data/events.jsonl')})))"`;

try {
  const { stdout } = await run("flyctl", ["ssh", "console", "-a", app, "-C", remoteCommand], { timeout: 45_000, maxBuffer: 512 * 1024 });
  const marker = String(stdout).split(/\r?\n/).find((line) => line.startsWith("TABITABI_REPORT="));
  if (!marker) throw new Error("Remote pilot report marker was not returned");
  const report = JSON.parse(marker.slice("TABITABI_REPORT=".length));
  const git = await currentGitState();
  report.auditRevision = git.revision;
  report.repositoryClean = git.clean;
  await mkdir("data/release-evidence", { recursive: true });
  await writeFile("data/release-evidence/latest-remote-pilot.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.gatePassed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ gatePassed: false, error: safeError(error) }, null, 2));
  process.exitCode = 1;
}

function safeError(error) {
  const message = `${String(error?.message || "Remote pilot audit failed")} ${String(error?.stderr || "")}`;
  if (/not logged in|unauthorized|authentication/i.test(message)) return "Fly CLI login is missing or expired.";
  if (/timed out|timeout/i.test(message)) return "Remote pilot audit timed out; retry without changing resources.";
  if (/Machine .* is not started|could not find a running machine/i.test(message)) return "The Fly Machine is stopped; run the provider-free smoke first, then retry.";
  return "Remote pilot audit failed; inspect Fly SSH status without printing event records or Secrets.";
}
