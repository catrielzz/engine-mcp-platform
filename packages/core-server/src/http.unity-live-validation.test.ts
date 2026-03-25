import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
  CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI,
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import {
  callHttpJsonRpc,
  initializeHttpClientSession
} from "./test-support/http-client-requests.js";
import {
  createUnityLiveValidationBridgeOptions,
  createUnityLiveValidationObjectName,
  isUnityLiveValidationEnabled
} from "./test-support/unity-live.js";

const describeLive = isUnityLiveValidationEnabled() ? describe : describe.skip;

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }

  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describeLive("@engine-mcp/core-server Streamable HTTP Unity live validation", () => {
  it("validates create, delete, restore, and persisted runtime resources through the live preferred adapter", async () => {
    const rootDir = await createTempDir();
    const scenario = createUnityLiveValidationObjectName();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      persistence: {
        rootDir
      },
      unityBridge: createUnityLiveValidationBridgeOptions()
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-live-validation",
      capabilities: {}
    });

    const createBody = await callTool(session, "scene.object.create", {
      parent: {
        logicalName: "SandboxRoot"
      },
      name: scenario.objectName
    });

    expect(createBody).toMatchObject({
      created: true,
      object: {
        logicalName: scenario.logicalName
      }
    });

    await assertHierarchyContainsObject(session, scenario.logicalName);

    const deleteBody = await callTool(session, "scene.object.delete", {
      target: {
        logicalName: scenario.logicalName
      },
      snapshotLabel: "live-validation-http"
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
        logicalName: scenario.logicalName
      }
    });

    await assertHierarchyContainsObject(session, scenario.logicalName);

    const journalResourceResponse = await callHttpJsonRpc(session, {
      requestId: "resource-read-http-live-journal",
      method: "resources/read",
      params: {
        uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI
      }
    });
    const journalResourceBody = (await journalResourceResponse.json()) as {
      result: {
        contents: Array<{
          text: string;
        }>;
      };
    };
    const journalPayload = JSON.parse(journalResourceBody.result.contents[0].text) as {
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

    const snapshotResourceResponse = await callHttpJsonRpc(session, {
      requestId: "resource-read-http-live-snapshot-index",
      method: "resources/read",
      params: {
        uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
      }
    });
    const snapshotResourceBody = (await snapshotResourceResponse.json()) as {
      result: {
        contents: Array<{
          text: string;
        }>;
      };
    };
    const snapshotPayload = JSON.parse(snapshotResourceBody.result.contents[0].text) as {
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

async function callTool(
  session: Parameters<typeof callHttpJsonRpc>[0],
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await callHttpJsonRpc(session, {
    requestId: `call-http-live-${name}-${Math.random().toString(36).slice(2, 8)}`,
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

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-live-http-"));
  tempDirs.push(rootDir);
  return rootDir;
}
