import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const BASELINE_SOURCE_PATHS = Object.freeze([
  "server.mjs", "server", "src", "assets", "index.html",
  "manifest.webmanifest", "sw.js", "package.json", "test"
]);
export const PROVIDER_FREE_CONFIG = Object.freeze({
  NODE_ENV: "development", HOST: "127.0.0.1", PAID_API_EMERGENCY_STOP: "true",
  GOOGLE_MAPS_API_KEY: "", HOTPEPPER_API_KEY: "", DASHSCOPE_API_KEY: "", OPENAI_API_KEY: ""
});

export async function verifyBaselineSnapshot(snapshot, { root = process.cwd() } = {}) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { valid: false, errors: ["baseline_snapshot_missing"] };
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision || "")) errors.push("baseline_revision_invalid");
  if (!/^[a-f0-9]{64}$/.test(snapshot.archiveSha256 || "")) errors.push("baseline_archive_digest_invalid");
  if (!Number.isFinite(Date.parse(snapshot.createdAt))) errors.push("baseline_created_at_invalid");
  if (!/^v\d+\.\d+\.\d+$/.test(snapshot.nodeVersion || "")) errors.push("baseline_node_version_invalid");
  const archive = await controlledPath(root, snapshot.archivePath);
  const configuration = await controlledPath(root, snapshot.configurationFixturePath);
  if (!archive) errors.push("baseline_archive_unavailable");
  if (!configuration) errors.push("baseline_configuration_unavailable");
  if (archive) {
    try {
      const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
      if (digest !== snapshot.archiveSha256) errors.push("baseline_archive_digest_mismatch");
    } catch { errors.push("baseline_archive_unreadable"); }
  }
  if (configuration) {
    try {
      const config = JSON.parse(await readFile(configuration, "utf8"));
      if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(Object.keys(PROVIDER_FREE_CONFIG).sort()) ||
          Object.entries(PROVIDER_FREE_CONFIG).some(([key, value]) => config[key] !== value)) {
        errors.push("baseline_configuration_not_provider_free");
      }
    } catch { errors.push("baseline_configuration_invalid"); }
  }
  return { valid: errors.length === 0, errors };
}

async function controlledPath(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\")) return null;
  try {
    const realRoot = await realpath(root);
    const realFile = await realpath(resolve(realRoot, path));
    const fromRoot = relative(realRoot, realFile);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
    return realFile;
  } catch { return null; }
}
