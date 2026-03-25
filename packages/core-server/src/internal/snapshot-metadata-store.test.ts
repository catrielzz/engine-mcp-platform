import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFileSnapshotMetadataStore,
  createInMemorySnapshotMetadataStore,
  createSnapshotMetadataRecord
} from "./snapshot-metadata-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("core-server snapshot metadata store", () => {
  it("persists snapshot metadata across store restarts", async () => {
    const rootDir = await createTempDir();
    const firstStore = createFileSnapshotMetadataStore({
      rootDir
    });

    await firstStore.upsert(
      createSnapshotMetadataRecord({
        capability: "scene.object.delete",
        adapterId: "unity-bridge-preferred",
        snapshot: {
          snapshotId: "snapshot-001",
          rollbackAvailable: true
        },
        target: {
          logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
          sandboxed: true
        },
        now: () => "2026-03-25T12:00:00.000Z"
      })
    );

    const secondStore = createFileSnapshotMetadataStore({
      rootDir
    });

    await expect(secondStore.get("snapshot-001")).resolves.toMatchObject({
      snapshot: {
        snapshotId: "snapshot-001",
        adapterId: "unity-bridge-preferred",
        createdAt: "2026-03-25T12:00:00.000Z",
        capability: "scene.object.delete",
        targetPath: "SandboxRoot/MCP_E2E__GeneratedCube"
      },
      rollbackAvailable: true
    });
  });

  it("preserves original snapshot metadata while updating rollback availability", async () => {
    const store = createInMemorySnapshotMetadataStore();

    await store.upsert(
      createSnapshotMetadataRecord({
        capability: "scene.object.delete",
        adapterId: "unity-bridge-preferred",
        snapshot: {
          snapshotId: "snapshot-001",
          rollbackAvailable: true
        },
        target: {
          logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
          sandboxed: true
        },
        now: () => "2026-03-25T12:00:00.000Z"
      })
    );

    await store.upsert(
      createSnapshotMetadataRecord({
        capability: "snapshot.restore",
        adapterId: "unity-bridge-preferred",
        snapshot: {
          snapshotId: "snapshot-001",
          rollbackAvailable: false
        },
        now: () => "2026-03-25T12:05:00.000Z"
      })
    );

    expect(store.get("snapshot-001")).toMatchObject({
      snapshot: {
        snapshotId: "snapshot-001",
        createdAt: "2026-03-25T12:00:00.000Z",
        capability: "scene.object.delete",
        targetPath: "SandboxRoot/MCP_E2E__GeneratedCube"
      },
      rollbackAvailable: false,
      updatedAt: "2026-03-25T12:05:00.000Z"
    });
  });
});

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-snapshots-"));
  tempDirs.push(rootDir);
  return rootDir;
}
