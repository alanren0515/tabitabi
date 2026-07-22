import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { currentGitState } from "../server/release-revision.mjs";

const run = promisify(execFile);
const git = await currentGitState();
let report;
try {
  const { stdout, stderr } = await run(process.execPath, ["--test"], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const output = `${stdout}\n${stderr}`;
  const tests = Number(output.match(/ℹ tests (\d+)/)?.[1] || 0);
  const failures = Number(output.match(/ℹ fail (\d+)/)?.[1] || 0);
  report = { generatedAt: new Date().toISOString(), revision: git.revision, repositoryClean: git.clean, passed: tests > 0 && failures === 0, tests, failures };
} catch (error) {
  const output = `${String(error.stdout || "")}\n${String(error.stderr || "")}`;
  report = { generatedAt: new Date().toISOString(), revision: git.revision, repositoryClean: git.clean, passed: false, tests: Number(output.match(/ℹ tests (\d+)/)?.[1] || 0), failures: Number(output.match(/ℹ fail (\d+)/)?.[1] || 1) };
}
await mkdir("data/release-evidence", { recursive: true });
await writeFile("data/release-evidence/latest-tests.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
