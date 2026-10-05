import { readFile } from "node:fs/promises";
import { summarizeCommercialMetrics } from "../server/commercial-metrics.mjs";

try {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--input", "--as-of", "--revision"].includes(args[index]) || !args[index + 1]
      || args[index + 1].startsWith("--") || Object.hasOwn(options, args[index])) throw new Error("INVALID_ARGUMENTS");
    options[args[index]] = args[index + 1];
  }
  const realInput = Boolean(options["--input"]);
  if (args.length && (!realInput || !options["--as-of"] || !options["--revision"])) throw new Error("EXPLICIT_INPUT_AS_OF_AND_REVISION_REQUIRED");
  const source = JSON.parse(await readFile(realInput ? options["--input"] : new URL("../eval/commercial/fixtures/synthetic.json", import.meta.url), "utf8"));
  const report = summarizeCommercialMetrics(realInput ? source : source.state, {
    now: realInput ? options["--as-of"] : source.asOf,
    releaseRevision: realInput ? options["--revision"] : source.releaseRevision
  });
  report.evidenceType = realInput ? "explicit_local_snapshot_unverified" : "fixture_only";
  report.realWorldEvidence = false;
  report.limitations.unshift(realInput ? "Caller-supplied local snapshot provenance has not been verified." : "Synthetic fixture only; this report is not real usage or retention evidence.");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  // Do not print filesystem paths, raw snapshots, or data from parsing errors.
  const known = new Set(["INVALID_ARGUMENTS", "EXPLICIT_INPUT_AS_OF_AND_REVISION_REQUIRED", "COMMERCIAL_AS_OF_REQUIRED", "COMMERCIAL_REVISION_REQUIRED", "INVALID_COMMERCIAL_SNAPSHOT"]);
  process.stderr.write(`${known.has(error.message) ? error.message : "COMMERCIAL_SNAPSHOT_READ_FAILED"}\nUsage: node scripts/summarize-commercial.mjs [--input PATH --as-of ISO_TIMESTAMP --revision FULL_SHA]\n`);
  process.exitCode = 1;
}
