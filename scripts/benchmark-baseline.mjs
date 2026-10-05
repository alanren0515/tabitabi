import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { BASELINE_SOURCE_PATHS, PROVIDER_FREE_CONFIG, verifyBaselineSnapshot } from "../server/benchmark-baseline.mjs";

const run = promisify(execFile);
const root = process.cwd();
const manifestPath = join(root, "eval/benchmark/baseline-snapshot.json");
const command = process.argv[2] || "--verify";
try {
  if (!['--create', '--verify', '--replay'].includes(command) || process.argv.length > 3) throw new Error("usage: benchmark-baseline.mjs --create|--verify|--replay");
  if (command === "--create") await createSnapshot();
  const snapshot = JSON.parse(await readFile(manifestPath, "utf8"));
  const verification = await verifyBaselineSnapshot(snapshot, { root });
  if (!verification.valid) {
    console.log(JSON.stringify(verification, null, 2));
    process.exitCode = 1;
  } else if (command === "--replay") {
    console.log(JSON.stringify(await replay(snapshot), null, 2));
  } else console.log(JSON.stringify({ ...verification, revision: snapshot.revision, archiveSha256: snapshot.archiveSha256 }, null, 2));
} catch (error) {
  console.error(`Baseline operation failed: ${error.message}`);
  process.exitCode = 1;
}

async function createSnapshot() {
  // Keep the first manifest; a later invocation must not silently replace the before-change revision.
  try { await readFile(manifestPath); return; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root });
  const revision = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Cannot identify source revision");
  const archivePath = `data/benchmark-baselines/${revision}.tar`;
  const configurationFixturePath = "eval/benchmark/provider-free-config.json";
  await mkdir(join(root, "data/benchmark-baselines"), { recursive: true });
  await mkdir(join(root, "eval/benchmark"), { recursive: true });
  await run("git", ["archive", "--format=tar", `--output=${join(root, archivePath)}`, revision, "--", ...BASELINE_SOURCE_PATHS], { cwd: root });
  const archiveSha256 = createHash("sha256").update(await readFile(join(root, archivePath))).digest("hex");
  await writeFile(join(root, configurationFixturePath), `${JSON.stringify(PROVIDER_FREE_CONFIG, null, 2)}\n`, { flag: "wx" });
  const snapshot = {
    revision, archivePath, archiveSha256, createdAt: new Date().toISOString(), nodeVersion: process.version,
    configurationFixturePath, sourcePaths: BASELINE_SOURCE_PATHS,
    replayCommand: "node scripts/benchmark-baseline.mjs --replay"
  };
  await writeFile(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
}

async function replay(snapshot) {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-baseline-"));
  let child;
  try {
    // Validate before extracting; the manifest's digest must match the retained archive.
    const { stdout: files } = await run("tar", ["-tf", resolve(root, snapshot.archivePath)]);
    if (files.trim().split("\n").some((file) => !BASELINE_SOURCE_PATHS.some((path) => file === path || file.startsWith(`${path}/`)) || file.split("/").includes(".."))) throw new Error("Unexpected baseline archive entry");
    await run("tar", ["-xf", resolve(root, snapshot.archivePath), "-C", directory]);
    const env = { ...PROVIDER_FREE_CONFIG };
    const { stdout } = await run(process.execPath, ["--test", "test/event-sanitizer.test.js", "test/decision-engine.test.js", "test/text-input.test.js"], { cwd: directory, env, timeout: 30_000 });
    // Node switches to TAP when stdout is piped.
    const tests = Number(stdout.match(/(?:#|ℹ) tests (\d+)/)?.[1] || 0);
    if (!tests) throw new Error("No baseline regression tests ran");
    const port = await availablePort();
    child = spawn(process.execPath, ["server.mjs"], { cwd: directory, env: { ...env, PORT: String(port) }, stdio: "ignore" });
    const origin = `http://127.0.0.1:${port}`;
    const limit = Date.now() + 5_000;
    let ready = false;
    while (Date.now() < limit) {
      if (child.exitCode !== null) throw new Error("Baseline server exited");
      try { ready = (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup only. */ }
      if (ready) break;
      await new Promise((done) => setTimeout(done, 25));
    }
    if (!ready) throw new Error("Baseline server did not start");
    const capabilities = await (await fetch(`${origin}/api/capabilities`, { signal: AbortSignal.timeout(2_000) })).json();
    if (!capabilities.emergencyStop || capabilities.placesSearch || capabilities.visionExtraction || capabilities.hotPepper) throw new Error("Baseline is not provider-free");
    return { valid: true, revision: snapshot.revision, tests, apiSmokePassed: true, paidCalls: 0, scope: "offline regression and local health/capabilities; no human comparison" };
  } finally {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(directory, { recursive: true, force: true });
  }
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
  return port;
}
