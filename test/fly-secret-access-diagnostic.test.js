import test from "node:test";
import assert from "node:assert/strict";
import { probeFlySecretMetadata } from "../scripts/fly-secret-access-diagnostic.mjs";

test("metadata diagnostics keep the token on the exact endpoint and discard the body", async () => {
  let cancelled = false;
  const result = await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: "test-only" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.machines.dev/v1/apps/tabitabi-jp/secrets");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer test-only");
      return { status: 200, ok: true, body: { cancel: async () => { cancelled = true; } },
        json() { throw new Error("Must not inspect private response body"); } };
    } });
  assert.deepEqual(result, { httpStatus: 200, access: "accepted" });
  assert.equal(cancelled, true);
});

test("denied REST responses expose only a fixed error vocabulary and bound response size", async () => {
  const result = await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: "test-only" },
    fetchImpl: async () => new Response(JSON.stringify({ error: "Token requires secrets access: sensitive-test-value" }), { status: 403 }) });
  assert.deepEqual(result, { httpStatus: 403, access: "denied", reasonTerms: ["error", "token", "requires", "secrets", "access", "value"] });
  assert.doesNotMatch(JSON.stringify(result), /sensitive-test|test-only/);
  const large = await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: "test-only" },
    fetchImpl: async () => new Response(JSON.stringify({ error: "private".repeat(9000) }), { status: 403 }) });
  assert.deepEqual(large.reasonTerms, []);
});

test("FlyV1 credentials use exactly one macaroon authorization scheme", async () => {
  for (const token of ["FlyV1 fm2_synthetic", "fm2_synthetic", "Bearer FlyV1 fm2_synthetic"]) {
    const fetchImpl = async (url, options) => {
      assert.equal(options.headers.Authorization, "FlyV1 fm2_synthetic");
      return new Response(null, { status: 200 });
    };
    assert.equal((await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: token }, fetchImpl })).access, "accepted");
  }
});

test("invalid targets and absent credentials cause no probe; transport errors expose no contents", async () => {
  const noFetch = () => { throw new Error("Must not call"); };
  assert.deepEqual(await probeFlySecretMetadata({ app: "tabitabi-jp", env: {}, fetchImpl: noFetch }), { httpStatus: null, access: "not_checked" });
  assert.deepEqual(await probeFlySecretMetadata({ app: "elsewhere/path", env: { FLY_API_TOKEN: "test-only" }, fetchImpl: noFetch }), { httpStatus: null, access: "not_checked" });
  const result = await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: "test-only" }, fetchImpl: () => { throw new Error("private-value"); } });
  assert.deepEqual(result, { httpStatus: null, access: "unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /private-value|test-only/);
});
