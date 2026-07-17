import { loadPilotReport } from "./pilot-report.mjs";

const report = await loadPilotReport("/app/data/events.jsonl");
console.log(`TABITABI_REPORT=${JSON.stringify({
  schemaVersion: 1,
  source: "fly-volume",
  app: process.env.FLY_APP_NAME || null,
  volume: "tabitabi_data",
  releaseRevision: process.env.RELEASE_REVISION || null,
  imageRef: process.env.FLY_IMAGE_REF || null,
  ...report
})}`);
