import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { translate } from "../src/i18n.js";

test("pre-caches only the static app shell and bypasses API requests", async () => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /request\.method !== "GET"/);
  assert.doesNotMatch(source, /cache\.put\s*\(/);
  assert.doesNotMatch(source, /\/api\/capabilities["']/);

  const shellMatch = source.match(/const APP_SHELL = \[([^]*?)\];/);
  assert.ok(shellMatch);
  const paths = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths.includes("/"));
  assert.ok(paths.includes("/src/app.js"));
  assert.ok(paths.every((path) => !path.includes("?") && !path.startsWith("/api/")));

  for (const path of paths.filter((path) => path !== "/")) {
    await access(new URL(`..${path}`, import.meta.url));
  }

  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const importedModules = [...appSource.matchAll(/from "\.\/(.+?)";/g)].map((match) => `/src/${match[1]}`);
  for (const importedModule of importedModules) assert.ok(paths.includes(importedModule), `${importedModule} must be in the offline app shell`);
});

test("the client registers the service worker and blocks new analysis while offline", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(source, /navigator\.onLine === false/);
  assert.match(source, /t\("error\.offline"\)/);
  assert.equal(translate("ja", "error.offline"), "オフラインです。接続後にもう一度お試しください");
});
