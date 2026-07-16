import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

const lan = process.argv.includes("--lan");
process.env.ENABLE_AUDIT_WORKBENCH = "true";
process.env.HOST = lan ? "0.0.0.0" : "127.0.0.1";
process.env.PORT ||= String(await firstAvailablePort(4174, process.env.HOST));
if (lan) {
  process.env.AUDIT_ALLOW_LAN = "true";
  process.env.AUDIT_TOKEN = randomBytes(24).toString("base64url");
}

await import("../server.mjs");

async function firstAvailablePort(start, host) {
  for (let port = start; port < start + 20; port += 1) {
    if (await portAvailable(port, host)) return port;
  }
  throw new Error(`No audit port is available between ${start} and ${start + 19}`);
}

function portAvailable(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}
