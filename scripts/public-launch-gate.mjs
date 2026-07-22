import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluatePublicLaunchGate } from "../server/public-launch-gate.mjs";
import { flyApplicationName } from "../server/deployment-preflight.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const app = flyApplicationName(await readFile("fly.toml", "utf8"));
const [formalEvidence, publicSmokeEvidence, flyEvidence, legalReviewEvidence, restoreDrillEvidence, alertingEvidence] = await Promise.all([
  readJson("data/release-evidence/latest-formal.json"),
  readJson("data/release-evidence/latest-public-smoke.json"),
  readJson("data/release-evidence/latest-fly.json"),
  readJson("data/release-evidence/legal-review.json"),
  readJson("data/release-evidence/restore-drill.json"),
  readJson("data/release-evidence/alerting-drill.json")
]);
const git = await currentGitState();
const report = evaluatePublicLaunchGate({ formalEvidence, publicSmokeEvidence, flyEvidence, legalReviewEvidence, restoreDrillEvidence, alertingEvidence, app, currentRevision: git.revision, repositoryClean: git.clean });
await mkdir("data/release-evidence", { recursive: true });
await writeFile("data/release-evidence/latest-public-launch.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.gatePassed) process.exitCode = 1;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
