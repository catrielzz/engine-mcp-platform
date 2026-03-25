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

describe("@engine-mcp/core-server Streamable HTTP journal foundation", () => {
  it("records success and denial journal entries for inline tools/call", async () => {
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
      requestId: "init-http-journal",
      capabilities: {}
    });

    await callHttpJsonRpc(session, {
      requestId: "call-http-journal-success",
      method: "tools/call",
      params: {
        name: "scene.object.delete",
        arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
      }
    });
    await callHttpJsonRpc(session, {
      requestId: "call-http-journal-deny",
      method: "tools/call",
      params: {
        name: "scene.object.delete",
        arguments: {
          target: {
            logicalName: "ProductionRoot/BossArena"
          },
          snapshotLabel: "pre-delete"
        }
      }
    });

    const entries = await journalService.list();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      result: {
        status: "succeeded"
      }
    });
    expect(entries[1]).toMatchObject({
      result: {
        status: "denied",
        error: {
          code: "policy_denied",
          message: "target_outside_sandbox"
        }
      }
    });
  });
});
