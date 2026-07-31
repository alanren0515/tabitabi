import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeReleaseEvidence(path, report, { mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename, rmImpl = rm } = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFileImpl(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await renameImpl(temporaryPath, path);
  } catch (error) {
    await rmImpl(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function invalidateReleaseEvidence(path, { mkdirImpl = mkdir, renameImpl = rename, rmImpl = rm } = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  const previousPath = `${path}.previous`;
  await rmImpl(previousPath, { force: true });
  try {
    await renameImpl(path, previousPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
