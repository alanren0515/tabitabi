import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function currentGitState(execFileImpl = run, { env = process.env } = {}) {
  // These commands read local repository state and never need cloud credentials.
  const { FLY_API_TOKEN, FLY_ACCESS_TOKEN, FLY_SECRET_METADATA_TOKEN, ...gitEnv } = env;
  const [{ stdout: revision = "" }, { stdout: status = "" }] = await Promise.all([
    execFileImpl("git", ["rev-parse", "HEAD"], { timeout: 5_000, maxBuffer: 64 * 1024, env: gitEnv }),
    execFileImpl("git", ["status", "--porcelain"], { timeout: 5_000, maxBuffer: 64 * 1024, env: gitEnv })
  ]);
  const normalized = String(revision).trim();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error("Git HEAD is not a full commit SHA");
  return { revision: normalized, clean: String(status).trim() === "" };
}
