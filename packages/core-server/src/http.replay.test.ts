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

async function openReplayStream(options: {
  endpointUrl: string;
  sessionId: string;
  lastEventId: string;
  attempts?: number;
}): Promise<Response> {
  const attempts = options.attempts ?? 10;

  for (let index = 0; index < attempts; index += 1) {
    const response = await fetch(options.endpointUrl, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        origin: "http://localhost:4100",
        "mcp-session-id": options.sessionId,
        "mcp-protocol-version": "2025-11-25",
        "last-event-id": options.lastEventId
      }
    });

    if (response.status !== 409) {
      return response;
    }

    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Replay stream stayed in 409 Conflict after closing the original stream.");
}

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP replay", () => {
  it("streams task status over standalone GET SSE and replays a disconnected tasks/result stream", async () => {
    const completion = createDeferred<void>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async () => {
        await completion.promise;
        return VALID_SAMPLES["editor.state.read"].output;
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-task-sse",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
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
    const primingEventIdMatch = initializeBody.match(/id: (event-\d+)/);
    expect(sessionId).toBeTruthy();
    expect(primingEventIdMatch?.[1]).toBeTruthy();

    const streamResponse = await fetch(runtime.address.endpointUrl, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");

    const statusNotificationPromise = readTextStreamUntil(
      streamResponse.body,
      "\"method\":\"notifications/tasks/status\""
    );

    const taskCreateResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tools-call-http-task-sse",
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
    const taskCreateBody = await taskCreateResponse.text();
    const taskId = taskCreateBody.match(/"taskId":"([^"]+)"/)?.[1];
    expect(taskCreateResponse.status).toBe(200);
    expect(taskCreateResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(taskId).toBeTruthy();
    expect(taskCreateBody).toContain("\"status\":\"working\"");

    const taskResultResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tasks-result-http-task-sse",
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
    const taskResultReader = createTextStreamReader(taskResultResponse.body);
    const taskResultPrimingBody = await taskResultReader.readUntil("id: event-");
    const taskResultStreamEventId = taskResultPrimingBody.match(/id: (event-\d+)/)?.[1];
    expect(taskResultResponse.status).toBe(200);
    expect(taskResultResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(taskResultStreamEventId).toBeTruthy();

    await taskResultReader.close();

    const replayResponse = await openReplayStream({
      endpointUrl: runtime.address.endpointUrl,
      sessionId: sessionId ?? "",
      lastEventId: taskResultStreamEventId ?? ""
    });
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("content-type")).toContain("text/event-stream");

    completion.resolve();

    await expect(statusNotificationPromise).resolves.toContain(`\"taskId\":\"${taskId}\"`);
    await expect(statusNotificationPromise).resolves.toContain("\"status\":\"completed\"");

    const replayBodyPromise = readTextStreamUntil(
      replayResponse.body,
      "\"id\":\"tasks-result-http-task-sse\""
    );
    await expect(replayBodyPromise).resolves.toContain("\"structuredContent\"");
    await expect(replayBodyPromise).resolves.toContain("\"workspaceName\":\"SandboxProject\"");
  });
});
