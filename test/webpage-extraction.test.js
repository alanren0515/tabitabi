import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicWebpageClues, WebpageExtractionError } from "../server/webpage-extraction.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("extracts restaurant JSON-LD from a user-submitted public webpage", async () => {
  const result = await extractPublicWebpageClues({
    url: "https://restaurant.example/shop",
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(`<!doctype html><title>Example | Guide</title><script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Restaurant","name":"ホームズパスタ 上野店","servesCuisine":"Italian",
      "address":{"@type":"PostalAddress","postalCode":"110-0005","addressRegion":"東京都","addressLocality":"台東区","streetAddress":"上野4-8-9 OAKビル2F"}
    }</script>`, { headers: { "content-type": "text/html" } })
  });
  assert.equal(result.clues.name, "ホームズパスタ 上野店");
  assert.match(result.clues.address, /東京都.*台東区.*上野4-8-9/);
  assert.equal(result.confidence, "high");
  assert.equal(result.requiresUserConfirmation, true);
});

test("uses a visible heading only as a low-confidence editable clue", async () => {
  const result = await extractPublicWebpageClues({
    url: "https://blog.example/post",
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(`<title>東京グルメ記事</title><h1>六本木のつるとんたんへ行ってきた</h1>`, { headers: { "content-type": "text/html" } })
  });
  assert.match(result.clues.name, /つるとんたん/);
  assert.equal(result.confidence, "low");
  assert.match(result.warnings.join(" "), /文章标题/);
});

test("blocks private DNS results and unsafe redirect destinations", async () => {
  await assert.rejects(
    () => extractPublicWebpageClues({ url: "https://internal.example/", lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }], fetchImpl: async () => new Response("ok") }),
    (error) => error instanceof WebpageExtractionError && error.code === "UNSAFE_HOST"
  );
  await assert.rejects(
    () => extractPublicWebpageClues({ url: "https://public.example/", lookupImpl: publicLookup, fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }) }),
    (error) => error instanceof WebpageExtractionError && ["UNSAFE_REDIRECT", "INVALID_URL"].includes(error.code)
  );
});
