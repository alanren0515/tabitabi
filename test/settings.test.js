import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, normalizeSettings, persistentSettings, pilotAccessHeaders, pilotAccessLocked, pilotAccessRejected, PILOT_ACCESS_SESSION_KEY, savePilotAccessForSession, settingsFromForm, settingsWithoutPilotAccess, settingsWithSessionAccess, SETTINGS_STORAGE_KEY } from "../src/settings.js";

test("normalizes local preferences to bounded supported values", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ defaultPartySize: 99, defaultPhoneScript: "easy", reservationName: "legacy", saveRecentAnalyses: false }), {
    defaultPartySize: 20,
    saveRecentAnalyses: false,
    pilotAccessCode: ""
  });
  assert.equal(normalizeSettings({ defaultPartySize: "bad", defaultPhoneScript: "unknown" }).defaultPartySize, 2);
  assert.equal("reservationName" in normalizeSettings({ reservationName: "legacy" }), false);
  assert.equal("defaultPhoneScript" in normalizeSettings({ defaultPhoneScript: "easy" }), false);
  assert.equal(normalizeSettings({ pilotAccessCode: `  code\n${"x".repeat(300)}  ` }).pilotAccessCode.length, 256);
  assert.deepEqual(pilotAccessHeaders({ pilotAccessCode: " pilot-code " }), { "X-Pilot-Access": "pilot-code" });
  assert.deepEqual(pilotAccessHeaders({}), {});
});

test("locks protected pilot actions only when the current session has no access code", () => {
  assert.equal(pilotAccessLocked({ pilotAccessRequired: true }, {}), true);
  assert.equal(pilotAccessLocked({ pilotAccessRequired: true }, { pilotAccessCode: " session-code " }), false);
  assert.equal(pilotAccessLocked({ pilotAccessRequired: false }, {}), false);
  assert.equal(pilotAccessLocked({}, {}), false);
});

test("recognizes a rejected access code and clears only that session value", () => {
  assert.equal(pilotAccessRejected({ code: "PILOT_ACCESS_REQUIRED" }), true);
  assert.equal(pilotAccessRejected({ code: "VISION_RATE_LIMITED" }), false);
  assert.deepEqual(settingsWithoutPilotAccess({ defaultPartySize: 4, pilotAccessCode: "wrong-code" }), {
    defaultPartySize: 4,
    saveRecentAnalyses: true,
    pilotAccessCode: ""
  });
});

test("keeps the pilot access code out of persistent settings and only in session storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const settings = normalizeSettings({ defaultPartySize: 4, pilotAccessCode: "session-secret" });
  assert.equal("pilotAccessCode" in persistentSettings(settings), false);
  savePilotAccessForSession(settings, storage);
  assert.equal(values.get(PILOT_ACCESS_SESSION_KEY), "session-secret");
  assert.equal(settingsWithSessionAccess(persistentSettings(settings), storage).pilotAccessCode, "session-secret");
  savePilotAccessForSession({ pilotAccessCode: "" }, storage);
  assert.equal(values.has(PILOT_ACCESS_SESSION_KEY), false);
});

test("requires the recent-history checkbox to be present in submitted form values", () => {
  assert.equal(settingsFromForm({ defaultPartySize: "4", saveRecentAnalyses: "on" }).saveRecentAnalyses, true);
  assert.equal(settingsFromForm({ defaultPartySize: "4" }).saveRecentAnalyses, false);
  assert.equal(settingsFromForm({ pilotAccessCode: "test-code" }).pilotAccessCode, "test-code");
});

test("removes legacy persistent access codes synchronously and recovers malformed settings", () => {
  const localValues = new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ defaultPartySize: 3, pilotAccessCode: "legacy-secret" })]]);
  const localStorage = { getItem: (key) => localValues.get(key) || null, setItem: (key, value) => localValues.set(key, value) };
  const sessionStorage = { getItem: () => null };
  assert.equal(loadSettingsFromStorage(localStorage, sessionStorage).pilotAccessCode, "");
  assert.doesNotMatch(localValues.get(SETTINGS_STORAGE_KEY), /legacy-secret|pilotAccessCode/);
  localValues.set(SETTINGS_STORAGE_KEY, "{bad-json");
  assert.deepEqual(loadSettingsFromStorage(localStorage, sessionStorage), DEFAULT_SETTINGS);
});
