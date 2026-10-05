import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequestCostTracker } from "../server/request-costs.mjs";
import { createRequestCache } from "../server/request-cache.mjs";
import { estimateAttemptCost, priceForAttempt, validateCostPrices } from "../server/cost-prices.mjs";
import { summarizeRequestCosts } from "../server/cost-summary.mjs";
import { extractScreenshotWithFallback } from "../server/vision-extraction.mjs";
import { searchHotPepper, searchGooglePlaces } from "../server/restaurant-sources.mjs";
import { sampleTikTokExtraction } from "../src/screenshot-extraction.js";
import { costFixture, FIXTURE_PRICES, FIXTURE_TIME } from "../eval/costs/fixture.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const meta = { provider: "google_places", operation: "text_search", sku: "text_search_pro" };
function setup() {
  const records = [];
  const tracker = createRequestCostTracker({ append: record => records.push(record), prices: FIXTURE_PRICES, now: () => Date.parse(FIXTURE_TIME) });
  const owner = tracker.context({ analysisRunId: randomUUID(), releaseRevision: "a".repeat(40), trafficType: "product", sourceMode: "live" });
  return { records, tracker, owner };
}

test("versions are exclusive, effective intervals are half open and absent prices stay unknown", () => {
  validateCostPrices(FIXTURE_PRICES);
  const first = FIXTURE_PRICES[0];
  assert.equal(priceForAttempt(FIXTURE_PRICES, first.provider, first.sku, first.effectiveFrom).version, first.version);
  assert.equal(priceForAttempt(FIXTURE_PRICES, first.provider, first.sku, first.effectiveUntil), null);
  assert.equal(estimateAttemptCost(null, {inputTokens:0,outputTokens:0}).amount, null);
  assert.throws(() => validateCostPrices([first, {...first,version:"overlap"}]), /OVERLAPPING/);
  assert.throws(() => validateCostPrices([{...first,perRequest:-1}]), /INVALID/);
  assert.throws(() => validateCostPrices([first,first]), /INVALID/);
  const p = FIXTURE_PRICES[3];
  assert.equal(estimateAttemptCost(p,{inputTokens:1000,outputTokens:200}).reason, "usage_unknown");
  assert.equal(estimateAttemptCost(p,{inputTokens:1000,outputTokens:200,cachedInputTokens:500}).amount, 0.0032);
  assert.equal(estimateAttemptCost(p,{inputTokens:1000,outputTokens:200,cachedInputTokens:1001}).amount, null);
});

test("concurrent loaders record one owner, beneficiary receipts and no new attempt on cache hit", async () => {
  const { tracker, records, owner } = setup(); const cache = createRequestCache();
  let release; const fetchImpl = () => new Promise(resolve => { release = resolve; });
  const load = who => tracker.cached(cache, "private-query", who, "text_search", async loadId => {
    const response = await tracker.trackedFetch(who,{...meta,loadId},fetchImpl)("https://private.invalid",{body:"secret-text"});
    return response.json();
  });
  const first = load(owner);
  await new Promise(resolve => setImmediate(resolve));
  const other = tracker.context({ interactionId: randomUUID(), trafficType: "audit" });
  const second = load(other);
  release(json({result:"private restaurant"})); await Promise.all([first,second]); await load(other);
  const starts = records.filter(x=>x.recordType==="attempt_started");
  assert.equal(starts.length,1); assert.equal(starts[0].analysisRunId,owner.analysisRunId);
  assert.deepEqual(records.filter(x=>x.recordType==="cache_access").map(x=>x.cacheStatus).sort(),["coalesced","hit","miss"]);
  assert.equal(new Set(records.map(x=>x.loadId)).size,1);
  const report = summarizeRequestCosts(records);
  assert.equal(report.observedAttempts,1); assert.equal(report.cache.deliveredWithoutNewLoad,2);
  assert.equal(report.currencies.USD.knownListPriceSubtotal,0.1);
  assert.equal(JSON.stringify(records).includes("private"),false);
  assert.equal(JSON.stringify(records).includes("secret-text"),false);
});

test("failed coalesced requests charge only one attempted dispatch and stay in totals", async () => {
  const { tracker, records, owner } = setup(); const cache = createRequestCache(); let fail;
  const load = () => tracker.cached(cache,"key",owner,"text_search", loadId => tracker.trackedFetch(owner,{...meta,loadId},()=>new Promise((_,reject)=>{fail=reject;}))("url",{}));
  const a=load(); await new Promise(resolve=>setImmediate(resolve)); const b=load();
  const settled=Promise.allSettled([a,b]); fail(new Error("secret error body")); await settled;
  const report=summarizeRequestCosts(records);
  assert.equal(report.observedAttempts,1); assert.equal(report.transportFailedAttempts,1);
  assert.equal(report.cache.coalescedFailures,1); assert.equal(report.cache.deliveredWithoutNewLoad,0);
  assert.equal(JSON.stringify(records).includes("secret error"),false);
});

