import { open } from "node:fs/promises";
import { customerCostFixture, shadowEntitlementFixture } from "../eval/costs/customer-fixture.mjs";
import { summarizeCustomerCosts } from "../server/customer-cost-report.mjs";

const MAX_BYTES = 10 * 1024 * 1024;
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--input" || !args[1] || args[1].startsWith("--"))) throw new Error("INVALID_ARGUMENTS");
  let snapshot = customerCostFixture();
  if (args.length) {
    const handle = await open(args[1], "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new Error("INVALID_CUSTOMER_COST_SNAPSHOT");
      if (stats.size > MAX_BYTES) throw new Error("CUSTOMER_COST_SNAPSHOT_TOO_LARGE");
      // The extra byte detects growth after stat while bounding allocation and bytes read.
      const bytes = Buffer.alloc(Math.min(stats.size + 1, MAX_BYTES + 1));
      let size = 0;
      while (size < bytes.length) {
        const read = await handle.read(bytes, size, bytes.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > MAX_BYTES || size > stats.size) throw new Error("CUSTOMER_COST_SNAPSHOT_TOO_LARGE");
      snapshot = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    } finally { await handle.close(); }
  }
  console.log(JSON.stringify({ ...summarizeCustomerCosts(snapshot), evidenceType: args.length ? "explicit_local_snapshot_unverified" : "fixture_only",
    snapshotBoundary: { maxBytes: MAX_BYTES, maxRecords: 50_000, maxCycles: 100, inputFormat: "single_json_snapshot",
      accountCoverageVerified: false, suppliedCoverageAssertionsVerified: false },
    shadowFixture: args.length ? [] : shadowEntitlementFixture(), realWorldEvidence: false, releaseGateEvidence: false }, null, 2));
} catch (error) {
  const code = ["INVALID_ARGUMENTS", "INVALID_CUSTOMER_COST_SNAPSHOT", "CUSTOMER_COST_SNAPSHOT_TOO_LARGE"].includes(error?.message)
    ? error.message : "CUSTOMER_COST_SNAPSHOT_READ_FAILED";
  console.error(`${code}\nUsage: node scripts/summarize-customer-costs.mjs [--input PATH]`);
  process.exitCode = 1;
}
