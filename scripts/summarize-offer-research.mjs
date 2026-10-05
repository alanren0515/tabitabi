import { open } from "node:fs/promises";
import { offerResearchFixture } from "../eval/offers/fixtures.mjs";
import { summarizeOfferResearch } from "../server/offer-research.mjs";

const MAX_BYTES = 5 * 1024 * 1024;
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--input" || !args[1] || args[1].startsWith("--"))) throw new Error("INVALID_ARGUMENTS");
  let snapshot = offerResearchFixture();
  if (args.length) {
    const handle = await open(args[1], "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("INVALID_OFFER_RESEARCH_SNAPSHOT");
      if (stat.size > MAX_BYTES) throw new Error("OFFER_RESEARCH_SNAPSHOT_TOO_LARGE");
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_BYTES || length > stat.size) throw new Error("OFFER_RESEARCH_SNAPSHOT_TOO_LARGE");
      snapshot = JSON.parse(buffer.subarray(0, length).toString("utf8"));
    } finally { await handle.close(); }
  }
  console.log(JSON.stringify({ ...summarizeOfferResearch(snapshot), inputMode: args.length ? "explicit_local_snapshot_unverified" : "built_in_synthetic_only",
    snapshotBoundary: { maxBytes: MAX_BYTES, maxRecords: 10_000, maxOffers: 100, maxInterviews: 100, networkCalls: 0,
      realCustomerDataAuthorized: false, suppliedAssertionsVerified: false } }, null, 2));
} catch (error) {
  const code = ["INVALID_ARGUMENTS", "INVALID_OFFER_RESEARCH_SNAPSHOT", "OFFER_RESEARCH_SNAPSHOT_TOO_LARGE"].includes(error?.message)
    ? error.message : "OFFER_RESEARCH_SNAPSHOT_READ_FAILED";
  console.error(`${code}\nUsage: node scripts/summarize-offer-research.mjs [--input PATH]`);
  process.exitCode = 1;
}
