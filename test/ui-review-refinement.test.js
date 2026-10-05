import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resultLinkHtml } from "../src/result-actions.js";
import { savedListHtml, queueListHtml, taskListActions, taskNavigationHtml } from "../src/local-task-ui.js";
import { taskCopy } from "../src/task-copy.js";
import { translate } from "../src/i18n.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const helpers = { esc, tx:key=>taskCopy("ja",key), t:(key,vars)=>translate("ja",key,vars), formatTime:()=>"日時" };
const empty = { saved:[], savedSearch:"", pending:[], localUndo:null };

test("sample result destinations cannot dial, navigate or open another tab", () => {
  for (const href of ["tel:+81-75-000-3306", "https://example.com/booking", "https://maps.google.com/"]) {
    const html = resultLinkHtml({href,labelHtml:"操作",id:"primary-action",actionType:"phone",example:true});
    assert.match(html, /<button type="button" data-example-action/);
    assert.match(html, /aria-describedby="example-action-status"/);
    assert.doesNotMatch(html, /href=|target=|<a\b|tel:|https:/);
  }
  const app = readFile(new URL("../src/app.js",import.meta.url),"utf8");
  return app.then(source => assert.match(source, /querySelectorAll\("\.result-view a\[href\]"\)/));
});

test("live links retain safe phone and web behavior with escaped attributes", () => {
  const phone=resultLinkHtml({href:"tel:+81312345678",labelHtml:"電話",actionType:"phone"});
  assert.match(phone, /href="tel:\+81312345678"/);
  assert.doesNotMatch(phone, /target=|data-example-action/);
  const web=resultLinkHtml({href:"https://example.com/",labelHtml:"予約",id:'x" onload="bad'});
  assert.match(web, /target="_blank" rel="noreferrer"/);
  assert.match(web, /id="x&amp;quot;|id="x&quot;/);
  assert.doesNotMatch(resultLinkHtml({href:"javascript:alert(1)",labelHtml:"無効"}), /href="javascript:/);
});

test("empty saved list teaches saving without useless search or management", () => {
  const html=savedListHtml(empty,helpers);
  assert.match(html, /data-action="home"/);
  assert.match(html, /結果の「予定を保存」/);
  assert.doesNotMatch(html, /id="saved-search-form"|data-export-domain|data-clear-domain|data-undo-domain/);
});

test("no search matches is different from having no saved restaurants", () => {
  const state={...empty,saved:[{id:"record",name:"寿司",partySize:2}],savedSearch:"ラーメン"};
  const html=savedListHtml(state,helpers);
  assert.match(html, /一致する記録がありません/);
  assert.match(html, /data-reset-saved-search/);
  assert.match(html, /id="saved-search-form"/);
  assert.doesNotMatch(html, /まだ保存した店舗はありません/);
});

test("management preserves undo and storage recovery even when visible list is empty", () => {
  assert.equal(taskListActions("saved",helpers), "");
  const undo=taskListActions("saved",{...helpers,canUndo:true});
  assert.match(undo,/data-undo-domain="saved"/);
  assert.doesNotMatch(undo,/data-clear-domain|data-export-domain/);
  const recovery=taskListActions("saved",{...helpers,needsRecovery:true});
  assert.match(recovery,/data-export-domain="saved"/);
  assert.match(recovery,/data-clear-domain="saved"/);
  assert.match(taskListActions("saved",{...helpers,count:1}),/<details class="task-management">/);
});

test("empty queue offers one restaurant and progressively discloses bulk preparation", () => {
  const html=queueListHtml(empty,helpers);
  assert.match(html,/確認待ちの店舗はありません/);
  assert.match(html,/<details class="batch-entry"><summary>/);
  assert.match(html,/id="batch-queue-form"/);
  assert.doesNotMatch(html,/data-clear-finished|data-clear-domain|data-export-domain/);
  const completed=queueListHtml({...empty,pending:[{id:"one",status:"completed",draft:{clues:{name:"寿司"}}}]},helpers);
  assert.match(completed,/data-clear-finished/);
  assert.match(completed,/確認待ちの店舗はありません/);
  assert.doesNotMatch(completed,/data-open-pending="one"/);
});

test("unreadable lists never assert that original records are empty", () => {
  for (const html of [savedListHtml(empty,{...helpers,needsRecovery:true}), queueListHtml(empty,{...helpers,needsRecovery:true})]) {
    assert.match(html,/記録を読み取れません/);
    assert.doesNotMatch(html,/まだ保存した店舗はありません|確認待ちの店舗はありません/);
    assert.match(html,/data-export-domain/);
  }
});

test("a stale search does not disguise the truly empty saved list", () => {
  const html=savedListHtml({...empty,savedSearch:"寿司"},helpers);
  assert.match(html,/まだ保存した店舗はありません/);
  assert.doesNotMatch(html,/一致する記録がありません|saved-search-form/);
});

test("same-view list rerenders restore focus rather than leaving removed nodes", async () => {
  const app=await readFile(new URL("../src/app.js",import.meta.url),"utf8");
  assert.match(app,/listFocus && !previousFocus.isConnected/);
  assert.match(app,/fallback.focus\(\{ preventScroll: true \}\)/);
  assert.match(app,/localData.recent.status !== "ready" \? taskRecoveryHtml/);
});

test("task navigation and risk/state language exist in all three languages", () => {
  for (const locale of ["ja","en","zh-CN"]) {
    for (const key of ["navLabel","navQueue","navSaved","navHistory","manageList","savedEmptyBody","noSearchResults","queueEmptyTitle","exampleActionBody","exampleActionDone","actionBoundary","uncertainBoundary"]) {
      assert.notEqual(taskCopy(locale,key),key);
    }
    const nav=taskNavigationHtml("queue",{tx:key=>taskCopy(locale,key)});
    assert.match(nav,/data-action="queue" aria-current="page"/);
  }
  assert.doesNotMatch(translate("ja","result.unknown"),/確認中/);
  assert.doesNotMatch(translate("ja","home.queueTitle"),/画像/);
  assert.doesNotMatch(translate("en","home.queueTitle"),/image/);
  assert.doesNotMatch(translate("zh-CN","home.queueTitle"),/图片/);
});

test("risk confidence remains fully opaque and saving is not hidden under other actions", async () => {
  const [app,css]=await Promise.all([readFile(new URL("../src/app.js",import.meta.url),"utf8"),readFile(new URL("../src/styles.css",import.meta.url),"utf8")]);
  assert.match(css,/\.status-row \{[^}]*opacity:1;/);
  assert.match(css,/\.home-landing ~ \.recent-preview/);
  assert.doesNotMatch(css,/\.home-landing \+ \.recent-preview/);
  const action=app.slice(app.indexOf("function renderResultActionCard"),app.indexOf("function resultActionCopy"));
  assert.ok(action.indexOf('id="save-button"')<action.indexOf('<details class="action-more"'));
  assert.ok(action.indexOf('class="action-boundary"')<action.indexOf('id:"primary-action"'));
  assert.doesNotMatch(app,/<ol class="route-steps"/);
  const labels=app.slice(app.indexOf("function localizedRecommendationLabel"),app.indexOf("function localizedConfidenceLabel"));
  assert.doesNotMatch(labels,/return recommendationLabel/);
  assert.match(labels,/unknown: t\("result.unknown"\)/);
});
