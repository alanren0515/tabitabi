import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { translate } from "../src/i18n.js";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("the homepage blocks analysis until a required session access code is saved", () => {
  assert.match(appSource, /id="pilot-access-form"/);
  assert.match(appSource, /pilotAccessLocked\(state\.capabilities, state\.settings\)/);
  assert.match(appSource, /disabled aria-describedby="pilot-access-help"/);
  assert.match(appSource, /savePilotAccessForSession\(state\.settings, sessionStorage\)/);
});

test("the homepage access form does not validate by spending a provider request", () => {
  const handler = appSource.match(/document\.querySelector\("#pilot-access-form"\)[\s\S]*?document\.querySelector\("#upload-trigger"\)/)?.[0] || "";
  assert.match(handler, /syncSettings\(\)/);
  assert.doesNotMatch(handler, /extractScreenshot|findRestaurantCandidates|fetch\(/);
});

test("a rejected code clears the session value and returns focus to the homepage gate", () => {
  assert.match(appSource, /recoverFromPilotAccessError\(error\)/);
  assert.match(appSource, /settingsWithoutPilotAccess\(state\.settings\)/);
  assert.match(appSource, /document\.querySelector\("#pilot-access-code"\)\?\.focus\(\)/);
  assert.match(appSource, /t\("error\.accessInvalid"\)/);
  assert.match(translate("ja", "error.accessInvalidBody"), /アクセスコードが正しくありません/);
});
