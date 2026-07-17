import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { runDeploymentSmoke, validateSmokeImageMetadata } from "../server/deployment-smoke.mjs";
import { flyApplicationName, parseEnvironmentFile } from "../server/deployment-preflight.mjs";

try {
  const localEnv = parseEnvironmentFile(await readText(".env.local"));
  const baseUrl = process.env.TABITABI_BASE_URL || "";
  if (!baseUrl) throw new Error("TABITABI_BASE_URL is required; set the exact deployed HTTPS origin explicitly");
  const appName = flyApplicationName(await readText("fly.toml"));
  if (!appName) throw new Error("fly.toml must contain a valid committed app name");
  const allowedOrigin = `https://${appName}.fly.dev`;
  const accessCode = process.env.PILOT_ACCESS_CODE || localEnv.PILOT_ACCESS_CODE || "";
  const live = process.env.SMOKE_LIVE === "true";
  const screenshotDataUrl = live ? await imageDataUrl(process.env.SMOKE_SCREENSHOT_PATH || "") : "";
  const result = await runDeploymentSmoke({ baseUrl, allowedOrigin, accessCode, screenshotDataUrl, live });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ passed: false, stage: error.stage || "configuration", status: error.status || null, error: error.message }, null, 2));
  process.exitCode = 1;
}

async function imageDataUrl(path) {
  if (!path) return "";
  const mime = validateSmokeImageMetadata({ extension: extname(path), size: (await stat(path)).size });
  return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
}
async function readText(path) { try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } }
