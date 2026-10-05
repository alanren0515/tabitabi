import { readFile, stat } from "node:fs/promises";
import { costFixture } from "../eval/costs/fixture.mjs";
import { summarizeRequestCosts } from "../server/cost-summary.mjs";
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--input" || !args[1] || args[1].startsWith("--"))) throw new Error("INVALID_ARGUMENTS");
  let records = costFixture();
  if (args.length) {
    if ((await stat(args[1])).size > 10 * 1024 * 1024) throw new Error("COST_SNAPSHOT_TOO_LARGE");
    records = (await readFile(args[1], "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }
  console.log(JSON.stringify({ ...summarizeRequestCosts(records), evidenceType: args.length ? "explicit_local_snapshot_unverified" : "fixture_only",
    realWorldEvidence: false, releaseGateEvidence: false }, null, 2));
} catch (error) {
  const code = ["INVALID_ARGUMENTS", "COST_SNAPSHOT_TOO_LARGE", "INVALID_COST_RECORDS"].includes(error.message) ? error.message : "COST_SNAPSHOT_READ_FAILED";
  console.error(`${code}\nUsage: node scripts/summarize-request-costs.mjs [--input PATH]`);
  process.exitCode = 1;
}
