import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function currentGitState(execFileImpl = run) {
  const [{ stdout: revision = "" }, { stdout: status = "" }] = await Promise.all([
    execFileImpl("git", ["rev-parse", "HEAD"], { timeout: 5_000, maxBuffer: 64 * 1024 }),
    execFileImpl("git", ["status", "--porcelain"], { timeout: 5_000, maxBuffer: 64 * 1024 })
  ]);
  const normalized = String(revision).trim();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error("Git HEAD is not a full commit SHA");
  return { revision: normalized, clean: String(status).trim() === "" };
}
