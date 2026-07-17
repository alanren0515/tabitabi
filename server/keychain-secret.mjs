import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function readMacKeychainSecret({ service, account = process.env.USER || "", execFileImpl = run } = {}) {
  if (process.platform !== "darwin" || !service || !account) return "";
  try {
    const { stdout = "" } = await execFileImpl("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
      timeout: 5_000,
      maxBuffer: 8 * 1024
    });
    return String(stdout).replace(/[\r\n]+$/g, "");
  } catch {
    return "";
  }
}
