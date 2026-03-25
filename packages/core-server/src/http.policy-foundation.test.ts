import { afterEach, describe, expect, it, vi } from "vitest";

import { startCoreServerStreamableHttp, type EngineMcpStreamableHttpServerRuntime } from "./index.js";
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

describe("@engine-mcp/core-server Streamable HTTP policy foundation", () => {
  it("denies destructive scene mutations outside the sandbox before adapter execution", async () => {
    const invoke = vi.fn(async () => VALID_SAMPLES["scene.object.delete"].output);
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["scene.object.delete"], invoke)
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-policy-preflight",
      capabilities: {}
    });

    const callToolResponse = await callHttpJsonRpc(session, {
      requestId: "call-http-policy-preflight",
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
    const callToolBody = (await callToolResponse.json()) as {
      result: {
        isError: boolean;
        structuredContent: {
          error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
          };
        };
      };
    };

    expect(callToolResponse.status).toBe(200);
    expect(callToolBody.result.isError).toBe(true);
    expect(callToolBody.result.structuredContent.error).toEqual({
      code: "policy_denied",
      message: "target_outside_sandbox",
      details: {
        riskClass: "destructive",
        requiredScopes: ["write", "project"],
        requiresSnapshot: true,
        sandboxOnly: true,
        targetLogicalName: "ProductionRoot/BossArena"
      }
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
