import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

test("manual emergency stop blocks paid routes while the application remains routable", async (t) => {
  let port;
  try { port = await availablePort(); }
  catch (error) {
    if (error?.code === "EPERM") { t.skip("local network listeners are blocked in this sandbox"); return; }
    throw error;
  }
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      PAID_API_EMERGENCY_STOP: "true",
      PILOT_ACCESS_CODE: "integration-test-access-code-1234",
      DASHSCOPE_API_KEY: "not-called",
      DASHSCOPE_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      QWEN_VISION_MODEL: "qwen3.6-flash",
      GOOGLE_MAPS_API_KEY: "not-called",
      PUBLIC_OPERATOR_NAME: "Test",
      PUBLIC_CONTACT_EMAIL: "test@example.com"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(child, port);
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/readyz`)).status, 200);
    const capabilities = await (await fetch(`${origin}/api/capabilities`)).json();
    assert.equal(capabilities.emergencyStop, true);
    assert.equal((await fetch(`${origin}/privacy`)).status, 200);
    for (const path of ["/api/extract-screenshot", "/api/restaurants/search", "/api/restaurants/details"]) {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pilot-Access": "integration-test-access-code-1234" },
        body: "{}"
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "PAID_API_EMERGENCY_STOP");
    }
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => {});
    }
  }
});

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(child, port) {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    if (child.exitCode !== null) throw new Error("Test server exited before listening");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch { /* Retry until startup timeout. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Timed out waiting for test server");
}
