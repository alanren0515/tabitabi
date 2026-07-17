import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function probeWritableDataStore(directory) {
  const marker = `.readiness-${process.pid}-${Date.now()}`;
  const temporary = join(directory, `${marker}.tmp`);
  const committed = join(directory, marker);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, "ready\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, committed);
    await unlink(committed);
    return true;
  } catch {
    await unlink(temporary).catch(() => {});
    await unlink(committed).catch(() => {});
    return false;
  }
}
