import { afterEach, describe, expect, it } from "vitest";

import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
  createCoreServerAdapterRegistry,
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createRecordingEventStore,
  postJson,
  readTextStreamUntil
} from "./test-support/http.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP SSE foundation", () => {
  it("streams POST responses as SSE with priming events when JSON mode is disabled", async () => {
    const recordingStore = createRecordingEventStore();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      eventStoreFactory: () => recordingStore.eventStore,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse",
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
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: message");
    expect(body).toContain("id: event-");
    expect(body).toContain("\"id\":\"init-http-sse\"");
  });

  it("supports GET SSE replay using Last-Event-ID when resumability is enabled", async () => {
    const recordingStore = createRecordingEventStore();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      eventStoreFactory: () => recordingStore.eventStore,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse-replay",
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

    const replayResponse = await fetch(runtime.address.endpointUrl, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25",
        "last-event-id": primingEventIdMatch?.[1] ?? ""
      }
    });

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(recordingStore.replayCalls).toEqual([primingEventIdMatch?.[1]]);

    await replayResponse.body?.cancel();
  });

  it("broadcasts tools/list_changed over standalone GET SSE when the active adapter changes", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createFakeAdapter(
                ["editor.state.read"],
                async () => VALID_SAMPLES["editor.state.read"].output
              )
          },
          {
            name: "registry-scene-delete",
            create: () =>
              createFakeAdapter(["scene.object.delete"], async () => ({
                target: {
                  logicalName: "SandboxRoot/GeneratedCube"
                },
                deleted: true,
                snapshotId: "snapshot-002"
              }))
          }
        ]
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse-switch",
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
    expect(sessionId).toBeTruthy();
    await initializeResponse.text();

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

    const eventPromise = readTextStreamUntil(
      streamResponse.body,
      "\"method\":\"notifications/tools/list_changed\""
    );

    await runtime.selectAdapter("registry-scene-delete");

    await expect(eventPromise).resolves.toContain("\"method\":\"notifications/tools/list_changed\"");
  });

  it("broadcasts notifications/resources/updated over standalone GET SSE when adapter-state is subscribed", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createFakeAdapter(
                ["editor.state.read"],
                async () => VALID_SAMPLES["editor.state.read"].output
              )
          },
          {
            name: "registry-scene-delete",
            create: () =>
              createFakeAdapter(["scene.object.delete"], async () => ({
                target: {
                  logicalName: "SandboxRoot/GeneratedCube"
                },
                deleted: true,
                snapshotId: "snapshot-002"
              }))
          }
        ]
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse-resource",
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
    expect(sessionId).toBeTruthy();
    await initializeResponse.text();

    const subscribeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "subscribe-http-resource",
        method: "resources/subscribe",
        params: {
          uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? ""
      }
    );

    expect(subscribeResponse.status).toBe(200);
    await subscribeResponse.text();

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

    const eventPromise = readTextStreamUntil(
      streamResponse.body,
      "\"method\":\"notifications/resources/updated\""
    );

    await runtime.selectAdapter("registry-scene-delete");

    await expect(eventPromise).resolves.toContain(
      `"uri":"${CORE_SERVER_ADAPTER_STATE_RESOURCE_URI}"`
    );
  });

  it("broadcasts notifications/message over standalone GET SSE when the runtime sends a log message", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse-log",
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
    expect(sessionId).toBeTruthy();
    await initializeResponse.text();

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

    const eventPromise = readTextStreamUntil(
      streamResponse.body,
      "\"method\":\"notifications/message\""
    );

    await runtime.sendLoggingMessage(
      {
        level: "info",
        data: "http runtime log message"
      },
      sessionId ?? undefined
    );

    await expect(eventPromise).resolves.toContain("\"data\":\"http runtime log message\"");
  });

  it("emits notifications/progress in SSE tool responses when the client provides a progress token", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        await request.context?.sendProgress({
          progress: 1,
          total: 3,
          message: "Streaming editor state"
        });

        return VALID_SAMPLES["editor.state.read"].output;
      })
    });
    openServers.push(runtime);

    const initializeResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-sse-progress",
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
    expect(sessionId).toBeTruthy();
    await initializeResponse.text();

    const response = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "tools-call-http-sse-progress",
        method: "tools/call",
        params: {
          name: "editor.state.read",
          arguments: VALID_SAMPLES["editor.state.read"].input,
          _meta: {
            progressToken: "progress-http-1"
          }
        }
      },
      {
        origin: "http://localhost:4100",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("\"method\":\"notifications/progress\"");
    expect(body).toContain("\"progressToken\":\"progress-http-1\"");
    expect(body).toContain("\"message\":\"Streaming editor state\"");
    expect(body).toContain("\"id\":\"tools-call-http-sse-progress\"");
  });
});
