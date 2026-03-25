import { afterEach, describe, expect, it } from "vitest";

import { createInMemoryJournalService } from "./index.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";
import type { StdioHarness } from "./test-support/stdio.js";

const MISSING_BOOTSTRAP_PATH =
  "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json";
const GENERATED_OBJECT_NAME = "RollbackProbeCube";
const EXPECTED_LOGICAL_NAME = `SandboxRoot/MCP_E2E__${GENERATED_OBJECT_NAME}`;

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio Unity sandbox validation", () => {
  it("validates create, delete, restore, and rollback journaling through the preferred Unity adapter", async () => {
    const journalService = createInMemoryJournalService();
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService,
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

    const createResponse = await requestResult<{
      structuredContent: {
        object: {
          logicalName: string;
          displayName: string;
        };
        created: boolean;
      };
    }>(harness, "tools/call", {
      name: "scene.object.create",
      arguments: {
        parent: {
          logicalName: "SandboxRoot"
        },
        name: GENERATED_OBJECT_NAME
      }
    });

    expect(createResponse.result.structuredContent).toMatchObject({
      created: true,
      object: {
        logicalName: EXPECTED_LOGICAL_NAME,
        displayName: `MCP_E2E__${GENERATED_OBJECT_NAME}`
      }
    });

    await assertHierarchyContainsObject(harness, EXPECTED_LOGICAL_NAME);

    const deleteResponse = await requestResult<{
      structuredContent: {
        deleted: boolean;
        snapshotId: string;
      };
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: {
        target: {
          logicalName: EXPECTED_LOGICAL_NAME
        },
        snapshotLabel: "pre-rollback-validation"
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
        logicalName: EXPECTED_LOGICAL_NAME
      }
    });

    await assertHierarchyContainsObject(harness, EXPECTED_LOGICAL_NAME);

    const entries = await journalService.list();
    const mutationEntries = entries.filter(({ capability }) =>
      capability === "scene.object.create" ||
      capability === "scene.object.delete" ||
      capability === "snapshot.restore"
    );

    expect(mutationEntries).toHaveLength(3);
    expect(mutationEntries[0]).toMatchObject({
      capability: "scene.object.create",
      result: {
        status: "succeeded"
      }
    });
    expect(mutationEntries[1]).toMatchObject({
      capability: "scene.object.delete",
      snapshot: {
        snapshotId,
        rollbackAvailable: true
      },
      result: {
        status: "succeeded"
      }
    });
    expect(mutationEntries[2]).toMatchObject({
      capability: "snapshot.restore",
      snapshot: {
        snapshotId,
        rollbackAvailable: false
      },
      result: {
        status: "rolled_back"
      }
    });
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
    if (!isJournalNode(node)) {
      continue;
    }

    if (typeof node.object?.logicalName === "string") {
      logicalNames.push(node.object.logicalName);
    }

    logicalNames.push(...collectLogicalNames(node.children ?? []));
  }

  return logicalNames;
}

function isJournalNode(
  value: unknown
): value is {
  object?: {
    logicalName?: string;
  };
  children?: readonly unknown[];
} {
  return typeof value === "object" && value !== null;
}
