import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
  CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
} from "./index.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";
import type { StdioHarness } from "./test-support/stdio.js";
import {
  createUnityLiveValidationBridgeOptions,
  createUnityLiveValidationObjectName,
  isUnityLiveValidationEnabled
} from "./test-support/unity-live.js";

const describeLive = isUnityLiveValidationEnabled() ? describe : describe.skip;

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

describeLive("@engine-mcp/core-server stdio Unity live validation", () => {
  it("validates create, delete, restore, and persisted runtime resources through the live preferred adapter", async () => {
    const rootDir = await createTempDir();
    const scenario = createUnityLiveValidationObjectName();
    const { harness } = await createInitializedHarness(openHarnesses, {
      persistence: {
        rootDir
      },
      unityBridge: createUnityLiveValidationBridgeOptions()
    });

    const createResponse = await requestResult<{
      structuredContent: {
        object: {
          logicalName: string;
        };
        created: boolean;
      };
    }>(harness, "tools/call", {
      name: "scene.object.create",
      arguments: {
        parent: {
          logicalName: "SandboxRoot"
        },
        name: scenario.objectName
      }
    });

    expect(createResponse.result.structuredContent).toMatchObject({
      created: true,
      object: {
        logicalName: scenario.logicalName
      }
    });

    await assertHierarchyContainsObject(harness, scenario.logicalName);

    const deleteResponse = await requestResult<{
      structuredContent: {
        deleted: boolean;
        snapshotId: string;
      };
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: {
        target: {
          logicalName: scenario.logicalName
        },
        snapshotLabel: "live-validation-stdio"
      }
    });

    expect(deleteResponse.result.structuredContent.deleted).toBe(true);
    expect(deleteResponse.result.structuredContent.snapshotId).toBeTruthy();

    const snapshotId = deleteResponse.result.structuredContent.snapshotId;

    const restoreResponse = await requestResult<{
      structuredContent: {
        snapshotId: string;
        restored: boolean;
        target?: {
          logicalName: string;
        };
      };
    }>(harness, "tools/call", {
      name: "snapshot.restore",
      arguments: {
        snapshotId
      }
    });

    expect(restoreResponse.result.structuredContent).toMatchObject({
      snapshotId,
      restored: true,
      target: {
        logicalName: scenario.logicalName
      }
    });

    await assertHierarchyContainsObject(harness, scenario.logicalName);

    const journalResourceResponse = await requestResult<{
      contents: Array<{
        text: string;
      }>;
    }>(harness, "resources/read", {
      uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI
    });
    const journalPayload = JSON.parse(journalResourceResponse.result.contents[0].text) as {
      entries: Array<{
        capability: string;
        snapshot?: {
          snapshotId: string;
        };
        result: {
          status: string;
        };
      }>;
    };

    expect(journalPayload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "scene.object.delete",
          snapshot: expect.objectContaining({
            snapshotId
          }),
          result: expect.objectContaining({
            status: "succeeded"
          })
        }),
        expect.objectContaining({
          capability: "snapshot.restore",
          snapshot: expect.objectContaining({
            snapshotId
          }),
          result: expect.objectContaining({
            status: "rolled_back"
          })
        })
      ])
    );

    const snapshotResourceResponse = await requestResult<{
      contents: Array<{
        text: string;
      }>;
    }>(harness, "resources/read", {
      uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
    });
    const snapshotPayload = JSON.parse(snapshotResourceResponse.result.contents[0].text) as {
      records: Array<{
        snapshot: {
          snapshotId: string;
          capability?: string;
          targetPath?: string;
        };
        rollbackAvailable: boolean;
      }>;
    };

    expect(snapshotPayload.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshot: expect.objectContaining({
            snapshotId,
            capability: "scene.object.delete",
            targetPath: scenario.logicalName
          }),
          rollbackAvailable: false
        })
      ])
    );
  });
});

async function assertHierarchyContainsObject(
  harness: StdioHarness,
  logicalName: string
): Promise<void> {
  const hierarchyResponse = await requestResult<{
    structuredContent: {
      roots: readonly unknown[];
    };
  }>(harness, "tools/call", {
    name: "scene.hierarchy.read",
    arguments: {}
  });

  expect(
    collectLogicalNames(hierarchyResponse.result.structuredContent.roots).includes(logicalName)
  ).toBe(true);
}

function collectLogicalNames(nodes: readonly unknown[]): string[] {
  const logicalNames: string[] = [];

  for (const node of nodes) {
    if (!isHierarchyNode(node)) {
      continue;
    }

    if (typeof node.object?.logicalName === "string") {
      logicalNames.push(node.object.logicalName);
    }

    logicalNames.push(...collectLogicalNames(node.children ?? []));
  }

  return logicalNames;
}

function isHierarchyNode(
  value: unknown
): value is {
  object?: {
    logicalName?: string;
  };
  children?: readonly unknown[];
} {
  return typeof value === "object" && value !== null;
}

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-live-stdio-"));
  tempDirs.push(rootDir);
  return rootDir;
}
