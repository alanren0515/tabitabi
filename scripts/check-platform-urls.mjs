import { readFile } from "node:fs/promises";
import { buildReservationOptions, platformForUrl } from "../server/reservation-options.mjs";

const checks = JSON.parse(await readFile("eval/platform-url-checks.json", "utf8"));
const results = checks.map((check) => {
  const platform = platformForUrl(check.url);
  const option = buildReservationOptions({ place: { name: "URL shape check", websiteUri: check.url } })
    .find((item) => item.provider === check.provider);
  const actualCapability = option?.capability?.kind || null;
  const passed = check.scope === "url_shape_only"
    && platform?.provider === check.provider
    && actualCapability === check.expectedCapability;
  return {
    id: check.id,
    provider: platform?.provider || null,
    expectedCapability: check.expectedCapability,
    actualCapability,
    passed
  };
});

const report = {
  scope: "URL classification only; this does not prove restaurant identity, availability, mobile UX, or booking success.",
  checks: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed),
  results
};

console.log(JSON.stringify(report, null, 2));
if (report.failed.length) process.exitCode = 1;
