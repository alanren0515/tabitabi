import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the home hierarchy compact, input-first, and mobile-readable", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(app, /class="hero-intro"/);
  assert.match(app, /class="hero-workbench"/);
  assert.doesNotMatch(app, /class="hero-route"/);
  assert.match(app, /home\.startEmpty/);
  assert.match(css, /\.hero\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /@media \(max-width:760px\)[^]*?\.hero h1\s*\{[^}]*font-size:31px/s);
  assert.match(css, /body\s*\{[^}]*font-size:16px/s);
  assert.match(css, /--paper:#f2f4f5/);
  assert.match(css, /--primary:#1d4b73/);
  assert.match(css, /--success:#2f6d59/);
  assert.match(css, /--accent:#f0a43b/);
  assert.doesNotMatch(css, /--green:#(?:28624c|174b3a|e1ebe4)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});

test("distinguishes screenshot reading from choosing a real location", async () => {
  const [app, { translate }] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    import("../src/i18n.js")
  ]);
  assert.match(app, /function renderExtraction\(\)/);
  assert.match(app, /function renderCandidates\(\)/);
  for (const locale of ["ja", "en", "zh-CN"]) {
    assert.notEqual(translate(locale, "extraction.title"), translate(locale, "candidate.singleHeading"));
  }
});

test("uses action-specific result labels and readable secondary reasons", async () => {
  const [app, css, resultActions] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/result-actions.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /function resultActionCopy\(action, restaurant\)/);
  assert.match(app, /resolveResultActionCopy\(action, restaurant\)/);
  assert.match(app, /actionCopy\.href/);
  assert.match(resultActions, /type === "phone" && href\.startsWith\("tel:"\)/);
  assert.match(app, /r\.booking \? \{ label: r\.booking\.label, url: r\.booking\.url, type: "open_booking_source" \}/);
  for (const type of ["phone", "map", "official_website", "discover_platform"]) assert.match(app, new RegExp(`type === "${type}"|\["map", "open_map"\]`));
  assert.match(css, /\.secondary-decision-card \.decision-details>summary,.secondary-decision-card \.decision-details>summary::marker \{ color:var\(--primary-strong\); \}/);
});

test("bumps the offline shell when core interface assets change", async () => {
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /const CACHE_NAME = "tabitabi-shell-v61"/);
});

test("keeps key stage headings and empty-input action available in all languages", async () => {
  const { translate } = await import("../src/i18n.js");
  for (const locale of ["ja", "en", "zh-CN"]) {
    for (const key of ["home.startEmpty", "extraction.title", "candidate.singleHeading", "result.actionMapHeading", "result.actionPhoneHeading"]) {
      assert.notEqual(translate(locale, key), key);
      assert.ok(translate(locale, key).trim());
    }
  }
});

test("keeps long restaurant identity copy from overflowing and uses a solid identity focus token", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [".candidate-copy", ".identity-summary", ".result-title"]) {
    assert.match(css, new RegExp(`${selector.replace(".", "\\.")}[^}]*min-width:0[^}]*overflow-wrap:anywhere`));
  }
  assert.match(css, /\.identity-editor summary:focus-visible[^}]*outline:3px solid var\(--focus\)/);
  assert.match(css, /\.image-method-footer \.privacy-note[^}]*color:var\(--muted-strong\)/);
});

test("keeps uncertain candidate actions neutral and success states distinct", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(app, /class="uncertain-button" data-edit-clues/);
  assert.match(css, /\.candidate-review-actions \.uncertain-button \{[^}]*color:var\(--muted-strong\)[^}]*background:var\(--surface-subtle\)/);
  assert.match(css, /\.business-status\.status-operational \{ background:var\(--success-soft\); color:var\(--success\); \}/);
});
