import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { evaluateFlyRemoteState, parseFlyChecksJson, parseFlyJson } from "../server/fly-remote-audit.mjs";

const run = promisify(execFile);

try {
  const app = flyApplicationName(await readFile("fly.toml", "utf8"));
  if (!app) throw new Error("fly.toml must contain a valid committed app name");
  const [machineResult, volumeResult, checkResult] = await Promise.all([
    flyJson(["machine", "list", "-a", app, "--json"]),
    flyJson(["volumes", "list", "-a", app, "--json"]),
    flyChecksJson(["checks", "list", "-a", app, "--json"])
  ]);
  const result = evaluateFlyRemoteState({ machines: machineResult, volumes: volumeResult, checks: checkResult });
  console.log(JSON.stringify({ app, ...result }, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: safeMessage(error) }, null, 2));
  process.exitCode = 1;
}

async function flyJson(args) {
  const label = `flyctl ${args[0]} ${args[1]}`;
  const { stdout } = await run("flyctl", args, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return parseFlyJson(stdout, label);
}

async function flyChecksJson(args) {
  const { stdout } = await run("flyctl", args, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return parseFlyChecksJson(stdout);
}

export function safeMessage(error) {
  const message = `${String(error?.message || "Fly remote audit failed")} ${String(error?.stderr || "")}`;
  if (error?.code === "ENOENT") return "flyctl is not installed or is not on PATH.";
  if (/operation not permitted|permission denied/i.test(message)) return "Fly CLI cannot read its local config directory; verify local permissions without changing cloud resources.";
  if (/could not find app|failed to get app/i.test(message)) return "Fly app does not exist yet. Create it only after cost authorization.";
  if (/not logged in|unauthorized|authentication/i.test(message)) return "Fly CLI login is missing or expired.";
  if (/valid JSON|JSON array|checks map/i.test(message)) return "Fly CLI JSON shape is unsupported; check flyctl version and update the audit parser before trusting results.";
  if (/timed out|timeout/i.test(message)) return "Fly remote audit timed out; retry without changing resources.";
  return "Fly remote audit failed; inspect flyctl status without pasting secrets into chat.";
}
