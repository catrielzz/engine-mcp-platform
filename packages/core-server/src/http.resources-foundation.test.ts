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
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
  callHttpJsonRpc,
  initializeHttpClientSession
} from "./test-support/http-client-requests.js";

const MISSING_BOOTSTRAP_PATH =
  "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json";
const GENERATED_OBJECT_NAME = "HttpResourceProbeCube";
const EXPECTED_LOGICAL_NAME = `SandboxRoot/MCP_E2E__${GENERATED_OBJECT_NAME}`;

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

describe("@engine-mcp/core-server Streamable HTTP resources foundation", () => {
  it("lists and reads persisted journal and snapshot metadata resources over Streamable HTTP", async () => {
    const rootDir = await createTempDir();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
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
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-persistence-resources",
      capabilities: {}
    });

    await callHttpJsonRpc(session, {
      requestId: "call-http-resource-create",
      method: "tools/call",
      params: {
        name: "scene.object.create",
        arguments: {
          parent: {
            logicalName: "SandboxRoot"
          },
          name: GENERATED_OBJECT_NAME
        }
      }
    });

    const deleteResponse = await callHttpJsonRpc(session, {
      requestId: "call-http-resource-delete",
      method: "tools/call",
      params: {
        name: "scene.object.delete",
        arguments: {
          target: {
            logicalName: EXPECTED_LOGICAL_NAME
          },
          snapshotLabel: "resource-read-http"
        }
      }
    });
    const deleteBody = (await deleteResponse.json()) as {
      result: {
        structuredContent: {
          snapshotId: string;
        };
      };
    };
    const snapshotId = deleteBody.result.structuredContent.snapshotId;

    await callHttpJsonRpc(session, {
      requestId: "call-http-resource-restore",
      method: "tools/call",
      params: {
        name: "snapshot.restore",
        arguments: {
          snapshotId
        }
      }
    });

    const listResourcesResponse = await callHttpJsonRpc(session, {
      requestId: "resource-list-http-persistence",
      method: "resources/list"
    });
    const listResourcesBody = (await listResourcesResponse.json()) as {
      result: {
        resources: Array<{
          uri: string;
          name: string;
          mimeType?: string;
        }>;
      };
    };

    expect(listResourcesBody.result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
          name: "journal-index",
          mimeType: "application/json"
        }),
        expect.objectContaining({
          uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI,
          name: "snapshot-metadata-index",
          mimeType: "application/json"
        })
      ])
    );

    const journalResourceResponse = await callHttpJsonRpc(session, {
      requestId: "resource-read-http-journal-index",
      method: "resources/read",
      params: {
        uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI
      }
    });
    const journalResourceBody = (await journalResourceResponse.json()) as {
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
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

    expect(journalResourceBody.result.contents[0]).toMatchObject({
      uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
      mimeType: "application/json"
    });
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
      requestId: "resource-read-http-snapshot-index",
      method: "resources/read",
      params: {
        uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
      }
    });
    const snapshotResourceBody = (await snapshotResourceResponse.json()) as {
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
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
            targetPath: EXPECTED_LOGICAL_NAME
          }),
          rollbackAvailable: false
        })
      ])
    );
  });

  it("returns MCP resource-not-found over Streamable HTTP for unknown resource URIs", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-resource-not-found",
      capabilities: {}
    });

    const response = await callHttpJsonRpc(session, {
      requestId: "read-http-missing-resource",
      method: "resources/read",
      params: {
        uri: "engine-mcp://runtime/unknown-resource"
      }
    });
    const body = (await response.json()) as {
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

    expect(body).toMatchObject({
      error: {
        code: -32002,
        message: expect.stringContaining("Resource not found"),
        data: {
          uri: "engine-mcp://runtime/unknown-resource"
        }
      }
    });
  });
});

async function createTempDir(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-http-resources-"));
  tempDirs.push(rootDir);
  return rootDir;
}
