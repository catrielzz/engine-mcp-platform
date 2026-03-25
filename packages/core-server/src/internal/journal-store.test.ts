import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileJournalService } from "./journal-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("core-server file journal store", () => {
  it("persists append-only journal entries across service restarts", async () => {
    const rootDir = await createTempDir();
    const firstService = createFileJournalService({
      rootDir
    });

    await firstService.append({
      id: "journal-001",
      timestamp: "2026-03-25T12:00:00.000Z",
      capability: "scene.object.delete",
      riskClass: "destructive",
      actor: {
        type: "client",
        id: "session-1"
      },
      decision: {
        capability: "scene.object.delete",
        riskClass: "destructive",
        decision: "allow",
        requiredScopes: ["write", "project"],
        requiresSnapshot: true,
        sandboxOnly: true
      },
      result: {
        status: "succeeded"
      },
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: true
      }
    });

    const secondService = createFileJournalService({
      rootDir
    });

    await expect(secondService.list()).resolves.toEqual([
      expect.objectContaining({
        id: "journal-001",
        capability: "scene.object.delete",
        snapshot: {
          snapshotId: "snapshot-001",
          rollbackAvailable: true
        }
      })
    ]);
  });
});

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-journal-"));
  tempDirs.push(rootDir);
  return rootDir;
}
