import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFileJournalService,
  createFileSnapshotMetadataStore
} from "./index.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";
import type { StdioHarness } from "./test-support/stdio.js";

const MISSING_BOOTSTRAP_PATH =
  "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json";
const GENERATED_OBJECT_NAME = "PersistenceProbeCube";
const EXPECTED_LOGICAL_NAME = `SandboxRoot/MCP_E2E__${GENERATED_OBJECT_NAME}`;

const openHarnesses: StdioHarness[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }

  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("@engine-mcp/core-server stdio persistence foundation", () => {
  it("persists journal entries and snapshot metadata across harness restarts when persistence is enabled", async () => {
    const rootDir = await createTempDir();
    const { harness } = await createInitializedHarness(openHarnesses, {
      persistence: {
        rootDir
      },
      unityBridge: {
        proxy: {
          bootstrapFilePath: MISSING_BOOTSTRAP_PATH,
          sessionScope: "dangerous_write"
        },
        sandbox: {
          sessionScope: "dangerous_write"
        },
        fallbackToSandbox: true
      }
    });

    await requestResult(harness, "tools/call", {
      name: "scene.object.create",
      arguments: {
        parent: {
          logicalName: "SandboxRoot"
        },
        name: GENERATED_OBJECT_NAME
      }
    });

    const deleteResponse = await requestResult<{
      structuredContent: {
        snapshotId: string;
      };
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: {
        target: {
          logicalName: EXPECTED_LOGICAL_NAME
        },
        snapshotLabel: "pre-persistence-validation"
      }
    });
    const snapshotId = deleteResponse.result.structuredContent.snapshotId;

    await requestResult(harness, "tools/call", {
      name: "snapshot.restore",
      arguments: {
        snapshotId
      }
    });

    await harness.close();
    openHarnesses.length = 0;

    const journalService = createFileJournalService({
      rootDir
    });
    const snapshotMetadataStore = createFileSnapshotMetadataStore({
      rootDir
    });
    const journalEntries = await journalService.list();
    const mutationEntries = journalEntries.filter(({ capability }) =>
      capability === "scene.object.create" ||
      capability === "scene.object.delete" ||
      capability === "snapshot.restore"
    );
    const snapshotMetadata = await snapshotMetadataStore.get(snapshotId);

    expect(mutationEntries).toHaveLength(3);
    expect(mutationEntries[1]).toMatchObject({
      capability: "scene.object.delete",
      snapshot: {
        snapshotId,
        rollbackAvailable: true
      }
    });
    expect(mutationEntries[2]).toMatchObject({
      capability: "snapshot.restore",
      result: {
        status: "rolled_back"
      }
    });
    expect(snapshotMetadata).toMatchObject({
      snapshot: {
        snapshotId,
        adapterId: "unity-bridge-preferred",
        capability: "scene.object.delete",
        targetPath: EXPECTED_LOGICAL_NAME
      },
      rollbackAvailable: false
    });
  });
});

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-persistence-"));
  tempDirs.push(rootDir);
  return rootDir;
}
