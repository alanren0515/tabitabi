import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { browserSecurityHeaders } from "../server/http-headers.mjs";
import { resolveStaticFile } from "../server/static-path.mjs";

const ROOT = resolve(process.cwd());

test("production image contains the complete PWA shell and a writable runtime directory", async () => {
  const dockerfile = await readFile(resolve(ROOT, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM node:22\.17\.0-alpine3\.22@sha256:[a-f0-9]{64}/m);
  assert.match(dockerfile, /COPY --chown=node:node index\.html manifest\.webmanifest server\.mjs sw\.js \.\//);
  assert.match(dockerfile, /COPY --chown=node:node assets \.\/assets/);
  assert.match(dockerfile, /COPY --chown=node:node src \.\/src/);
  assert.match(dockerfile, /RUN mkdir -p \/app\/data && chown node:node \/app\/data/);
  assert.match(dockerfile, /\/readyz/);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK[^]*\/healthz/);
  assert.ok(dockerfile.indexOf("RUN mkdir -p /app/data") < dockerfile.indexOf("USER node"));
  assert.doesNotMatch(dockerfile, /audit\.html/);
});

test("Fly pilot deployment stays single-region and stops idle compute", async () => {
  const config = await readFile(resolve(ROOT, "fly.toml"), "utf8");
  assert.match(config, /primary_region = "nrt"/);
  assert.match(config, /source = "tabitabi_data"/);
  assert.match(config, /destination = "\/app\/data"/);
  assert.match(config, /scheduled_snapshots = true/);
  assert.match(config, /snapshot_retention = 7/);
  assert.match(config, /auto_start_machines = true/);
  assert.match(config, /auto_stop_machines = "stop"/);
  assert.match(config, /min_machines_running = 0/);
  assert.match(config, /size = "shared-cpu-1x"/);
  assert.match(config, /memory = "512mb"/);
});

test("browser security policy allows only the app's required external assets", () => {
  const headers = browserSecurityHeaders();
  const csp = headers["Content-Security-Policy"];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /font-src 'self'/);
  assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/webservice\.recruit\.co\.jp/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\s|\*/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

test("static resolver contains requests within the application root", () => {
  assert.equal(resolveStaticFile(ROOT, "/").filePath, resolve(ROOT, "index.html"));
  assert.equal(resolveStaticFile(ROOT, "/assets/icon-192.png?x=1").filePath, resolve(ROOT, "assets/icon-192.png"));
  assert.equal(resolveStaticFile(ROOT, "/src/app.js").filePath, resolve(ROOT, "src/app.js"));
  assert.deepEqual(resolveStaticFile(ROOT, "/../visual to booking-secrets/file"), { ok: false, status: 403, error: "Forbidden" });
  assert.deepEqual(resolveStaticFile(ROOT, "/%2e%2e/secret"), { ok: false, status: 403, error: "Forbidden" });
  assert.deepEqual(resolveStaticFile(ROOT, "/%E0%A4%A"), { ok: false, status: 400, error: "Invalid URL encoding" });
  assert.deepEqual(resolveStaticFile(ROOT, "/bad%00path"), { ok: false, status: 400, error: "Invalid URL path" });
  assert.deepEqual(resolveStaticFile(ROOT, "/.env.local"), { ok: false, status: 404, error: "Not found" });
  assert.deepEqual(resolveStaticFile(ROOT, "/eval/cases.json"), { ok: false, status: 404, error: "Not found" });
  assert.deepEqual(resolveStaticFile(ROOT, "/output/manual/evidence.png"), { ok: false, status: 404, error: "Not found" });
  assert.deepEqual(resolveStaticFile(ROOT, "/server.mjs"), { ok: false, status: 404, error: "Not found" });
  assert.deepEqual(resolveStaticFile(ROOT, "/audit.html"), { ok: false, status: 404, error: "Not found" });
  assert.equal(resolveStaticFile(ROOT, "/audit.html", { allowAuditEntry: true }).filePath, resolve(ROOT, "audit.html"));
});

test("audit entry route supports GET and HEAD while remaining explicitly gated", async () => {
  const serverSource = await readFile(resolve(ROOT, "server.mjs"), "utf8");
  assert.match(serverSource, /auditWorkbench && \["GET", "HEAD"\]\.includes\(request\.method\) && requestPath === "\/audit"/);
  assert.match(serverSource, /auditRequestAuthorized\(request, process\.env\)/);
  assert.match(serverSource, /"Referrer-Policy": "no-referrer"/);
});

test("public privacy and terms URLs serve the application shell", async () => {
  const serverSource = await readFile(resolve(ROOT, "server.mjs"), "utf8");
  assert.match(serverSource, /\["\/privacy", "\/terms"\]\.includes\(requestPath\) \? "\/index\.html"/);
});
