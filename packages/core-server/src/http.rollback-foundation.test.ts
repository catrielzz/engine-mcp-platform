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

describe("@engine-mcp/core-server Streamable HTTP rollback foundation", () => {
  it("journals snapshot.restore as rolled_back over Streamable HTTP", async () => {
    const journalService = createInMemoryJournalService();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      journalService,
      adapter: createFakeAdapter(
        ["snapshot.restore"],
        async () => VALID_SAMPLES["snapshot.restore"].output
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-rollback-foundation",
      capabilities: {}
    });

    const callToolResponse = await callHttpJsonRpc(session, {
      requestId: "call-http-rollback-success",
      method: "tools/call",
      params: {
        name: "snapshot.restore",
        arguments: VALID_SAMPLES["snapshot.restore"].input as Record<string, unknown>
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
      VALID_SAMPLES["snapshot.restore"].output
    );

    const entries = await journalService.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      capability: "snapshot.restore",
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: false
      },
      result: {
        status: "rolled_back"
      }
    });
  });
});
