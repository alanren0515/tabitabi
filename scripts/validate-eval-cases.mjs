import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const casesPath = resolve(process.argv[2] || "eval/cases.json");
const cases = JSON.parse(await readFile(casesPath, "utf8"));
const errors = [];
const seenIds = new Set();
const forbiddenKeys = new Set(["rawScreenshot", "username", "creatorHandle", "comments", "caption"]);

for (const [index, testCase] of cases.entries()) {
  const label = testCase.id || `index:${index}`;
  if (!testCase.id) errors.push(`${label}: missing id`);
  if (seenIds.has(testCase.id)) errors.push(`${label}: duplicate id`);
  seenIds.add(testCase.id);
  if (!testCase.query) errors.push(`${label}: missing query`);
  if (!testCase.expected?.nameIncludes && !testCase.expected?.nameAnyOf?.length && !testCase.expected?.placeId) errors.push(`${label}: expected nameIncludes, nameAnyOf, or placeId is required`);
  if (!testCase.verificationStatus) errors.push(`${label}: missing verificationStatus`);
  if (testCase.verificationStatus === "confirmed" && !testCase.officialSources?.length) {
    errors.push(`${label}: confirmed cases require officialSources`);
  }
  for (const key of Object.keys(testCase)) {
    if (forbiddenKeys.has(key)) errors.push(`${label}: privacy-sensitive field ${key} is not allowed`);
  }
}

const confirmed = cases.filter((testCase) => testCase.verificationStatus === "confirmed").length;
const report = {
  valid: errors.length === 0,
  cases: cases.length,
  confirmed,
  target: 30,
  coverageComplete: cases.length >= 30 && confirmed === cases.length,
  errors
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
