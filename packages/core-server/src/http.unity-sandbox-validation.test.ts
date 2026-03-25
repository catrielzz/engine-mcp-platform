import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryJournalService,
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import {
  callHttpJsonRpc,
  initializeHttpClientSession
} from "./test-support/http-client-requests.js";

const MISSING_BOOTSTRAP_PATH =
  "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json";
const GENERATED_OBJECT_NAME = "RollbackProbeCube";
const EXPECTED_LOGICAL_NAME = `SandboxRoot/MCP_E2E__${GENERATED_OBJECT_NAME}`;

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP Unity sandbox validation", () => {
  it("validates create, delete, restore, and rollback journaling through the preferred Unity adapter", async () => {
    const journalService = createInMemoryJournalService();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
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
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-unity-sandbox-validation",
      capabilities: {}
    });

    const createBody = await callTool(session, "scene.object.create", {
      parent: {
        logicalName: "SandboxRoot"
      },
      name: GENERATED_OBJECT_NAME
    });

    expect(createBody).toMatchObject({
      created: true,
      object: {
        logicalName: EXPECTED_LOGICAL_NAME,
        displayName: `MCP_E2E__${GENERATED_OBJECT_NAME}`
      }
    });

    await assertHierarchyContainsObject(session, EXPECTED_LOGICAL_NAME);

    const deleteBody = await callTool(session, "scene.object.delete", {
      target: {
        logicalName: EXPECTED_LOGICAL_NAME
      },
      snapshotLabel: "pre-rollback-validation"
    });

    expect(deleteBody).toMatchObject({
      deleted: true
    });
    expect(deleteBody.snapshotId).toBeTruthy();

    const snapshotId = String(deleteBody.snapshotId);

    const restoreBody = await callTool(session, "snapshot.restore", {
      snapshotId
    });

    expect(restoreBody).toMatchObject({
      snapshotId,
      restored: true,
      target: {
        logicalName: EXPECTED_LOGICAL_NAME
      }
    });

    await assertHierarchyContainsObject(session, EXPECTED_LOGICAL_NAME);

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

async function callTool(
  session: Parameters<typeof callHttpJsonRpc>[0],
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await callHttpJsonRpc(session, {
    requestId: `call-http-${name}-${Math.random().toString(36).slice(2, 8)}`,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });
  const body = (await response.json()) as {
    result: {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
    };
  };

  expect(response.status).toBe(200);
  expect(body.result.isError).toBeUndefined();

  return body.result.structuredContent;
}

async function assertHierarchyContainsObject(
  session: Parameters<typeof callHttpJsonRpc>[0],
  logicalName: string
): Promise<void> {
  const hierarchy = await callTool(session, "scene.hierarchy.read", {});
  const roots = Array.isArray(hierarchy.roots) ? hierarchy.roots : [];

  expect(collectLogicalNames(roots).includes(logicalName)).toBe(true);
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
