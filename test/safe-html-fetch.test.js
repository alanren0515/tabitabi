import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HTML_BYTES, safeFetchHtml, SafeHtmlFetchError } from "../server/safe-html-fetch.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

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
