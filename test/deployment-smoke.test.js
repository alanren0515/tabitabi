import test from "node:test";
import assert from "node:assert/strict";
import { runDeploymentSmoke, validateSmokeImageMetadata } from "../server/deployment-smoke.mjs";

test("checks public production surfaces without consuming provider calls", async () => {
  const requested = [];
  const fetchImpl = async (url, options = {}) => {
    requested.push([new URL(url).pathname, options.method || "GET"]);
    const path = new URL(url).pathname;
    if (path === "/healthz") return Response.json({ status: "ok" });
    if (path === "/readyz") return Response.json({ ready: true });
    if (path === "/api/capabilities") return Response.json({ visionExtraction: true, placesSearch: true, pilotAccessRequired: true });
    if (path === "/src/app.js") return new Response("クローズドテスト参加者募集 予約の確定、支払い、電話は必要ありません メールで参加を相談する");
    return new Response('<main id="app"></main>', { headers: { "content-type": "text/html", "x-tabitabi-document": path.slice(1) } });
  };
  const result = await runDeploymentSmoke({ baseUrl: "https://tabitabi.example", allowedOrigin: "https://tabitabi.example", fetchImpl });
  assert.equal(result.passed, true);
  assert.deepEqual(requested, [["/healthz", "GET"], ["/readyz", "GET"], ["/api/capabilities", "GET"], ["/pilot", "GET"], ["/src/app.js", "GET"], ["/privacy", "GET"], ["/terms", "GET"]]);
});

test("requires an explicit screenshot before live Qwen and Places smoke", async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/healthz") return Response.json({ status: "ok" });
    if (path === "/readyz") return Response.json({ ready: true });
    if (path === "/api/capabilities") return Response.json({ visionExtraction: true, placesSearch: true, pilotAccessRequired: true });
    if (path === "/src/app.js") return new Response("クローズドテスト参加者募集 予約の確定、支払い、電話は必要ありません メールで参加を相談する");
    return new Response('<main id="app"></main>', { headers: { "x-tabitabi-document": path.slice(1) } });
  };
  await assert.rejects(() => runDeploymentSmoke({ baseUrl: "https://tabitabi.example", allowedOrigin: "https://tabitabi.example", live: true, fetchImpl }), /SMOKE_SCREENSHOT_PATH/);
});

test("live smoke sends the access code only to protected provider requests", async () => {
  const protectedRequests = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/healthz") return Response.json({ status: "ok" });
    if (path === "/readyz") return Response.json({ ready: true });
    if (path === "/api/capabilities") return Response.json({ visionExtraction: true, placesSearch: true, pilotAccessRequired: true });
    if (path === "/src/app.js") return new Response("クローズドテスト参加者募集 予約の確定、支払い、電話は必要ありません メールで参加を相談する");
    if (["/pilot", "/privacy", "/terms"].includes(path)) return new Response('<main id="app"></main>', { headers: { "x-tabitabi-document": path.slice(1) } });
    protectedRequests.push({ path, access: options.headers?.["X-Pilot-Access"] });
    if (path === "/api/extract-screenshot") return Response.json({ extraction: { restaurant: { name: "ホームズパスタ" } } });
    if (path === "/api/restaurants/search") return Response.json({ candidates: [{ name: "ホームズパスタ 上野店", placeId: "place-1" }] });
    return Response.json({ restaurant: { name: "ホームズパスタ 上野店", placeId: "place-1" } });
  };
  const result = await runDeploymentSmoke({
    baseUrl: "https://tabitabi.example",
    allowedOrigin: "https://tabitabi.example",
    accessCode: "secret-code",
    screenshotDataUrl: "data:image/png;base64,AA==",
    live: true,
    fetchImpl
  });
  assert.equal(result.passed, true);
  assert.deepEqual(protectedRequests, [
    { path: "/api/extract-screenshot", access: "secret-code" },
    { path: "/api/restaurants/search", access: "secret-code" },
    { path: "/api/restaurants/details", access: "secret-code" }
  ]);
});

test("rejects cleartext non-local deployment targets", async () => {
  await assert.rejects(() => runDeploymentSmoke({ baseUrl: "http://tabitabi.example" }), /requires HTTPS/);
});

test("rejects a production origin outside the explicit allowlist", async () => {
  await assert.rejects(() => runDeploymentSmoke({ baseUrl: "https://evil.example" }), /not the explicitly allowed/);
});

test("bounds live smoke screenshots before reading them", () => {
  assert.equal(validateSmokeImageMetadata({ extension: ".png", size: 1024 }), "image/png");
  assert.throws(() => validateSmokeImageMetadata({ extension: ".heic", size: 1024 }), /PNG, JPEG, or WebP/);
  assert.throws(() => validateSmokeImageMetadata({ extension: ".png", size: 8 * 1024 * 1024 + 1 }), /8 MB/);
});

test("requires route-specific pilot, privacy, and terms markers", async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/healthz") return Response.json({ status: "ok" });
    if (path === "/readyz") return Response.json({ ready: true });
    if (path === "/api/capabilities") return Response.json({ visionExtraction: true, placesSearch: true, pilotAccessRequired: true });
    return new Response('<main id="app"></main>');
  };
  await assert.rejects(() => runDeploymentSmoke({ baseUrl: "https://tabitabi-jp.fly.dev", fetchImpl }), /independent|独立/u);
});
