import { readFile } from "node:fs/promises";
import { renderMonitoringSummary } from "../server/daily-monitoring.mjs";

let report = null;
try { report = JSON.parse(await readFile("data/monitoring/latest.json", "utf8")); }
catch { /* A failed command may not have produced a report. */ }
console.log(renderMonitoringSummary(report));
