import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps labeled input routes before submission and readable theme contrast", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(app, /class="hero-intro"/);
  assert.match(app, /class="hero-workbench"/);
  assert.doesNotMatch(app, /class="hero-route"/);
  assert.match(app, /home\.startEmpty/);
  const home = app.slice(app.indexOf("function renderHome()"), app.indexOf("async function attachScreenshotFile"));
  assert.match(home, /aria-labelledby="image-method-title"/);
  assert.match(home, /for="clue"/);
  assert.ok(home.indexOf('id="image-method-title"') < home.indexOf('id="analyze-submit-label"'));
  assert.ok(home.indexOf('for="clue"') < home.indexOf('id="analyze-submit-label"'));
  const tokens = Object.fromEntries([...css.match(/:root\s*\{([^]*?)\}/)[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
  const luminance = hex => {
    const rgb = hex.replace("#", "").match(/../g).map(part => parseInt(part, 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [foreground, background, minimum] of [
    ["ink", "paper", 4.5], ["muted", "paper", 4.5], ["subtle", "card", 4.5],
    ["primary", "card", 4.5], ["amber", "surface-warning", 4.5],
    ["red", "surface-danger", 4.5], ["control-border", "card", 3], ["focus", "paper", 3]
  ]) {
    const [light, dark] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => b - a);
    assert.ok((light + .05) / (dark + .05) >= minimum, `${foreground} on ${background} needs ${minimum}:1 contrast`);
  }
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

test("moves the redesigned interface beyond the previous offline shell", async () => {
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const version = Number(sw.match(/const CACHE_NAME = "tabitabi-shell-v(\d+)"/)?.[1]);
  assert.ok(version > 85, "the redesigned assets must not reuse the previous v85 cache");
  assert.match(sw, /key !== CACHE_NAME/);
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
