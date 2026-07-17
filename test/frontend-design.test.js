import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the home hierarchy compact and mobile-first", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(app, /class="hero-intro"/);
  assert.match(app, /class="hero-workbench"/);
  assert.match(app, /class="hero-route"/);
  assert.match(css, /\.hero\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /@media \(max-width:760px\)[^]*?\.hero h1\s*\{[^}]*font-size:31px/s);
  assert.match(css, /@media \(max-width:760px\)[^]*?\.hero-route\s*\{[^}]*display:none/s);
  assert.doesNotMatch(css, /\.hero h1\s*\{[^}]*72px/s);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});
