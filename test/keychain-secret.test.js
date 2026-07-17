import test from "node:test";
import assert from "node:assert/strict";
import { readMacKeychainSecret } from "../server/keychain-secret.mjs";

test("reads a named macOS Keychain item without logging or altering the value", async (context) => {
  if (process.platform !== "darwin") return context.skip("macOS only");
  let invocation;
  const secret = await readMacKeychainSecret({
    service: "tabitabi-jp-pilot-access",
    account: "pilot-user",
    execFileImpl: async (...args) => { invocation = args; return { stdout: "exact-secret\n" }; }
  });
  assert.equal(secret, "exact-secret");
  assert.deepEqual(invocation.slice(0, 2), ["security", ["find-generic-password", "-a", "pilot-user", "-s", "tabitabi-jp-pilot-access", "-w"]]);
});

test("fails closed when the Keychain item is unavailable", async (context) => {
  if (process.platform !== "darwin") return context.skip("macOS only");
  assert.equal(await readMacKeychainSecret({
    service: "tabitabi-jp-pilot-access",
    account: "pilot-user",
    execFileImpl: async () => { throw new Error("not found"); }
  }), "");
});
