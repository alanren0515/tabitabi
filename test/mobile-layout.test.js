import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8")
]);

test("keeps the compact mobile shell readable and touch-sized", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /class="saved-icon"/);
  assert.match(html, /class="saved-label"/);
  assert.match(css, /--touch-target:44px/);
  assert.match(css, /\.saved-label \{ display:none; \}/);
  assert.match(css, /\.saved-link \{ width:var\(--touch-target\); min-width:var\(--touch-target\); height:var\(--touch-target\)/);
  assert.match(css, /input,textarea,select \{ font-size:16px; \}/);
});

test("uses mobile-first content density for the main workflows", () => {
  assert.match(app, /<details class="examples">/);
  assert.match(css, /\.reservation-option-grid \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.engagement-grid \{ grid-template-columns:repeat\(2,1fr\); \}/);
  assert.match(css, /\.input-card \{ padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; \}/);
  assert.doesNotMatch(css, /border-left:[2-9]px/);
});
