import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { translate } from "../src/i18n.js";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("keeps the home screen focused on input instead of explanatory panels", () => {
  assert.doesNotMatch(appSource, /<section class="promise-grid"/);
  assert.doesNotMatch(appSource, /<aside class="demo-banner/);
});

test("makes screenshots primary and restaurant-name input secondary on the homepage", () => {
  const homeStart = appSource.indexOf("function renderHome()");
  const homeEnd = appSource.indexOf("function renderUploadOptimizationStatus()");
  const homeSource = appSource.slice(homeStart, homeEnd);
  assert.ok(homeSource.indexOf("primary-input-method") < homeSource.indexOf("secondary-input-method"));
  assert.match(homeSource, /home\.imagePrimaryLabel/);
  assert.match(homeSource, /home\.imageMethodHint/);
  assert.match(homeSource, /input-method-divider/);
  assert.match(homeSource, /nameMethodContext/);
  assert.doesNotMatch(homeSource, /input-intro/);
  assert.doesNotMatch(homeSource, /home\.primaryBadge/);
  assert.match(homeSource, /id="upload-trigger"/);
  assert.match(homeSource, /home\.imagePrivacy/);
  assert.match(homeSource, /home\.nameMethod/);
  assert.match(homeSource, /home\.nameMethodSupplemental/);
  assert.match(homeSource, /<details class="input-method-card text-method supplemental-clue">/);
  assert.match(homeSource, /<summary><small class="method-kicker">\$\{nameMethodContext\}<\/small>\$\{t\("home\.nameMethod"\)\}<\/summary>/);
  assert.match(homeSource, /<label class="sr-only" for="clue">/);
  assert.doesNotMatch(homeSource, /home\.sources/);
  assert.doesNotMatch(homeSource, /home\.textMethod/);
  assert.match(appSource, /function homeSubmitLabel\(\)/);
  assert.match(appSource, /home\.startClue/);
  assert.match(homeSource, /id="analyze-submit-label">\$\{homeSubmitLabel\(\)\}/);
});

test("lands on the restaurant identity before actions unless reservation focus was requested", () => {
  assert.match(appSource, /const selector = state\.resultFocus === "reservation" \? "\.decision-grid" : "\.result-title"/);
  assert.match(appSource, /document\.querySelector\(selector\)\?\.scrollIntoView/);
});

test("associates screenshot errors with the primary upload control", () => {
  assert.match(appSource, /const uploadError = state\.analysisError && state\.analysisErrorTarget === "upload"/);
  assert.match(appSource, /id="upload-trigger"[^\n]*uploadError \? 'aria-invalid="true" aria-describedby="analysis-error"'/);
  assert.match(appSource, /state\.analysisErrorTarget = "upload"[^]*#upload-trigger/);
  assert.match(appSource, /const clueError = state\.analysisError && state\.analysisErrorTarget === "clue"/);
});

test("uses progressive disclosure through confirmation, result, and feedback", () => {
  assert.match(appSource, /<details class="review-more"/);
  assert.doesNotMatch(appSource, /<details class="review-more"[^>]*open/);
  assert.match(appSource, /<details class="candidate-evidence"/);
  assert.match(appSource, /<details class="decision-details"/);
  assert.match(appSource, /<details class="result-more"/);
  assert.match(appSource, /<details class="feedback-more"/);
});

test("requires only the helpfulness answer in the default feedback path", () => {
  assert.match(appSource, /name="helpful" value="yes" required/);
  assert.doesNotMatch(appSource, /name="bookingOutcome"[^>]*required/);
  assert.doesNotMatch(appSource, /name="accuracy"[^>]*required/);
  assert.match(appSource, /<button type="submit" disabled>/);
  assert.match(appSource, /\[name="helpful"\][^]*button\.disabled = false/);
});

test("ships the new novice-flow labels in all supported languages", () => {
  for (const locale of ["ja", "en", "zh-CN"]) {
    for (const key of ["review.more", "candidate.why", "result.why", "result.moreTitle", "result.otherActions", "result.chooseCandidate", "result.newSearch", "feedback.more", "result.actionMap", "result.currentStatus", "result.currentStatusOpen", "result.currentStatusClosed", "result.currentStatusUnknown", "home.imagePrimaryLabel", "home.nameMethodLabel", "home.nameMethodSupplemental", "home.nameMethod", "home.imageMethodHint", "home.imagePrivacy", "home.startScreenshot", "home.startName", "home.startClue"]) {
      assert.notEqual(translate(locale, key), key);
    }
  }
});

test("keeps candidate and result actions focused on one primary choice", () => {
  assert.doesNotMatch(appSource, /<button class="preview-button"/);
  assert.match(appSource, /<details class="action-more"/);
  assert.match(appSource, /<summary>\$\{t\("result\.otherActions"\)\}<\/summary>/);
  assert.match(appSource, /const mapUrl = safeExternalUrl\(r\.mapSearchUrl \|\| r\.googleMapsUri \|\| ""\)/);
  assert.match(appSource, /const resolvedPrimaryAction = resultActionCopy\(primaryAction, r\)/);
  assert.match(appSource, /const mapsIsPrimary = resolvedPrimaryAction\.type === "map"/);
  assert.match(appSource, /mapUrl !== "#" && !mapsIsPrimary/);
  assert.match(appSource, /className:"secondary-button map-action"/);
  assert.match(appSource, /displayedReservationOptions = reservationOptions\.filter\(\(option\) => option\.provider !== "google_maps"\)/);
  assert.ok(appSource.indexOf("renderCurrentOpeningStatus(r.currentOpeningHours)") < appSource.indexOf('<details class="action-more"'));
});

test("shows the decision before the prominent next action and retains reset-to-home", () => {
  assert.match(appSource, /class="result-nav"[^]*id="choose-another-candidate"[^]*result-home-button/);
  assert.match(appSource, /function returnToCandidates\(\)/);
  assert.match(appSource, /choose-another-candidate[^]*returnToCandidates/);
  assert.match(appSource, /function resetCurrentSearchState\(\)/);
  assert.match(appSource, /resetCurrentSearchState\(\);\s*state\.view = "home"/);
  assert.match(appSource, /state\.input = "";[^]*state\.textExtraction = null;[^]*state\.currentClues = \{\};/);
  assert.match(cssSource, /\.result-nav \{ display:flex;/);
  assert.doesNotMatch(cssSource, /\.result-view \.decision-grid \.action-card \{ order:-1; \}/);
  const resultRenderSource = appSource.slice(appSource.indexOf("function renderResult()"), appSource.indexOf("function focusResultSection()"));
  assert.ok(resultRenderSource.indexOf("renderResultDecisionCard(r)") < resultRenderSource.indexOf("renderResultActionCard(r"));
  assert.match(appSource, /class="decision-card secondary-decision-card/);
});

test("makes every new disclosure visibly interactive and touch-sized", () => {
  assert.match(cssSource, /details:not\(\[open\]\)>:not\(summary\) \{ display:none!important; \}/);
  for (const selector of ["candidate-evidence summary", "decision-details>summary", "action-more>summary", "feedback-more>summary", "review-more>summary"]) {
    assert.match(cssSource, new RegExp(`\\.${selector.replaceAll(".", "\\.")}[^}]*min-height:4[46]px`));
  }
  assert.match(cssSource, /summary::marker \{ color:/);
  assert.match(cssSource, /review-more>summary:focus-visible/);
});

test("keeps English and Chinese candidate guidance short without echoing long user input", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const key of ["candidate.singleSummary", "candidate.leadSummary", "candidate.uncertainSummary", "candidate.ambiguousSummary"]) {
      const copy = translate(locale, key, { input: "x".repeat(200) });
      assert.ok(copy.length < 80);
      assert.doesNotMatch(copy, /x{20}/);
    }
  }
});

test("names the recognized social platform in standalone-link guidance", () => {
  assert.match(appSource, /t\("link\.postTitle", \{ platform: esc\(parsedPlatformLabel\) \}\)/);
  for (const locale of ["ja", "en", "zh-CN"]) {
    assert.match(translate(locale, "link.postTitle", { platform: "TikTok" }), /TikTok/);
  }
});
