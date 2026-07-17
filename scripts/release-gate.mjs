import { readFile } from "node:fs/promises";
import { evaluateReleaseEvidence } from "../server/release-evidence.mjs";

const cases = await readJson("eval/cases.json");
const matrix = await readJson("eval/coverage-matrix.json");
const audits = await readJson("eval/manual-audits.json");
const candidateResults = await readJsonOrNull("eval/latest-candidate-results.json");
const decisionResults = await readJsonOrNull("eval/latest-decision-results.json");
const report = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults, decisionResults });
console.log(JSON.stringify(report, null, 2));
if (!report.gatePassed) process.exitCode = 1;

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function readJsonOrNull(path) { try { return await readJson(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
