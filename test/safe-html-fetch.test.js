import test from "node:test";
import assert from "node:assert/strict";
import { createPinnedLookup, MAX_HTML_BYTES, safeFetchHtml, SafeHtmlFetchError } from "../server/safe-html-fetch.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("returns the pinned address in both legacy and all-address lookup modes", () => {
  const lookup = createPinnedLookup("93.184.216.34", 4);
  lookup("restaurant.example", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
  lookup("restaurant.example", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
});

test("pins the validated DNS address while preserving the TLS hostname", async () => {
  let connection;
  const result = await safeFetchHtml({
    url: "https://restaurant.example/menu",
    lookupImpl: publicLookup,
    requestImpl: async (url, options) => {
      connection = { url, ...options };
      return new Response("<h1>店名</h1>", { headers: { "content-type": "text/html" } });
    }
  });
  assert.equal(result.html, "<h1>店名</h1>");
  assert.equal(connection.pinnedAddress, "93.184.216.34");
  assert.equal(connection.servername, "restaurant.example");
});

test("re-resolves every redirect hop and blocks DNS rebinding", async () => {
  let lookups = 0;
  let requests = 0;
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/start",
    lookupImpl: async () => (++lookups === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }]),
    requestImpl: async () => {
      requests += 1;
      return new Response("", { status: 302, headers: { location: "/next" } });
    }
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "UNSAFE_HOST");
  assert.equal(lookups, 2);
  assert.equal(requests, 1);
});

test("blocks a redirect to a private literal before making the next request", async () => {
  let requests = 0;
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/start",
    lookupImpl: publicLookup,
    requestImpl: async () => {
      requests += 1;
      return new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } });
    }
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "UNSAFE_REDIRECT");
  assert.equal(requests, 1);
});

test("stops and destroys a streaming body as soon as it exceeds 512 KB", async () => {
  let destroyed = false;
  const body = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(MAX_HTML_BYTES);
      yield Buffer.from("x");
      yield Buffer.from("must-not-be-read");
    },
    destroy() { destroyed = true; }
  };
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/large",
    lookupImpl: publicLookup,
    requestImpl: async () => ({ status: 200, headers: { "content-type": "text/html" }, body })
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "TOO_LARGE" && error.status === 413);
  assert.equal(destroyed, true);
});

test("rejects an oversized Content-Length without reading the body", async () => {
  let read = false;
  const body = { async *[Symbol.asyncIterator]() { read = true; yield Buffer.from("x"); } };
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/declared-large",
    lookupImpl: publicLookup,
    requestImpl: async () => ({ status: 200, headers: { "content-type": "text/html", "content-length": String(MAX_HTML_BYTES + 1) }, body })
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "TOO_LARGE");
  assert.equal(read, false);
});

test("destroys a response body that does not finish before the absolute deadline", async () => {
  let destroyed = false;
  const body = {
    async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
    destroy() { destroyed = true; }
  };
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/slow",
    lookupImpl: publicLookup,
    timeoutMs: 10,
    requestImpl: async () => ({ status: 200, headers: { "content-type": "text/html" }, body })
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "TIMEOUT");
  assert.equal(destroyed, true);
});

test("applies the same absolute deadline to DNS resolution", async () => {
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/slow-dns",
    timeoutMs: 10,
    lookupImpl: async () => new Promise(() => {}),
    requestImpl: async () => new Response("ok")
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "TIMEOUT");
});

test("rejects at the deadline even when response cleanup never settles", async () => {
  const body = {
    async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
    cancel: async () => new Promise(() => {})
  };
  const startedAt = Date.now();
  await assert.rejects(() => safeFetchHtml({
    url: "https://restaurant.example/stuck-cleanup",
    lookupImpl: publicLookup,
    timeoutMs: 10,
    requestImpl: async () => ({ status: 200, headers: { "content-type": "text/html" }, body })
  }), (error) => error instanceof SafeHtmlFetchError && error.code === "TIMEOUT");
  assert.ok(Date.now() - startedAt < 100);
});
