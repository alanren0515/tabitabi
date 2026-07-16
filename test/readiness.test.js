import test from "node:test";
import assert from "node:assert/strict";
import { serviceReadiness } from "../server/readiness.mjs";

test("requires live vision and Places but keeps fallback and enrichment optional", () => {
  const missing = serviceReadiness({ visionCapabilities: { visionExtraction: false }, env: {} });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ["vision_extraction", "places_search"]);

  const ready = serviceReadiness({
    visionCapabilities: { visionExtraction: true, fallbackAvailable: false },
    env: { GOOGLE_MAPS_API_KEY: "configured" }
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.fallbackAvailable, false);
  assert.equal(ready.optionalEnrichment, false);
});

