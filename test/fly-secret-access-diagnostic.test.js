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
      return { status: 403, ok: false, body: { cancel: async () => { cancelled = true; } },
        json() { throw new Error("Must not inspect private response body"); } };
    } });
  assert.deepEqual(result, { httpStatus: 403, access: "denied" });
  assert.equal(cancelled, true);
});

test("invalid targets and absent credentials cause no probe; transport errors expose no contents", async () => {
  const noFetch = () => { throw new Error("Must not call"); };
  assert.deepEqual(await probeFlySecretMetadata({ app: "tabitabi-jp", env: {}, fetchImpl: noFetch }), { httpStatus: null, access: "not_checked" });
  assert.deepEqual(await probeFlySecretMetadata({ app: "elsewhere/path", env: { FLY_API_TOKEN: "test-only" }, fetchImpl: noFetch }), { httpStatus: null, access: "not_checked" });
  const result = await probeFlySecretMetadata({ app: "tabitabi-jp", env: { FLY_API_TOKEN: "test-only" }, fetchImpl: () => { throw new Error("private-value"); } });
  assert.deepEqual(result, { httpStatus: null, access: "unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /private-value|test-only/);
});
