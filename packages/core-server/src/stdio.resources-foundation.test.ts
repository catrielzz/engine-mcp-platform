import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
  CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
} from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";
import {
  expectErrorMessage,
  type StdioHarness
} from "./test-support/stdio.js";

const MISSING_BOOTSTRAP_PATH =
  "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json";
const GENERATED_OBJECT_NAME = "ResourceProbeCube";
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

describe("@engine-mcp/core-server stdio resources foundation", () => {
  it("lists and reads persisted journal and snapshot metadata resources over stdio", async () => {
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
        snapshotLabel: "resource-read-stdio"
      }
    });
    const snapshotId = deleteResponse.result.structuredContent.snapshotId;

    await requestResult(harness, "tools/call", {
      name: "snapshot.restore",
      arguments: {
        snapshotId
      }
    });

    const listResourcesResponse = await requestResult<{
      resources: Array<{
        uri: string;
        name: string;
        mimeType?: string;
      }>;
    }>(harness, "resources/list");

    expect(listResourcesResponse.result.resources).toEqual(
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

    const journalResourceResponse = await requestResult<{
      contents: Array<{
        uri: string;
        mimeType?: string;
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

    expect(journalResourceResponse.result.contents[0]).toMatchObject({
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

    const snapshotResourceResponse = await requestResult<{
      contents: Array<{
        uri: string;
        mimeType?: string;
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

    expect(snapshotResourceResponse.result.contents[0]).toMatchObject({
      uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI,
      mimeType: "application/json"
    });
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

  it("returns MCP resource-not-found over stdio for unknown resource URIs", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });

    const response = await harness.request("resources/read", {
      uri: "engine-mcp://runtime/unknown-resource"
    });
    const error = expectErrorMessage(response);

    expect(error).toMatchObject({
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
  const rootDir = await mkdtemp(join(tmpdir(), "engine-mcp-core-server-resources-"));
  tempDirs.push(rootDir);
  return rootDir;
}
