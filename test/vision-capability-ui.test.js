import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("shows whether screenshot fallback is actually configured", () => {
  assert.match(appSource, /capabilities\?\.fallbackAvailable/);
  assert.match(appSource, /备用识别尚未配置/);
  assert.match(appSource, /截图备用识别/);
  assert.match(appSource, /低置信度结果必须人工确认/);
});

test("confirms capability state before recording a new analysis mode", () => {
  assert.match(appSource, /const capabilities = await getCapabilities\(\);[^]*capabilities\.capabilitiesUnavailable[^]*postEvent\("input_submitted"/);
  assert.match(appSource, /state\.analysisSourceMode = capabilities\.placesSearch \? "live" : "demo"/);
  assert.match(appSource, /if \(result\.mode === "sample"\) state\.analysisSourceMode = "demo"/);
});

test("creates a fresh attributed run for queued restaurants and clears attribution for history refreshes", () => {
  assert.match(appSource, /async function openPendingAnalysis[^]*state\.analysisRunId = createAnalysisRunId\(\)[^]*postEvent\("input_submitted"[^]*postEvent\("restaurant_identified"/);
  assert.match(appSource, /async function openRecentAnalysis[^]*resetAnalysisAttribution\(\)/);
  assert.match(appSource, /data-open-saved[^]*resetAnalysisAttribution\(\)/);
});
