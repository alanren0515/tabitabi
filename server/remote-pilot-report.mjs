import { loadPilotReport } from "./pilot-report.mjs";

const releaseRevision = String(process.env.RELEASE_REVISION || "").trim().toLowerCase();
if (!/^[a-f0-9]{40}$/.test(releaseRevision)) throw new Error("A valid RELEASE_REVISION is required for remote pilot evidence");
const report = await loadPilotReport("/app/data/events.jsonl", new Date(), { releaseRevision });
console.log(`TABITABI_REPORT=${JSON.stringify({
  schemaVersion: 2,
  source: "fly-volume",
  app: process.env.FLY_APP_NAME || null,
  volume: "tabitabi_data",
  releaseRevision,
  imageRef: process.env.FLY_IMAGE_REF || null,
  ...report
})}`);
