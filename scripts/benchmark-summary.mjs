import { summarizeBenchmark } from "../server/benchmark-summary.mjs";
import { benchmarkCliError, readBenchmarkInput, verifyBenchmarkBaseline } from "./benchmark-input.mjs";

try {
  const input = await readBenchmarkInput();
  if (input.help) console.log("Usage: node scripts/benchmark-summary.mjs [--input study.json]\nDefault: synthetic, provider-free fixture. Fixture results never establish a real GQ pass.");
  else {
    const report = summarizeBenchmark(input.study, { baselineVerification: await verifyBenchmarkBaseline(input.study) });
    console.log(JSON.stringify(report, null, 2));
    if (!report.validation.valid || !["fixture_only", "pass"].includes(report.gq.status)) process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify(benchmarkCliError(error), null, 2));
  process.exitCode = 1;
}
