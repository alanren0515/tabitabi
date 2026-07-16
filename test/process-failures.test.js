import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installFatalProcessHandlers, safeFatalErrorSummary } from "../server/process-failures.mjs";

test("summarizes fatal errors without messages, stacks, or arbitrary values", () => {
  const error = new Error("secret api key value");
  error.code = "UPSTREAM_FAILED";
  const summary = safeFatalErrorSummary(error, "uncaughtException");
  assert.deepEqual(summary, { type: "uncaughtException", name: "Error", code: "UPSTREAM_FAILED" });
  assert.doesNotMatch(JSON.stringify(summary), /secret|api key/i);
});

test("logs and exits nonzero after an uncaught exception", () => {
  const processImpl = new EventEmitter();
  const logs = [];
  const exits = [];
  let closed = false;
  installFatalProcessHandlers({
    processImpl,
    logger: { error: (...items) => logs.push(items) },
    close: (done) => { closed = true; done(); },
    exit: (code) => exits.push(code),
    schedule: () => null
  });
  processImpl.emit("uncaughtException", new Error("do not log this message"));
  assert.equal(closed, true);
  assert.deepEqual(exits, [1]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /do not log this message/);
});

test("handles an unhandled rejection through the same fatal path", () => {
  const processImpl = new EventEmitter();
  const exits = [];
  installFatalProcessHandlers({
    processImpl,
    logger: { error: () => {} },
    close: (done) => done(),
    exit: (code) => exits.push(code),
    schedule: () => null
  });
  processImpl.emit("unhandledRejection", "raw secret reason");
  assert.deepEqual(exits, [1]);
});
