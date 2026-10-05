import test from "node:test";
import assert from "node:assert/strict";
import { pilotAccessAuthorized, pilotAccessCodeStrong, pilotAccessRequired, protectedPilotApiPath } from "../server/pilot-access.mjs";

test("leaves all requests unchanged when no pilot access code is configured", () => {
  assert.equal(pilotAccessRequired({}), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, {}), true);
});

test("fails closed in production without an explicit pilot or public mode", () => {
  assert.equal(pilotAccessRequired({ NODE_ENV: "production" }), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, { NODE_ENV: "production" }), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, { NODE_ENV: "production", PUBLIC_RELEASE_MODE: "true" }), true);
});

test("explicit public mode takes precedence over a staged pilot secret", () => {
  const env = { NODE_ENV: "production", PUBLIC_RELEASE_MODE: "true", PILOT_ACCESS_CODE: "closed-pilot-2026" };
  assert.equal(pilotAccessRequired(env), false);
  assert.equal(pilotAccessAuthorized({ headers: {} }, env), true);
});

test("protects only the expensive pilot APIs", () => {
  for (const path of ["/api/extract-screenshot", "/api/extract-webpage", "/api/events", "/api/measurement-flows", "/api/research-consent", "/api/restaurants/search", "/api/restaurants/details"]) {
    assert.equal(protectedPilotApiPath("POST", path), true);
  }
  for (const [method, path] of [["GET", "/api/capabilities"], ["POST", "/api/extract-text"], ["POST", "/api/audit/save"]]) {
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

test("requires a production-grade shared access code length", () => {
  assert.equal(pilotAccessCodeStrong({ PILOT_ACCESS_CODE: "short" }), false);
  assert.equal(pilotAccessCodeStrong({ PILOT_ACCESS_CODE: "a-strong-random-access-code" }), true);
});
