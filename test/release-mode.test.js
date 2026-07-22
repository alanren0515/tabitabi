import test from "node:test";
import assert from "node:assert/strict";
import { publicReleaseMode, releaseAccessConfigured, releaseAccessMode } from "../server/release-mode.mjs";

test("keeps production fail-closed unless pilot or public mode is explicit", () => {
  assert.equal(releaseAccessMode({ NODE_ENV: "production" }), "misconfigured");
  assert.equal(releaseAccessConfigured({ NODE_ENV: "production" }), false);
  assert.equal(releaseAccessMode({ NODE_ENV: "production", PILOT_ACCESS_CODE: "x".repeat(24) }), "pilot");
  assert.equal(releaseAccessMode({ NODE_ENV: "production", PUBLIC_RELEASE_MODE: "true" }), "public");
});

test("public mode requires an exact affirmative value and local development remains usable", () => {
  assert.equal(publicReleaseMode({ PUBLIC_RELEASE_MODE: "TRUE" }), true);
  assert.equal(publicReleaseMode({ PUBLIC_RELEASE_MODE: "1" }), false);
  assert.equal(releaseAccessMode({}), "local");
});
