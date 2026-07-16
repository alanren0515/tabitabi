import test from "node:test";
import assert from "node:assert/strict";
import { pilotAccessAuthorized, pilotAccessRequired, protectedPilotApiPath } from "../server/pilot-access.mjs";

test("leaves all requests unchanged when no pilot access code is configured", () => {
  assert.equal(pilotAccessRequired({}), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, {}), true);
});

test("protects only the expensive pilot APIs", () => {
  for (const path of ["/api/extract-screenshot", "/api/extract-webpage", "/api/restaurants/search", "/api/restaurants/details"]) {
    assert.equal(protectedPilotApiPath("POST", path), true);
  }
  for (const [method, path] of [["GET", "/api/capabilities"], ["POST", "/api/extract-text"], ["POST", "/api/events"], ["POST", "/api/audit/save"]]) {
    assert.equal(protectedPilotApiPath(method, path), false);
  }
});

test("accepts only an exact X-Pilot-Access value when configured", () => {
  const env = { PILOT_ACCESS_CODE: "closed-pilot-2026" };
  assert.equal(pilotAccessRequired(env), true);
  assert.equal(pilotAccessAuthorized({ headers: { "x-pilot-access": "closed-pilot-2026" } }, env), true);
  assert.equal(pilotAccessAuthorized({ headers: { "x-pilot-access": "closed-pilot" } }, env), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, env), false);
});