test("actual Hot Pepper fallback searches each record an attempt; validation or budget rejection creates none", async () => {
  const {tracker,records,owner}=setup();
  const fetchImpl=tracker.trackedFetch(owner,{provider:"hotpepper",operation:"shop_search",sku:"gourmet_api"},async()=>json({results:{shop:[]}}));
  await searchHotPepper({name:"fixture",address:"東京都千代田区1",phone:"03-1111-1111",apiKey:"stub",fetchImpl});
  assert.equal(summarizeRequestCosts(records).observedAttempts,3);
  await assert.rejects(searchHotPepper({name:"fixture",apiKey:"stub",fetchImpl,beforeRequest:async()=>{throw new Error("budget");}}));
  await assert.rejects(searchGooglePlaces({query:"",apiKey:"stub",fetchImpl:tracker.trackedFetch(owner,meta,async()=>json({}))}));
  assert.equal(summarizeRequestCosts(records).observedAttempts,3);
});

test("vision schema failure retains provider usage and both model attempts without replay on cache", async () => {
  const {tracker,records,owner}=setup(); let provider;
  const bytes=Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write("IHDR",12);bytes.writeUInt32BE(800,16);bytes.writeUInt32BE(1200,20);
  const result=await extractScreenshotWithFallback({imageDataUrl:`data:image/png;base64,${bytes.toString("base64")}`,
    env:{DASHSCOPE_API_KEY:"stub",OPENAI_API_KEY:"stub",QWEN_VISION_MODEL:"fixture-model",OPENAI_VISION_MODEL:"fixture-model"},
    beforeProviderAttempt:async p=>{provider=p;},
    fetchImpl:tracker.trackedFetch(owner,()=>({provider:provider.name,operation:"screenshot_extraction",sku:"fixture-model",fallback:provider.name==="openai"}),async()=> provider.name==="qwen"
      ? json({choices:[{message:{content:"{}"}}],usage:{prompt_tokens:1000,completion_tokens:200}})
      : json({output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(sampleTikTokExtraction)}]}],usage:{input_tokens:1000,output_tokens:200,input_tokens_details:{cached_tokens:0}}}))});
  assert.equal(result.attempts[0].status,"error");
  const report=summarizeRequestCosts(records);
  assert.equal(report.observedAttempts,2);assert.equal(report.fallbackAttempts,1);assert.equal(report.unknownCostAttempts,0);
  assert.ok(Math.abs(report.currencies.USD.knownListPriceSubtotal-0.007)<1e-12);
});

test("write failure does not repeat upstream work and reports fixed error codes", async () => {
  const failures=[]; let calls=0;
  const tracker=createRequestCostTracker({append:async()=>{throw new Error("private path");},onWriteError:code=>failures.push(code)});
  const response=await tracker.trackedFetch({},meta,async()=>{calls++;return json({});})("url",{});
  assert.equal(response.status,200);assert.equal(calls,1);assert.deepEqual(failures,["COST_LOG_WRITE_FAILED","COST_LOG_WRITE_FAILED"]);
});

test("summary deduplicates, separates currencies and audit costs, and refuses incomplete zero totals", () => {
  const records=costFixture(); const baseline=summarizeRequestCosts(records);
  assert.equal(baseline.observedAttempts,4);assert.equal(baseline.unknownCostAttempts,1);
  assert.equal(baseline.completeEstimateForObservedAttempts,false);assert.equal(baseline.currencies.JPY.knownListPriceSubtotal,2);
  assert.equal(baseline.breakdown.find(x=>x.trafficType==="audit").attempts,1);
  assert.equal(baseline.tokyoDays["2026-10-03"].attempts,4);
  assert.equal(summarizeRequestCosts([...records,...structuredClone(records)]).observedAttempts,4);
  const partial=records.filter(x=>x.recordType!=="attempt_finished");
  assert.equal(summarizeRequestCosts(partial).unknownCostAttempts,4);
  assert.equal(summarizeRequestCosts([]).completeEstimateForObservedAttempts,false);
  const duplicate=structuredClone(records[1]); duplicate.sku="different";
  assert.equal(summarizeRequestCosts([...records,duplicate]).conflictingAttempts,1);
  for (const record of records) {
    for (const key of ["requestId","analysisRunId","httpOperationId","loadId"]) if(record[key]) assert.equal(JSON.stringify(baseline).includes(record[key]),false);
  }
});

test("CLI defaults to synthetic evidence and explicit file read errors reveal no path", () => {
  const result=spawnSync(process.execPath,["scripts/summarize-request-costs.mjs"],{encoding:"utf8"});
  assert.equal(result.status,0);const report=JSON.parse(result.stdout);
  assert.equal(report.evidenceType,"fixture_only");assert.equal(report.realWorldEvidence,false);
  const bad=spawnSync(process.execPath,["scripts/summarize-request-costs.mjs","--input","/private-file-does-not-exist"],{encoding:"utf8"});
  assert.equal(bad.status,1);assert.equal(bad.stderr.includes("private-file"),false);
});
