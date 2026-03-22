import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function writeJsonFileDurably(filePath: string, payload: unknown): Promise<string> {
  const resolvedPath = resolve(filePath);
  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  const serializedPayload = JSON.stringify(payload, null, 2);

  await mkdir(dirname(resolvedPath), {
    recursive: true
  });

  const handle = await open(tempPath, "w");

  try {
    await handle.writeFile(serializedPayload, {
      encoding: "utf8"
    });
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rm(resolvedPath, {
    force: true
  }).catch(() => undefined);
  await rename(tempPath, resolvedPath);

  return resolvedPath;
}
