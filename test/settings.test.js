import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings, pilotAccessHeaders, settingsFromForm } from "../src/settings.js";

test("normalizes local preferences to bounded supported values", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ defaultPartySize: 99, defaultPhoneScript: "easy", saveRecentAnalyses: false }), {
    defaultPartySize: 20,
    reservationName: "",
    defaultPhoneScript: "easy",
    saveRecentAnalyses: false,
    pilotAccessCode: ""
  });
  assert.equal(normalizeSettings({ defaultPartySize: "bad", defaultPhoneScript: "unknown" }).defaultPartySize, 2);
  assert.equal(normalizeSettings({ reservationName: "  Guo\nQuan\u0000  " }).reservationName, "Guo Quan");
  assert.equal(normalizeSettings({ reservationName: "x".repeat(80) }).reservationName.length, 60);
  assert.equal(normalizeSettings({ pilotAccessCode: `  code\n${"x".repeat(300)}  ` }).pilotAccessCode.length, 256);
  assert.deepEqual(pilotAccessHeaders({ pilotAccessCode: " pilot-code " }), { "X-Pilot-Access": "pilot-code" });
  assert.deepEqual(pilotAccessHeaders({}), {});
});

test("requires the recent-history checkbox to be present in submitted form values", () => {
  assert.equal(settingsFromForm({ defaultPartySize: "4", defaultPhoneScript: "short", saveRecentAnalyses: "on" }).saveRecentAnalyses, true);
  assert.equal(settingsFromForm({ defaultPartySize: "4", defaultPhoneScript: "short" }).saveRecentAnalyses, false);
  assert.equal(settingsFromForm({ reservationName: "  郭 泉  " }).reservationName, "郭 泉");
  assert.equal(settingsFromForm({ pilotAccessCode: "test-code" }).pilotAccessCode, "test-code");
});
