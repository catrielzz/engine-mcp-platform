import { ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { VALID_SAMPLES, createDeferred, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createTextStreamReader,
  postJson,
  readTextStreamUntil
} from "./test-support/http.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP roots", () => {
  it("delivers queued roots/list requests through tasks/result over Streamable HTTP SSE", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        const taskContext = request.context;
        if (!taskContext?.sendRequest) {
          throw new Error("Missing task sendRequest helper.");
        }

        const rootsResult = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };

        return {
          ...VALID_SAMPLES["editor.state.read"].output,
          workspaceName:
            rootsResult.roots[0]?.name ?? VALID_SAMPLES["editor.state.read"].output.workspaceName
        };
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-task-roots",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {
            roots: {}
          },
          clientInfo: {
            name: "vitest-http",
            version: "1.0.0"
          }
        }
      },
      {
        origin: "http://localhost:4100"
      }
    );
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    const initializeBody = await initializeResponse.text();
    expect(sessionId).toBeTruthy();
    expect(initializeBody).toContain("\"id\":\"init-http-task-roots\"");

    const taskCreatedResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tools-call-http-task-roots",
        method: "tools/call",
        params: {
          name: "editor.state.read",
          arguments: VALID_SAMPLES["editor.state.read"].input,
          task: {
            ttl: 1_500
          }
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    const taskCreatedBody = await taskCreatedResponse.text();
    const taskId = taskCreatedBody.match(/"taskId":"([^"]+)"/)?.[1];
    expect(taskCreatedResponse.status).toBe(200);
    expect(taskCreatedResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(taskId).toBeTruthy();
    expect(taskCreatedBody).toContain("\"status\":\"input_required\"");

    const taskResultStream = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tasks-result-http-task-roots",
        method: "tasks/result",
        params: {
          taskId
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    expect(taskResultStream.status).toBe(200);
    expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");

    const rootsRequestBody = await readTextStreamUntil(
      taskResultStream.body,
      "\"method\":\"roots/list\""
    );
    const rootsRequestId = rootsRequestBody.match(/\"id\":([0-9]+)/)?.[1];
    expect(rootsRequestBody).toContain(`\"taskId\":\"${taskId}\"`);
    expect(rootsRequestId).toBeTruthy();

    const rootsResponseAck = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: Number(rootsRequestId),
        result: {
          roots: [
            {
              uri: "file:///sandbox-root",
              name: "SandboxFromRoots"
            }
          ]
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    expect(rootsResponseAck.status).toBe(202);

    const finalTaskResultResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tasks-result-http-task-roots-final",
        method: "tasks/result",
        params: {
          taskId
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    const finalTaskResultBody = await readTextStreamUntil(
      finalTaskResultResponse.body,
      "\"structuredContent\""
    );
    expect(finalTaskResultResponse.status).toBe(200);
    expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromRoots\"");
    expect(finalTaskResultBody).toContain("\"id\":\"tasks-result-http-task-roots-final\"");
  });

  it("invalidates cached roots/list results when the client emits roots/list_changed over Streamable HTTP", async () => {
    const continueAfterInvalidation = createDeferred<void>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        const taskContext = request.context;
        if (!taskContext?.sendRequest) {
          throw new Error("Missing task sendRequest helper.");
        }

        const firstRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };
        await continueAfterInvalidation.promise;
        const secondRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };

        return {
          ...VALID_SAMPLES["editor.state.read"].output,
          workspaceName: `${firstRoots.roots[0]?.name ?? "missing"}|${secondRoots.roots[0]?.name ?? "missing"}`
        };
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-task-roots-invalidation",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {
            roots: {
              listChanged: true
            }
          },
          clientInfo: {
            name: "vitest-http",
            version: "1.0.0"
          }
        }
      },
      {
        origin: "http://localhost:4100"
      }
    );
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    await initializeResponse.text();
    expect(sessionId).toBeTruthy();

    const taskCreatedResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tools-call-http-task-roots-invalidation",
        method: "tools/call",
        params: {
          name: "editor.state.read",
          arguments: VALID_SAMPLES["editor.state.read"].input,
          task: {
            ttl: 1_500
          }
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    const taskCreatedBody = await taskCreatedResponse.text();
    const taskId = taskCreatedBody.match(/"taskId":"([^"]+)"/)?.[1];
    expect(taskId).toBeTruthy();

    const taskResultStream = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tasks-result-http-task-roots-invalidation",
        method: "tasks/result",
        params: {
          taskId
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    const streamReader = createTextStreamReader(taskResultStream.body);

    try {
      const firstRootsRequestBody = await streamReader.readUntil(
        "\"method\":\"roots/list\"",
        2_000,
        1
      );
      const firstRootsRequestId = firstRootsRequestBody.match(/\"id\":([0-9]+)/)?.[1];
      expect(firstRootsRequestBody).toContain(`\"taskId\":\"${taskId}\"`);
      expect(firstRootsRequestId).toBeTruthy();

      const firstRootsResponseAck = await postJson(
        runtime.address.endpointUrl,
        {
          jsonrpc: "2.0",
          id: Number(firstRootsRequestId),
          result: {
            roots: [
              {
                uri: "file:///sandbox-root",
                name: "InitialRoot"
              }
            ]
          }
        },
        {
          origin: "http://localhost:4100",
          "mcp-session-id": sessionId ?? "",
          "mcp-protocol-version": "2025-11-25"
        }
      );
      expect(firstRootsResponseAck.status).toBe(202);

      const rootsListChangedAck = await postJson(
        runtime.address.endpointUrl,
        {
          jsonrpc: "2.0",
          method: "notifications/roots/list_changed"
        },
        {
          origin: "http://localhost:4100",
          "mcp-session-id": sessionId ?? "",
          "mcp-protocol-version": "2025-11-25"
        }
      );
      expect(rootsListChangedAck.status).toBe(202);

      continueAfterInvalidation.resolve();

      const secondRootsRequestBody = await streamReader.readUntil(
        "\"method\":\"roots/list\"",
        2_000,
        2
      );
      const rootsRequestIds = [...secondRootsRequestBody.matchAll(/\"id\":([0-9]+)/g)].map(
        (match) => match[1]
      );
      const secondRootsRequestId = rootsRequestIds.at(-1);
      expect(secondRootsRequestId).toBeTruthy();
      expect(Number(secondRootsRequestId)).not.toBe(Number(firstRootsRequestId));

      const secondRootsResponseAck = await postJson(
        runtime.address.endpointUrl,
        {
          jsonrpc: "2.0",
          id: Number(secondRootsRequestId),
          result: {
            roots: [
              {
                uri: "file:///sandbox-root-updated",
                name: "UpdatedRoot"
              }
            ]
          }
        },
        {
          origin: "http://localhost:4100",
          "mcp-session-id": sessionId ?? "",
          "mcp-protocol-version": "2025-11-25"
        }
      );
      expect(secondRootsResponseAck.status).toBe(202);

      const finalTaskResultResponse = await postJson(
        runtime.address.endpointUrl,
        {
          jsonrpc: "2.0",
          id: "tasks-result-http-task-roots-invalidation-final",
          method: "tasks/result",
          params: {
            taskId
          }
        },
        {
          origin: "http://localhost:4100",
          "mcp-session-id": sessionId ?? "",
          "mcp-protocol-version": "2025-11-25"
        }
      );
      const finalTaskResultBody = await readTextStreamUntil(
        finalTaskResultResponse.body,
        "\"structuredContent\""
      );
      expect(finalTaskResultBody).toContain("\"workspaceName\":\"InitialRoot|UpdatedRoot\"");
    } finally {
      await streamReader.close();
    }
  });
});
