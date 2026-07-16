import { access, readFile } from "node:fs/promises";
import { buildReservationOptions, platformForUrl } from "../server/reservation-options.mjs";

const audits = JSON.parse(await readFile("eval/platform-navigation-audits.json", "utf8"));
const results = [];

for (const audit of audits) {
  const errors = [];
  const platform = platformForUrl(audit.sourceUrl);
  const option = buildReservationOptions({ place: { name: audit.restaurant, websiteUri: audit.sourceUrl } })
    .find((item) => item.provider === audit.provider);
  if (audit.scope !== "public_navigation_pre_submit") errors.push("invalid scope");
  if (audit.viewport !== "1280x720") errors.push("recorded viewport mismatch");
  if (audit.loggedIn !== false) errors.push("audit must remain logged out");
  if (audit.finalSubmissionAttempted !== false) errors.push("final submission must not be attempted");
  if (audit.sourceAppPreserved !== true) errors.push("source app state was not preserved");
  if (audit.status !== "desktop_checked") errors.push("navigation check status is invalid");
  if (platform?.provider !== audit.provider) errors.push("provider mismatch");
  if (option?.capability?.kind !== audit.expectedCapability) errors.push("capability mismatch");
  if (!/^output\/platform-audit\/[a-z0-9-]+-1280x720\.jpg$/.test(audit.evidence || "")) errors.push("invalid evidence path");
  else {
    try { await access(audit.evidence); } catch { errors.push("evidence file missing"); }
  }
  for (const key of ["sourceUrl", "finalUrl"]) {
    try {
      const url = new URL(audit[key]);
      if (url.protocol !== "https:") errors.push(`${key} must use https`);
    } catch { errors.push(`${key} is invalid`); }
  }
  results.push({ id: audit.id, provider: audit.provider, expectedCapability: audit.expectedCapability, passed: errors.length === 0, errors });
}

const report = {
  scope: "Desktop public navigation to the pre-submit boundary only. This does not count as the required mobile audit; no login, reservation submission, payment, inventory claim, or seat hold.",
  checks: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed),
  results
};

console.log(JSON.stringify(report, null, 2));
if (report.failed.length) process.exitCode = 1;
