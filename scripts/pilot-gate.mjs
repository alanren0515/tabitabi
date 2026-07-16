import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadPilotReport } from "../server/pilot-report.mjs";

const eventsPath = resolve(process.env.PILOT_EVENTS_PATH || "data/events.jsonl");
const reportPath = resolve(process.env.PILOT_REPORT_PATH || "eval/latest-pilot-results.json");
const report = await loadPilotReport(eventsPath);

console.log(JSON.stringify(report, null, 2));
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!report.gatePassed) process.exitCode = 1;
