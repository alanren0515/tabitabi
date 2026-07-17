import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateReleaseEvidence } from "../server/release-evidence.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const cases = await readJson("eval/cases.json");
const matrix = await readJson("eval/coverage-matrix.json");
const audits = await readJson("eval/manual-audits.json");
const candidateResults = await readJsonOrNull("eval/latest-candidate-results.json");
const decisionResults = await readJsonOrNull("eval/latest-decision-results.json");
const report = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults, decisionResults });
const git = await currentGitState();
const persisted = { generatedAt: new Date().toISOString(), revision: git.revision, repositoryClean: git.clean, ...report };
await mkdir("data/release-evidence", { recursive: true });
await writeFile("data/release-evidence/latest-release.json", `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
console.log(JSON.stringify(persisted, null, 2));
if (!report.gatePassed) process.exitCode = 1;

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function readJsonOrNull(path) { try { return await readJson(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
