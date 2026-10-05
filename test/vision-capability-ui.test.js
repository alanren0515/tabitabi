import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.js", import.meta.url), "utf8");

test("shows fallback configuration in settings without crowding the homepage", () => {
  assert.match(appSource, /capabilities\.fallbackAvailable/);
  assert.match(appSource, /settings\.fallbackMissing/);
  assert.doesNotMatch(appSource, /home\.fallbackMissing/);
  assert.match(i18nSource, /画像モデルは1つです/);
  assert.match(i18nSource, /低確度時に自動使用/);
  assert.match(i18nSource, /確度が低い場合は手動確認が必要/);
});

test("confirms capability state before recording a new analysis mode", () => {
  assert.match(appSource, /const capabilities = await getCapabilities\(\);[^]*capabilities\.capabilitiesUnavailable[^]*postEvent\("input_submitted"/);
  assert.match(appSource, /state\.analysisSourceMode = state\.exampleInput \? "demo" : "live"/);
  assert.match(appSource, /if \(capabilities\.capabilitiesUnavailable \|\| !capabilities\.placesSearch\)[^]*enterSearchRecovery/);
  assert.match(appSource, /if \(result\.mode === "sample"\)[^]*state\.analysisSourceMode = "demo"/);
});

test("keeps homepage examples out of live pilot metrics", () => {
  assert.match(appSource, /state\.exampleInput = true/);
  assert.match(appSource, /addEventListener\("input", \(event\) => \{[^]*state\.exampleInput = false/);
});

test("opens local records without starting analysis and attributes only explicit checks", () => {
  const queueOpen = appSource.split("function openPendingAnalysis(id) {")[1].split("async function startPendingMeasurement")[0];
  assert.match(queueOpen, /resetAnalysisAttribution\(\)/);
  assert.doesNotMatch(queueOpen, /fetch\(|measurement\.start\(|postEvent\(/);
  assert.match(appSource, /await startPendingMeasurement\(query\)/);
  const explicitStart = appSource.split("async function startPendingMeasurement(query) {")[1].split("function saveActiveDraft")[0];
  assert.match(explicitStart, /state\.analysisRunId=createAnalysisRunId\(\)/);
  assert.match(explicitStart, /measurement\.start\(\{kind:"analysis"/);
  assert.match(explicitStart, /postEvent\("input_submitted"/);
  assert.match(explicitStart, /parsed\.clues\?\.name\) postEvent\("restaurant_identified"/);
  const localOpen = appSource.split("function openLocalRecord(")[1].split("function renderLocalDetail")[0];
  assert.match(localOpen, /resetAnalysisAttribution\(\)/);
  assert.doesNotMatch(localOpen, /fetch\(|measurement\.start\(/);
});
