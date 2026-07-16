import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReservationOptions, platformForUrl } from "../server/reservation-options.mjs";

test("classifies checked public platform URL shapes without treating them as booking audits", async () => {
  const checks = JSON.parse(await readFile(new URL("../eval/platform-url-checks.json", import.meta.url), "utf8"));
  assert.ok(checks.length >= 7);

  for (const check of checks) {
    assert.equal(check.scope, "url_shape_only");
    assert.ok(check.evidenceUrl);
    assert.equal(platformForUrl(check.url)?.provider, check.provider, check.id);
    const option = buildReservationOptions({ place: { name: "URL shape check", websiteUri: check.url } })
      .find((item) => item.provider === check.provider);
    assert.equal(option?.capability?.kind, check.expectedCapability, check.id);
    assert.equal(option?.capability?.recommended, false, `${check.id} must remain unverified without restaurant association`);
  }
});
