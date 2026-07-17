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

  const production = serviceReadiness({
    visionCapabilities: { visionExtraction: true },
    env: { NODE_ENV: "production", GOOGLE_MAPS_API_KEY: "configured" }
  });
  assert.equal(production.ready, false);
  assert.deepEqual(production.missing, ["pilot_access", "operator_name", "contact_email"]);

  const weakAccess = serviceReadiness({ visionCapabilities: { visionExtraction: true }, env: { NODE_ENV: "production", GOOGLE_MAPS_API_KEY: "configured", PILOT_ACCESS_CODE: "short", PUBLIC_OPERATOR_NAME: "TabiTabi", PUBLIC_CONTACT_EMAIL: "support@example.com" } });
  assert.deepEqual(weakAccess.missing, ["pilot_access"]);

  const productionReady = serviceReadiness({
    visionCapabilities: { visionExtraction: true },
    env: { NODE_ENV: "production", GOOGLE_MAPS_API_KEY: "configured", PILOT_ACCESS_CODE: "a-strong-random-access-code", PUBLIC_OPERATOR_NAME: "TabiTabi", PUBLIC_CONTACT_EMAIL: "support@example.com" }
  });
  assert.equal(productionReady.ready, true);

  const unwritable = serviceReadiness({ visionCapabilities: { visionExtraction: true }, env: { GOOGLE_MAPS_API_KEY: "configured" }, dataStoreWritable: false });
  assert.deepEqual(unwritable.missing, ["data_store_writable"]);
});

test("production readiness rejects an unapproved Qwen endpoint even when another vision provider exists", () => {
  const result = serviceReadiness({
    visionCapabilities: { visionExtraction: true },
    env: {
      NODE_ENV: "production",
      DASHSCOPE_BASE_URL: "https://attacker.example/compatible-mode/v1",
      GOOGLE_MAPS_API_KEY: "configured",
      PILOT_ACCESS_CODE: "a-strong-random-access-code",
      PUBLIC_OPERATOR_NAME: "TabiTabi",
      PUBLIC_CONTACT_EMAIL: "support@example.com"
    }
  });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("qwen_endpoint"));
});
