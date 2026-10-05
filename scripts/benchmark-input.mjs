import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_BENCHMARK_INPUT = fileURLToPath(new URL("../eval/benchmark/fixtures/synthetic-study.json", import.meta.url));

export async function readBenchmarkInput(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  let path = DEFAULT_BENCHMARK_INPUT;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--input" || !args[1]) throw new Error("invalid_arguments");
    path = resolve(args[1]);
  }
  const input = await readFile(path, "utf8");
  if (Buffer.byteLength(input, "utf8") > 5 * 1024 * 1024) throw new Error("input_too_large");
  return { study: JSON.parse(input) };
}

export async function verifyBenchmarkBaseline(study) {
  if (study?.studyMode !== "real") return null;
  try {
    const { verifyBaselineSnapshot } = await import("../server/benchmark-baseline.mjs");
    const result = await verifyBaselineSnapshot(study.protocol?.baselineSnapshot, { root: process.cwd() });
    return { valid: result?.valid === true };
  } catch {
    return { valid: false };
  }
}

export function benchmarkCliError(error) {
  // File paths, invalid JSON fragments and arbitrary input never enter stdout/stderr.
  return { valid: false, errors: [{ code: ["invalid_arguments", "input_too_large"].includes(error?.message) ? error.message : "input_read_or_parse_failed", path: "input" }] };
}
