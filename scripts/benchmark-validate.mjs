import { validateBenchmark } from "../server/benchmark-protocol.mjs";
import { benchmarkCliError, readBenchmarkInput, verifyBenchmarkBaseline } from "./benchmark-input.mjs";

try {
  const input = await readBenchmarkInput();
  if (input.help) console.log("Usage: node scripts/benchmark-validate.mjs [--input study.json]\nDefault: synthetic, provider-free fixture. Real inputs require a verified baseline archive.");
  else {
    const report = validateBenchmark(input.study);
    const verification = await verifyBenchmarkBaseline(input.study);
    report.baselineArchive = { required: input.study?.studyMode === "real", verified: verification?.valid ?? null };
    if (verification?.valid === false) {
      report.valid = false;
      report.errors.push({ code: "baseline_archive_not_verified", path: "protocol.baselineSnapshot" });
    }
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify(benchmarkCliError(error), null, 2));
  process.exitCode = 1;
}
