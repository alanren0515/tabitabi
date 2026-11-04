import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_MONITOR_COMMAND, readFlyDailyMonitor } from "../server/fly-daily-monitor.mjs";

const machine = { id: "2874ddda755048", state: "started" };
const report = { schemaVersion: 1, releaseRevision: "a".repeat(40), status: "healthy" };
function runner({ machines = [machine], response = { stdout: `TABITABI_DAILY_MONITOR=${JSON.stringify(report)}\n` } } = {}) {
  const calls = [];
  return { calls, run: async (command, args) => { calls.push({ command, args }); return { stdout: JSON.stringify(calls.length === 1 ? machines : response) }; } };
}
test("uses app-scoped reads and one exact monitoring command instead of SSH", async () => {
  const stub = runner();
  assert.deepEqual(await readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }), report);
  assert.deepEqual(stub.calls[1].args, ["machine", "exec", machine.id, DAILY_MONITOR_COMMAND, "-a", "tabitabi-jp", "--json", "--timeout", "30"]);
  assert.equal(stub.calls.some(({ args }) => args.includes("ssh") || args.includes("start") || args.includes("deploy")), false);
});
test("does not exec or start stopped, ambiguous, or malformed machines", async () => {
  for (const machines of [[], [machine, machine], [{ ...machine, state: "stopped" }], [{ ...machine, id: "invalid" }]]) {
    const stub = runner({ machines });
    await assert.rejects(readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }));
    assert.equal(stub.calls.length, 1);
  }
});
test("rejects a failed exec even if stdout includes an apparently valid report", async () => {
  const stub = runner({ response: { exit_code: 1, stdout: `TABITABI_DAILY_MONITOR=${JSON.stringify(report)}` } });
  await assert.rejects(readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }), /command failed/);
});
test("accepts explicitly serialized zero as well as the omitted zero returned by Fly", async () => {
  const stub = runner({ response: { exit_code: 0, stdout: `TABITABI_DAILY_MONITOR=${JSON.stringify(report)}\n` } });
  assert.deepEqual(await readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }), report);
});
test("does not coerce malformed exit codes or response containers into success", async () => {
  const stdout = `TABITABI_DAILY_MONITOR=${JSON.stringify(report)}\n`;
  for (const response of [null, [], {}, { exit_code: 0 }, ...[null, "0", false, -1, 2].map(exit_code => ({ exit_code, stdout }))]) {
    const stub = runner({ response });
    await assert.rejects(readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }), /command failed/);
  }
});
test("rejects absent, duplicate, or invalid monitor markers", async () => {
  for (const stdout of ["", "TABITABI_DAILY_MONITOR={}\n", `TABITABI_DAILY_MONITOR=${JSON.stringify(report)}\nTABITABI_DAILY_MONITOR=${JSON.stringify(report)}`]) {
    const stub = runner({ response: { exit_code: 0, stdout } });
    await assert.rejects(readFlyDailyMonitor({ application: "tabitabi-jp", run: stub.run, env: {} }));
  }
});
