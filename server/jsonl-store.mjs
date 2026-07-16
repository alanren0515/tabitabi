import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createJsonlStore({ path, maxAgeMs = 30 * 24 * 60 * 60 * 1_000, maxLines = 50_000, maxBytes = 10 * 1024 * 1024, pruneEvery = 100, now = () => Date.now() }) {
  let queue = Promise.resolve();
  let appendCount = 0;
  return {
    append(record) {
      const operation = queue.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
        appendCount += 1;
        if (appendCount === 1 || appendCount % pruneEvery === 0) {
          await pruneJsonlFile({ path, maxAgeMs, maxLines, maxBytes, now: now() });
        }
      });
      queue = operation.catch(() => {});
      return operation;
    },
    prune() {
      const operation = queue.then(() => pruneJsonlFile({ path, maxAgeMs, maxLines, maxBytes, now: now() }));
      queue = operation.catch(() => {});
      return operation;
    }
  };
}

export async function pruneJsonlFile({ path, maxAgeMs, maxLines, maxBytes, now = Date.now() }) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { kept: 0, removed: 0 };
    throw error;
  }

  const originalLines = content.split(/\r?\n/).filter(Boolean);
  const cutoff = now - maxAgeMs;
  let lines = originalLines.flatMap((line) => {
    try {
      const record = JSON.parse(line);
      const occurredAt = new Date(record?.occurredAt || "").valueOf();
      if (!Number.isFinite(occurredAt) || occurredAt < cutoff || occurredAt > now + 5 * 60 * 1_000) return [];
      return [JSON.stringify(record)];
    } catch {
      return [];
    }
  });
  if (lines.length > maxLines) lines = lines.slice(-maxLines);
  let bytes = lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
  while (lines.length && bytes > maxBytes) {
    bytes -= Buffer.byteLength(lines.shift()) + 1;
  }

  const output = lines.length ? `${lines.join("\n")}\n` : "";
  if (output !== content) {
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, output, "utf8");
    await rename(temporaryPath, path);
  }
  return { kept: lines.length, removed: originalLines.length - lines.length };
}

