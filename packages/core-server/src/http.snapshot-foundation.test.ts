import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryJournalService,
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { createFakeAdapter, VALID_SAMPLES } from "./test-support/fixtures.js";
import {
  callHttpJsonRpc,
  initializeHttpClientSession
} from "./test-support/http-client-requests.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP snapshot foundation", () => {
  it("records snapshot linkage for successful destructive inline tools/call", async () => {
    const journalService = createInMemoryJournalService();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      journalService,
      adapter: createFakeAdapter(
        ["scene.object.delete"],
        async () => VALID_SAMPLES["scene.object.delete"].output
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-snapshot-foundation",
      capabilities: {}
    });

    const callToolResponse = await callHttpJsonRpc(session, {
      requestId: "call-http-snapshot-success",
      method: "tools/call",
      params: {
        name: "scene.object.delete",
        arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
      }
    });
    const callToolBody = (await callToolResponse.json()) as {
      result: {
        isError?: boolean;
        structuredContent: Record<string, unknown>;
      };
    };

    expect(callToolResponse.status).toBe(200);
    expect(callToolBody.result.isError).toBeUndefined();
    expect(callToolBody.result.structuredContent).toEqual(
      VALID_SAMPLES["scene.object.delete"].output
    );

    const entries = await journalService.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      capability: "scene.object.delete",
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: true
      },
      result: {
        status: "succeeded"
      }
    });
  });
});
