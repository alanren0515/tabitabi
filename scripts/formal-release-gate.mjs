import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateFormalReleaseGate } from "../server/formal-release-gate.mjs";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const app = flyApplicationName(await readFile("fly.toml", "utf8"));
const [releaseEvidence, pilotEvidence, preflightEvidence, flyEvidence, smokeEvidence] = await Promise.all([
  readJson("data/release-evidence/latest-release.json"),
  readJson("data/release-evidence/latest-remote-pilot.json"),
  readJson("data/release-evidence/latest-preflight.json"),
  readJson("data/release-evidence/latest-fly.json"),
  readJson("data/release-evidence/latest-smoke.json")
]);
const git = await currentGitState();
const report = evaluateFormalReleaseGate({ releaseEvidence, pilotEvidence, preflightEvidence, flyEvidence, smokeEvidence, app, currentRevision: git.revision, repositoryClean: git.clean });
await mkdir("data/release-evidence", { recursive: true });
await writeFile("data/release-evidence/latest-formal.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.gatePassed) process.exitCode = 1;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
