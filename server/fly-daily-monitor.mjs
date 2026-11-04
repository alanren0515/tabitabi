export const DAILY_MONITOR_COMMAND = "node /app/server/remote-daily-monitor.mjs";

// Machine-exec credentials allow this exact command plus app-scoped reads;
// unlike SSH credentials they do not need a WireGuard peer or an interactive shell.
export async function readFlyDailyMonitor({ application, run, env }) {
  const { stdout: listing } = await run("flyctl", ["machine", "list", "-a", application, "--json"], {
    env, timeout: 30_000, maxBuffer: 512 * 1024
  });
  const machines = JSON.parse(listing);
  if (!Array.isArray(machines) || machines.length !== 1 || !/^[a-f0-9]{8,32}$/.test(machines[0]?.id || "")) {
    throw new Error("Monitoring requires exactly one identifiable Fly Machine; do not change resources automatically");
  }
  if (machines[0].state !== "started") throw new Error("could not find a running machine");
  const { stdout } = await run("flyctl", ["machine", "exec", machines[0].id, DAILY_MONITOR_COMMAND,
    "-a", application, "--json", "--timeout", "30"], { env, timeout: 45_000, maxBuffer: 512 * 1024 });
  // flyctl --json can exit zero even when the executed process fails.
  const result = JSON.parse(stdout);
  if (result?.exit_code !== 0 || typeof result.stdout !== "string") throw new Error("Remote monitoring command failed");
  const markers = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("TABITABI_DAILY_MONITOR="));
  if (markers.length !== 1) throw new Error("Remote daily monitor marker was not returned exactly once");
  const report = JSON.parse(markers[0].slice("TABITABI_DAILY_MONITOR=".length));
  if (report?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(report.releaseRevision || "") ||
      !["healthy", "warning", "critical"].includes(report.status)) throw new Error("Remote daily monitoring report is invalid");
  return report;
}
