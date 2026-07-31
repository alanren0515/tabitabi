import { chmod, copyFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export async function createFlyCliRuntime({
  env = process.env,
  home = homedir(),
  tempRoot = tmpdir(),
  mkdtempImpl = mkdtemp,
  copyFileImpl = copyFile,
  chmodImpl = chmod,
  rmImpl = rm,
  readdirImpl = readdir,
  statImpl = stat,
  now = Date.now()
} = {}) {
  await pruneStaleFlyCliRuntimes({ tempRoot, readdirImpl, statImpl, rmImpl, now });
  const directory = await mkdtempImpl(join(tempRoot, "tabitabi-flyctl-"));
  await chmodImpl(directory, 0o700);
  const sourceDirectory = String(env.FLY_CONFIG_DIR || join(home, ".fly"));
  if (!env.FLY_API_TOKEN) {
    try {
      const target = join(directory, "config.yml");
      await copyFileImpl(join(sourceDirectory, "config.yml"), target);
      await chmodImpl(target, 0o600);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        try {
          await rmImpl(directory, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Fly CLI configuration failed and its private temporary directory could not be removed");
        }
        throw error;
      }
    }
  }
  let cleaned = false;
  return {
    env: { ...env, FLY_CONFIG_DIR: directory },
    async cleanup() {
      if (cleaned) return;
      await rmImpl(directory, { recursive: true, force: true });
      cleaned = true;
    }
  };
}

export async function pruneStaleFlyCliRuntimes({ tempRoot = tmpdir(), readdirImpl = readdir, statImpl = stat, rmImpl = rm, now = Date.now(), maxAgeMs = 60 * 60 * 1_000 } = {}) {
  let entries;
  try {
    entries = await readdirImpl(tempRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("tabitabi-flyctl-")) continue;
    const path = join(tempRoot, entry.name);
    const metadata = await statImpl(path);
    if (now - metadata.mtimeMs <= maxAgeMs) continue;
    await rmImpl(path, { recursive: true, force: true });
  }
}

export function classifyFlyCliError(error, { remotePilot = false } = {}) {
  const message = `${String(error?.message || "Fly CLI request failed")} ${String(error?.stderr || "")}`;
  if (error?.code === "ENOENT") return failure("cliMissing", "flyctl is not installed or is not on PATH.");
  if (/operation not permitted|permission denied/i.test(message)) {
    return failure("configAccess", "Fly CLI could not initialize its private local runtime directory. Run the audit as the same OS user that owns the Fly login; do not print or manually copy the token.");
  }
  if (/not logged in|unauthorized|authentication/i.test(message)) return failure("authentication", "Fly CLI login is missing or expired.");
  if (/timed out|timeout/i.test(message)) return failure("timeout", remotePilot ? "Remote pilot audit timed out; retry without changing resources." : "Fly remote audit timed out; retry without changing resources.");
  if (/Machine .* is not started|could not find a running machine/i.test(message)) return failure("machineStopped", "The Fly Machine is stopped; run the provider-free smoke first, then retry.");
  if (/could not find app|failed to get app/i.test(message)) return failure("appMissing", "Fly app does not exist. Create it only after cost authorization.");
  if (/valid JSON|JSON array|checks map/i.test(message)) return failure("unsupportedResponse", "Fly CLI JSON shape is unsupported; check flyctl version and update the audit parser before trusting results.");
  return failure("remoteUnavailable", remotePilot
    ? "Remote pilot audit failed; inspect Fly SSH status without printing event records or Secrets."
    : "Fly remote audit failed; inspect flyctl status without pasting secrets into chat.");
}

function failure(category, message) {
  return { category, message };
}
