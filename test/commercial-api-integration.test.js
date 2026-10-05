import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("protected v2 HTTP flow survives restart and withdrawal without provider network calls", async (t) => {
  let port;
  try {
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    port = socket.address().port;
    await new Promise((done) => socket.close(done));
  } catch (error) {
    if (error.code === "EPERM") { t.skip("local listeners are blocked by the sandbox"); return; }
    throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-commercial-api-"));
  const preload = join(directory, "provider-stub.mjs");
  await writeFile(preload, `
    const place = { id: 'fixture-place', displayName: { text: '検証食堂' }, formattedAddress: '東京都千代田区', businessStatus: 'OPERATIONAL', primaryTypeDisplayName: { text: 'レストラン' }, googleMapsUri: 'https://maps.google.com/?cid=fixture' };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('dashscope') || url === 'https://api.openai.com/v1/responses') return new Response(JSON.stringify({ error: { code: 'fixture_5xx' } }), { status: 500 });
      if (url === 'https://places.googleapis.com/v1/places:searchText') return new Response(JSON.stringify({ places: [place] }), { status: 200 });
      if (url.startsWith('https://places.googleapis.com/v1/places/fixture-place?')) return new Response(JSON.stringify(place), { status: 200 });
      throw new Error('External network is disabled in this test');
    };
  `);
  let child;
  async function stop() {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, ["--import", preload, fileURLToPath(new URL("../server.mjs", import.meta.url))], {
      cwd: directory,
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), RELEASE_REVISION: "a".repeat(40), PILOT_ACCESS_CODE: "local-test-access-only-123456789", GOOGLE_MAPS_API_KEY: "stub-only-no-network", DASHSCOPE_API_KEY: "stub-only-no-network", OPENAI_API_KEY: "stub-only-no-network", PAID_API_EMERGENCY_STOP: "false" },
      stdio: "ignore"
    });
    for (let index = 0; index < 150; index++) {
      if (child.exitCode !== null) throw new Error("Test server exited before ready");
      try { if ((await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(200) })).ok) return; } catch { /* Startup. */ }
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Test server did not become ready");
  }
  async function post(path, body, headers = {}, authorized = true) {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: {
      "Content-Type": "application/json", ...(authorized ? { "X-Pilot-Access": "local-test-access-only-123456789" } : {}), ...headers
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get("cache-control") };
  }
  await start();
  for (const path of ["/api/events", "/api/measurement-flows", "/api/research-consent", "/api/price-signals"]) assert.equal((await post(path, {}, {}, false)).status, 401);
  const offerConfig=await (await fetch(origin+"/api/offers")).json();
  assert.equal(offerConfig.enabled,false);
  assert.deepEqual(offerConfig.offers,[]);
  assert.equal((await post("/api/price-signals",{schemaVersion:1,offerId:"fixture",offerVersion:"v1",choice:"interested",sourceContext:"completed_analysis"})).status,410);
  assert.equal((await post("/api/price-signals",{schemaVersion:1,offerId:"fixture",offerVersion:"v1",choice:"interested",sourceContext:"completed_analysis",email:"must-not-persist@example.invalid"})).status,400);
  await assert.rejects(readFile(join(directory,"data","price-signals.jsonl")),error=>error.code==="ENOENT");
  const sessionId = randomUUID();
  const registered = await post("/api/measurement-flows", { kind: "analysis", inputType: "text", sessionId, sourceMode: "live" });
  assert.equal(registered.status, 200);
  assert.equal(registered.cacheControl, "no-store");
  const parent = registered.body;
  const headers = { "X-Measurement-Flow": parent.flowId, "X-Measurement-Token": parent.token };
  const event = { schemaVersion: 2, eventId: randomUUID(), event: "input_submitted", sessionId, analysisRunId: parent.analysisRunId, sourceMode: "live" };
  assert.equal((await post("/api/events", event, headers)).status, 202);
  assert.equal((await post("/api/events", { ...event, eventId: randomUUID(), event: "analysis_completed" }, headers)).status, 409);
  assert.equal((await post("/api/extract-text", { text: "検証食堂 東京" }, headers)).status, 200);
  assert.equal((await post("/api/restaurants/search", { query: "検証食堂" }, headers)).status, 200);
  assert.equal((await post("/api/restaurants/details", { placeId: "fixture-place" }, headers)).status, 200);
  assert.equal((await post("/api/restaurants/candidate-preview", { placeId: "fixture-place" }, headers)).body.cacheStatus, "hit");
  const readCosts = async () => (await readFile(join(directory, "data/request-costs.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  let costs = await readCosts();
  assert.equal(costs.filter(item => item.recordType === "attempt_started").length, 2);
  assert.ok(costs.filter(item => item.recordType === "attempt_started").every(item => item.analysisRunId === parent.flowId && item.attributionStatus === "verified_flow"));
  assert.equal(costs.find(item => item.recordType === "cache_access" && item.operation === "candidate_preview").cacheStatus, "hit");
  assert.ok(costs.filter(item => item.recordType === "attempt_finished").every(item => item.estimate.reason === "price_unknown"));
  assert.equal((await fetch(`${origin}/data/request-costs.jsonl`)).status, 404);
  assert.equal(JSON.stringify(costs).includes(parent.token), false);
  assert.equal(JSON.stringify(costs).includes("検証食堂"), false);
  const grant = { consentVersion: "research-v1", state: "accepted", deviceId: randomUUID(), token: randomBytes(32).toString("base64url"), requestedAt: new Date().toISOString() };
  assert.equal((await post("/api/research-consent", grant)).status, 200);
  const completed = { ...event, eventId: randomUUID(), event: "analysis_completed", research: grant };
  const receipts = await Promise.all(Array.from({ length: 5 }, () => post("/api/events", completed, headers)));
  assert.ok(receipts.every((receipt) => receipt.status === 202));
  assert.equal(receipts.filter((receipt) => !receipt.body.duplicate).length, 1);
  let state = JSON.parse(await readFile(join(directory, "data/commercial-state.json"), "utf8"));
  assert.equal(state.events.length, 2);
  assert.ok(state.events.every((item) => item.record.sourceMode === "live"));
  assert.equal(state.researchLinks.length, 1);
  assert.equal((await fetch(`${origin}/data/commercial-state.json`)).status, 404);
  await stop(); await start();
  assert.equal((await post("/api/events", completed, headers)).body.duplicate, true);
  assert.equal((await post("/api/research-consent", { ...grant, state: "revoked" })).status, 200);
  assert.equal((await post("/api/events", completed, headers)).body.researchLinked, false);
  assert.equal((await post("/api/research-consent", grant)).status, 409);
  assert.equal((await post("/api/events", { event: "feedback_submitted", feedbackText: "legacy fixture" })).status, 202);
  assert.equal((await post("/api/events", { ...event, schemaVersion: 3 })).status, 400);
  const legacy = (await readFile(join(directory, "data/events.jsonl"), "utf8")).trim().split("\n");
  assert.equal(legacy.length, 1);
  state = JSON.parse(await readFile(join(directory, "data/commercial-state.json"), "utf8"));
  assert.equal(state.events.length, 2);
  assert.equal(state.researchLinks.length, 0);
  assert.equal(JSON.stringify(state).includes(grant.deviceId), false);

  for (const text of ["検証食堂 東京 https://example.test/restaurant", "検証食堂 東京 https://www.tablecheck.com/ja/shops/fixture/reserve"]) {
    const linked = (await post("/api/measurement-flows", { kind: "analysis", inputType: "webpage", sessionId: randomUUID() })).body;
    const linkedHeaders = { "X-Measurement-Flow": linked.flowId, "X-Measurement-Token": linked.token };
    const submitted = { schemaVersion: 2, eventId: randomUUID(), event: "input_submitted", sessionId: linked.sessionId, analysisRunId: linked.analysisRunId };
    assert.equal((await post("/api/events", submitted, linkedHeaders)).status, 202);
    const parsed = await post("/api/extract-text", { text }, linkedHeaders);
    assert.equal(parsed.body.kind, "text_clues");
    assert.equal(parsed.body.requiresWebpage, false);
    assert.equal((await post("/api/restaurants/search", { query: parsed.body.searchQuery }, linkedHeaders)).status, 200);
    assert.equal((await post("/api/restaurants/candidate-preview", { placeId: "fixture-place" }, linkedHeaders)).status, 200);
    assert.equal((await post("/api/restaurants/details", { placeId: "fixture-place" }, linkedHeaders)).status, 200);
    assert.equal((await post("/api/events", { ...submitted, eventId: randomUUID(), event: "analysis_completed" }, linkedHeaders)).status, 202);
    state = JSON.parse(await readFile(join(directory, "data/commercial-state.json"), "utf8"));
    assert.ok(state.events.filter(item => item.record.analysisRunId === linked.flowId).every(item => item.record.sourceMode === "live"));
    costs = await readCosts();
    assert.ok(costs.some(item => item.operation === "candidate_preview" && item.analysisRunId === linked.flowId && item.attributionStatus === "verified_flow"));
  }
  const onlyLink = (await post("/api/measurement-flows", { kind: "analysis", inputType: "webpage", sessionId: randomUUID() })).body;
  const onlyHeaders = { "X-Measurement-Flow": onlyLink.flowId, "X-Measurement-Token": onlyLink.token };
  const onlyEvent = { schemaVersion: 2, eventId: randomUUID(), event: "input_submitted", sessionId: onlyLink.sessionId, analysisRunId: onlyLink.analysisRunId };
  assert.equal((await post("/api/events", onlyEvent, onlyHeaders)).status, 202);
  assert.equal((await post("/api/extract-text", { text: "https://www.tablecheck.com/ja/shops/fixture/reserve" }, onlyHeaders)).body.kind, "reservation_link");
  assert.equal((await post("/api/events", { ...onlyEvent, eventId: randomUUID(), event: "analysis_completed" }, onlyHeaders)).status, 409);
  assert.equal((await post("/api/events", { ...onlyEvent, eventId: randomUUID(), event: "analysis_failed", failureStage: "input" }, onlyHeaders)).status, 202);
  state = JSON.parse(await readFile(join(directory, "data/commercial-state.json"), "utf8"));
  assert.ok(state.events.filter(item => item.record.analysisRunId === onlyLink.flowId).every(item => item.record.sourceMode === "live"));

  const failedFlow = (await post("/api/measurement-flows", { kind: "analysis", inputType: "text", sessionId: randomUUID() })).body;
  const failedHeaders = { "X-Measurement-Flow": failedFlow.flowId, "X-Measurement-Token": failedFlow.token };
  const failedInput = { schemaVersion: 2, eventId: randomUUID(), event: "input_submitted", sessionId: failedFlow.sessionId, analysisRunId: failedFlow.analysisRunId };
  assert.equal((await post("/api/events", failedInput, failedHeaders)).status, 202);
  assert.equal((await post("/api/extract-text", { text: "" }, failedHeaders)).status, 400);
  assert.equal((await post("/api/events", { ...failedInput, eventId: randomUUID(), event: "analysis_failed", failureStage: "input" }, failedHeaders)).status, 202);
  state = JSON.parse(await readFile(join(directory, "data/commercial-state.json"), "utf8"));
  const failedRecords = state.events.filter((item) => item.record.analysisRunId === failedFlow.flowId);
  assert.equal(failedRecords.length, 2);
  assert.ok(failedRecords.every((item) => item.record.sourceMode === "live"));
  assert.equal(failedRecords.some((item) => item.record.event === "analysis_completed"), false);
  const auditFlow = (await post("/api/measurement-flows", { kind: "analysis", inputType: "screenshot", sessionId: randomUUID(), trafficType: "audit" })).body;
  const image = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(image); image.write("IHDR",12); image.writeUInt32BE(800,16); image.writeUInt32BE(1200,20);
  assert.ok((await post("/api/extract-screenshot", { imageDataUrl: `data:image/png;base64,${image.toString("base64")}` },
    { "X-Measurement-Flow": auditFlow.flowId, "X-Measurement-Token": auditFlow.token })).status >= 500);
  costs = await readCosts();
  const visionCosts = costs.filter(item => item.recordType === "attempt_finished" && item.operation === "screenshot_extraction");
  assert.deepEqual(visionCosts.map(item => item.provider), ["qwen", "openai"]);
  assert.ok(visionCosts.every(item => item.trafficType === "audit" && item.analysisRunId === auditFlow.flowId && item.transportStatus === "http_error"));
  assert.equal(visionCosts[1].fallback, true);
  assert.equal(JSON.stringify(costs).includes(image.toString("base64")), false);
  await writeFile(join(directory, "data/commercial-state.json"), "broken measurement state");
  assert.equal((await post("/api/extract-text", { text: "検証食堂 東京" }, failedHeaders)).status, 200);
  assert.equal((await post("/api/events", { ...failedInput, eventId: randomUUID() }, failedHeaders)).status, 503);
  assert.equal(await readFile(join(directory, "data/commercial-state.json"), "utf8"), "broken measurement state");
});
