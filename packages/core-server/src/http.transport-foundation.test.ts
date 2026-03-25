import { afterEach, describe, expect, it, vi } from "vitest";
import { UNITY_BRIDGE_PROMPT_PACK } from "@engine-mcp/unity-bridge";
import {
  ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
  ENGINE_TEST_CATALOG_RESOURCE_URI
} from "@engine-mcp/contracts";

import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
  CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH,
  DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENT_AGE_MS,
  DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS,
  DEFAULT_STREAMABLE_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_STREAMABLE_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_STREAMABLE_HTTP_REQUEST_TIMEOUT_MS,
  createStaticBearerAuthorization,
  createInMemoryEventStore,
  createCoreServerAdapterRegistry,
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
  deleteRequest,
  getJson,
  postJson,
  rawPostWithHostHeader,
  readWwwAuthenticateParameter
} from "./test-support/http.js";
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

describe("@engine-mcp/core-server Streamable HTTP transport foundation", () => {
  it("applies explicit Streamable HTTP hardening defaults to the Node server", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    expect(runtime.httpServer.requestTimeout).toBe(DEFAULT_STREAMABLE_HTTP_REQUEST_TIMEOUT_MS);
    expect(runtime.httpServer.headersTimeout).toBe(DEFAULT_STREAMABLE_HTTP_HEADERS_TIMEOUT_MS);
    expect(runtime.httpServer.keepAliveTimeout).toBe(DEFAULT_STREAMABLE_HTTP_KEEP_ALIVE_TIMEOUT_MS);
  });

  it("lists and reads the adapter-state resource over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
          }
        ]
      })
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-resource-list",
      capabilities: {}
    });

    const listResourcesResponse = await callHttpJsonRpc(session, {
      requestId: "resource-list-http",
      method: "resources/list"
    });
    const listResourcesBody = (await listResourcesResponse.json()) as {
      result: {
        resources: Array<{
          uri: string;
          name: string;
          mimeType: string;
        }>;
      };
    };

    expect(listResourcesResponse.status).toBe(200);
    expect(listResourcesBody.result.resources).toContainEqual(
      expect.objectContaining({
        uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
        name: "adapter-state",
        mimeType: "application/json"
      })
    );

    const readResourceResponse = await callHttpJsonRpc(session, {
      requestId: "resource-read-http",
      method: "resources/read",
      params: {
        uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
      }
    });
    const readResourceBody = (await readResourceResponse.json()) as {
      result: {
        contents: Array<{
          uri: string;
          mimeType: string;
          text: string;
        }>;
      };
    };
    const adapterState = JSON.parse(readResourceBody.result.contents[0].text) as Record<
      string,
      unknown
    >;

    expect(readResourceResponse.status).toBe(200);
    expect(readResourceBody.result.contents[0]).toMatchObject({
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
      mimeType: "application/json"
    });
    expect(adapterState).toMatchObject({
      selectedAdapter: "registry-read",
      adapterId: "fake-core-server-adapter",
      toolCount: 1,
      health: {
        status: "ready"
      }
    });
    expect(adapterState.availableAdapters).toEqual(expect.arrayContaining(["unity", "registry-read"]));
  });

  it("lists and reads adapter discovery resources over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        ["test.job.read"],
        async () => ({
          jobId: "job-001",
          status: "completed"
        }),
        {
          listResources: () => [
            {
              uri: ENGINE_TEST_CATALOG_RESOURCE_URI,
              name: "test-catalog",
              title: "Test Catalog",
              description: "Observed test identifiers available to the active engine adapter.",
              mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
            }
          ],
          readResource: (uri) =>
            uri === ENGINE_TEST_CATALOG_RESOURCE_URI
              ? {
                  uri,
                  mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
                  text: JSON.stringify({
                    adapterId: "fake-core-server-adapter",
                    tests: ["Sandbox.EditMode.GeneratedTest"]
                  })
                }
              : undefined
        }
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-discovery-resources",
      capabilities: {}
    });

    const listResourcesResponse = await callHttpJsonRpc(session, {
      requestId: "resource-list-http-discovery",
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

    expect(listResourcesResponse.status).toBe(200);
    expect(listResourcesBody.result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: ENGINE_TEST_CATALOG_RESOURCE_URI,
          name: "test-catalog",
          mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
        })
      ])
    );

    const readResourceResponse = await callHttpJsonRpc(session, {
      requestId: "resource-read-http-discovery",
      method: "resources/read",
      params: {
        uri: ENGINE_TEST_CATALOG_RESOURCE_URI
      }
    });
    const readResourceBody = (await readResourceResponse.json()) as {
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
          text: string;
        }>;
      };
    };

    expect(readResourceResponse.status).toBe(200);
    expect(readResourceBody.result.contents[0]).toMatchObject({
      uri: ENGINE_TEST_CATALOG_RESOURCE_URI,
      mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
    });
    expect(JSON.parse(readResourceBody.result.contents[0].text)).toEqual({
      adapterId: "fake-core-server-adapter",
      tests: ["Sandbox.EditMode.GeneratedTest"]
    });
  });

  it("evicts oldest replay events per stream when the configured max is reached", async () => {
    const eventStore = createInMemoryEventStore({
      maxEventsPerStream: 2
    });
    const getStreamIdForEventId = eventStore.getStreamIdForEventId!;
    const replayEventsAfter = eventStore.replayEventsAfter!;
    const firstEventId = await eventStore.storeEvent("stream-a", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        kind: "first"
      }
    });
    const secondEventId = await eventStore.storeEvent("stream-a", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        kind: "second"
      }
    });
    const thirdEventId = await eventStore.storeEvent("stream-a", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        kind: "third"
      }
    });
    const replayed: Array<{
      eventId: string;
      message: unknown;
    }> = [];

    expect(await getStreamIdForEventId(firstEventId)).toBeUndefined();
    expect(await getStreamIdForEventId(secondEventId)).toBe("stream-a");

    const replayedStreamId = await replayEventsAfter(secondEventId, {
      send: async (eventId, message) => {
        replayed.push({
          eventId,
          message
        });
      }
    });

    expect(replayedStreamId).toBe("stream-a");
    expect(replayed).toEqual([
      {
        eventId: thirdEventId,
        message: {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            kind: "third"
          }
        }
      }
    ]);
  });

  it("evicts expired replay events when maxEventAgeMs is configured", async () => {
    let now = 0;
    const eventStore = createInMemoryEventStore({
      maxEventAgeMs: 150,
      now: () => now
    });
    const getStreamIdForEventId = eventStore.getStreamIdForEventId!;
    const replayEventsAfter = eventStore.replayEventsAfter!;
    const firstEventId = await eventStore.storeEvent("stream-b", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        kind: "first"
      }
    });

    now = 50;
    const secondEventId = await eventStore.storeEvent("stream-b", {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        kind: "second"
      }
    });

    now = 220;

    expect(await getStreamIdForEventId(firstEventId)).toBeUndefined();
    expect(await getStreamIdForEventId(secondEventId)).toBeUndefined();
    await expect(
      replayEventsAfter(firstEventId, {
        send: async () => undefined
      })
    ).rejects.toThrow("Unknown event id");
  });

  it("periodically prunes expired replay events and clears retained state on cleanup", async () => {
    let now = 0;
    vi.useFakeTimers();

    try {
      expect(DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENT_AGE_MS).toBeGreaterThan(0);
      expect(DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS).toBeGreaterThan(0);

      const eventStore = createInMemoryEventStore({
        maxEventAgeMs: 100,
        pruneIntervalMs: 10,
        now: () => now
      }) as ReturnType<typeof createInMemoryEventStore> & {
        cleanup(): void;
      };
      const firstEventId = await eventStore.storeEvent("stream-c", {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          kind: "first"
        }
      });

      expect(await eventStore.getStreamIdForEventId?.(firstEventId)).toBe("stream-c");

      now = 150;
      await vi.advanceTimersByTimeAsync(10);

      expect(await eventStore.getStreamIdForEventId?.(firstEventId)).toBeUndefined();

      const secondEventId = await eventStore.storeEvent("stream-c", {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          kind: "second"
        }
      });
      expect(await eventStore.getStreamIdForEventId?.(secondEventId)).toBe("stream-c");

      eventStore.cleanup();

      expect(await eventStore.getStreamIdForEventId?.(secondEventId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls cleanup on custom per-session event stores when the HTTP session is deleted", async () => {
    const cleanup = vi.fn();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      eventStoreFactory: () => {
        const eventStore = createInMemoryEventStore() as ReturnType<typeof createInMemoryEventStore> & {
          cleanup(): void;
        };
        const originalCleanup = eventStore.cleanup.bind(eventStore);

        return {
          ...eventStore,
          cleanup() {
            cleanup();
            originalCleanup();
          }
        };
      },
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const authorizedInitialize = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-custom-event-store",
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
    const sessionId = authorizedInitialize.headers.get("mcp-session-id");

    expect(authorizedInitialize.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const deleteResponse = await deleteRequest(runtime.address.endpointUrl, {
      "mcp-session-id": sessionId ?? "",
      "mcp-protocol-version": "2025-11-25"
    });

    expect(deleteResponse.status).toBe(200);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("allows custom event stores without cleanup hooks", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
      eventStoreFactory: () => {
        const eventStore = createInMemoryEventStore() as ReturnType<typeof createInMemoryEventStore> & {
          cleanup(): void;
        };
        const { cleanup: _cleanup, ...storeWithoutCleanup } = eventStore;
        return storeWithoutCleanup;
      },
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const authorizedInitialize = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-custom-event-store-no-cleanup",
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
    const sessionId = authorizedInitialize.headers.get("mcp-session-id");

    expect(authorizedInitialize.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const deleteResponse = await deleteRequest(runtime.address.endpointUrl, {
      "mcp-session-id": sessionId ?? "",
      "mcp-protocol-version": "2025-11-25"
    });

    expect(deleteResponse.status).toBe(200);
  });

  it("boots over Streamable HTTP with a session id and routes canonical tools", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const { session, initializeResponse, initializeBody } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-1",
      capabilities: {}
    });

    expect(initializeResponse.status).toBe(200);
    expect(session.sessionId).toBeTruthy();
    expect(JSON.parse(initializeBody)).toMatchObject({
      result: {
        serverInfo: {
          name: "@engine-mcp/core-server"
        },
        capabilities: {
          completions: {},
          prompts: {
            listChanged: true
          }
        }
      }
    });

    const listToolsResponse = await callHttpJsonRpc(session, {
      requestId: "list-http-1",
      method: "tools/list",
      params: {}
    });

    expect(listToolsResponse.status).toBe(200);
    await expect(listToolsResponse.json()).resolves.toMatchObject({
      result: {
        tools: [
          {
            name: "editor.state.read"
          }
        ]
      }
    });
  });

  it("lists and renders platform prompts over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        ["editor.state.read", "scene.object.create", "snapshot.restore"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });
    openServers.push(runtime);

    const { session, initializeBody } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-prompts",
      capabilities: {}
    });

    expect(JSON.parse(initializeBody)).toMatchObject({
      result: {
        capabilities: {
          completions: {},
          prompts: {
            listChanged: true
          }
        }
      }
    });

    const listPromptsResponse = await callHttpJsonRpc(session, {
      requestId: "prompts-list-http",
      method: "prompts/list"
    });
    const listPromptsBody = (await listPromptsResponse.json()) as {
      result: {
        prompts: Array<{
          name: string;
        }>;
      };
    };

    expect(listPromptsResponse.status).toBe(200);
    expect(listPromptsBody.result.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "scene.object.create.workflow"
        }),
        expect.objectContaining({
          name: "snapshot.restore.workflow"
        })
      ])
    );

    const getPromptResponse = await callHttpJsonRpc(session, {
      requestId: "prompt-get-http",
      method: "prompts/get",
      params: {
        name: "test.failure.triage",
        arguments: {
          failing_test: "Sandbox_CreatesObject",
          failure_output: "Expected object to exist after create",
          suspect_assets: "Assets/Scripts/Spawner.cs",
          desired_outcome: "Find the most likely root cause"
        }
      }
    });
    const getPromptBody = (await getPromptResponse.json()) as {
      result: {
        description?: string;
        messages: Array<{
          role: string;
          content: {
            type: string;
            text: string;
          };
        }>;
      };
    };

    expect(getPromptResponse.status).toBe(200);
    expect(getPromptBody.result.description).toBe(
      "Investigate a failing editor-side test run using canonical Engine MCP read-only tools before proposing a fix."
    );
    expect(getPromptBody.result.messages[1]?.content.text).toContain(
      "Triaging failing test: Sandbox_CreatesObject"
    );
    expect(getPromptBody.result.messages[1]?.content.text).toContain(
      "Suspect assets: Assets/Scripts/Spawner.cs"
    );
  });

  it("lists and renders Unity adapter prompt packs over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        [
          "editor.state.read",
          "console.read",
          "script.validate"
        ],
        async () => VALID_SAMPLES["editor.state.read"].output,
        {
          prompts: UNITY_BRIDGE_PROMPT_PACK
        }
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-unity-prompts",
      capabilities: {}
    });

    const listPromptsResponse = await callHttpJsonRpc(session, {
      requestId: "prompts-list-http-unity",
      method: "prompts/list"
    });
    const listPromptsBody = (await listPromptsResponse.json()) as {
      result: {
        prompts: Array<{
          name: string;
        }>;
      };
    };
    const promptNames = listPromptsBody.result.prompts.map(({ name }) => name);

    expect(listPromptsResponse.status).toBe(200);
    expect(promptNames).toEqual(
      expect.arrayContaining([
        "test.failure.triage",
        "unity.script.validate.fix-plan"
      ])
    );
    expect(promptNames).not.toContain("unity.scene.object.create.gameobject");

    const getPromptResponse = await callHttpJsonRpc(session, {
      requestId: "prompt-get-http-unity",
      method: "prompts/get",
      params: {
        name: "unity.script.validate.fix-plan",
        arguments: {
          objective: "Find the smallest safe fix plan",
          script_path: "Assets/Scripts/Spawner.cs",
          failure_signal: "CS0103: The name spawnRoot does not exist in the current context",
          suspect_dependencies: "Assets/Prefabs/Spawner.prefab",
          desired_outcome: "Root cause and next code change"
        }
      }
    });
    const getPromptBody = (await getPromptResponse.json()) as {
      result: {
        description?: string;
        messages: Array<{
          role: string;
          content: {
            type: string;
            text: string;
          };
        }>;
      };
    };

    expect(getPromptResponse.status).toBe(200);
    expect(getPromptBody.result.description).toBe(
      "Investigate a Unity script or compile failure with validation and console evidence before proposing the smallest safe fix."
    );
    expect(getPromptBody.result.messages[1]?.content.text).toContain(
      "Primary script: Assets/Scripts/Spawner.cs"
    );
  });

  it("completes Unity prompt arguments over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        [
          "editor.state.read",
          "console.read",
          "script.validate",
          "asset.search"
        ],
        async (request) => {
          if (request.capability === "asset.search") {
            return VALID_SAMPLES["asset.search"].output;
          }

          return VALID_SAMPLES["editor.state.read"].output;
        },
        {
          prompts: UNITY_BRIDGE_PROMPT_PACK
        }
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-unity-completions",
      capabilities: {}
    });

    const completionResponse = await callHttpJsonRpc(session, {
      requestId: "prompt-complete-http-unity",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/prompt",
          name: "unity.script.validate.fix-plan"
        },
        argument: {
          name: "script_path",
          value: "Spawner"
        }
      }
    });
    const completionBody = (await completionResponse.json()) as {
      result: {
        completion: {
          values: string[];
          total: number;
          hasMore?: boolean;
        };
      };
    };

    expect(completionResponse.status).toBe(200);
    expect(completionBody.result.completion).toMatchObject({
      values: [
        "Assets/Scripts/Spawner.cs",
        "Assets/Scripts/SpawnerAuthoring.cs"
      ],
      total: 2
    });
  });

  it("completes adapter-backed test identifiers over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(
        ["test.run", "test.job.read"],
        async () => ({
          jobId: "job-001",
          status: "completed"
        }),
        {
          completePromptArgument: async ({ provider }) =>
            provider === "engine.test_name"
              ? [
                  "Sandbox.EditMode.GeneratedTest",
                  "Gameplay.EditMode.CheckpointTests.CreatesMarker",
                  "Gameplay.PlayMode.CheckpointTests.RestoresSnapshot"
                ]
              : []
        }
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-test-name-completions",
      capabilities: {}
    });

    const completionResponse = await callHttpJsonRpc(session, {
      requestId: "prompt-complete-http-test-name",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/prompt",
          name: "test.failure.triage"
        },
        argument: {
          name: "failing_test",
          value: "checkpoint"
        }
      }
    });
    const completionBody = (await completionResponse.json()) as {
      result: {
        completion: {
          values: string[];
          total: number;
        };
      };
    };

    expect(completionResponse.status).toBe(200);
    expect(completionBody.result.completion).toEqual({
      values: [
        "Gameplay.EditMode.CheckpointTests.CreatesMarker",
        "Gameplay.PlayMode.CheckpointTests.RestoresSnapshot"
      ],
      total: 2
    });
  });

  it("returns flattened policy decision errors over JSON Streamable HTTP tool calls", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["scene.object.delete"], async () => {
        throw Object.assign(new Error("Adapter-local policy wording."), {
          decision: {
            allowed: false,
            code: "policy_denied",
            reason: "rollback_unavailable",
            details: {
              capability: "snapshot.restore",
              snapshotId: "snapshot-missing"
            }
          }
        });
      })
    });
    openServers.push(runtime);

    const { session, initializeResponse } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-policy-error",
      capabilities: {}
    });

    expect(initializeResponse.status).toBe(200);
    expect(session.sessionId).toBeTruthy();

    const callToolResponse = await callHttpJsonRpc(session, {
      requestId: "call-http-policy-error",
      method: "tools/call",
      params: {
        name: "scene.object.delete",
        arguments: {
          target: {
            logicalName: "SandboxRoot/GeneratedCubeRenamed"
          },
          snapshotLabel: "sandbox-pre-delete"
        }
      }
    });

    expect(callToolResponse.status).toBe(200);
    await expect(callToolResponse.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: {
            code: "policy_denied",
            message: "rollback_unavailable",
            details: {
              capability: "snapshot.restore",
              snapshotId: "snapshot-missing"
            }
          }
        },
        _meta: {
          "engine-mcp/errorCode": "policy_denied"
        }
      }
    });
  });

  it("rejects non-initialize HTTP requests without a session id", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "list-http-no-session",
        method: "tools/list",
        params: {}
      },
      {
        origin: "http://localhost:4100"
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("Session")
      }
    });
  });

  it("rejects oversized JSON request bodies with HTTP 413", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      maxRequestBodyBytes: 256,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await fetch(runtime.address.endpointUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        origin: "http://localhost:4100"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-http-oversized",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: "vitest-http",
            version: "x".repeat(512)
          }
        }
      })
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Request body exceeds the 256-byte limit.",
        data: {
          maxRequestBodyBytes: 256
        }
      },
      id: null
    });
  });

  it("rejects invalid Origin headers with HTTP 403", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-origin",
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
        origin: "https://evil.example"
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("Origin")
      }
    });
  });

  it("rejects invalid Host headers with HTTP 403", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await rawPostWithHostHeader({
      host: runtime.address.host,
      port: runtime.address.port,
      path: runtime.address.path,
      hostHeader: "evil.example",
      origin: "http://localhost:4100",
      body: {
        jsonrpc: "2.0",
        id: "init-http-host",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: "vitest-http",
            version: "1.0.0"
          }
        }
      }
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        message: expect.stringContaining("Host")
      }
    });
  });

  it("serves OAuth protected resource metadata at well-known endpoints", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      authorization: createStaticBearerAuthorization({
        token: "access-token",
        authorizationServers: ["https://auth.example.com"],
        scopesSupported: ["mcp"]
      }),
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const rootMetadataResponse = await getJson(
      new URL(CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH, runtime.address.endpointUrl).toString()
    );
    const pathMetadataResponse = await getJson(
      new URL(
        `${CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH}${runtime.address.path}`,
        runtime.address.endpointUrl
      ).toString()
    );

    expect(rootMetadataResponse.status).toBe(200);
    await expect(rootMetadataResponse.json()).resolves.toMatchObject({
      resource: runtime.address.endpointUrl,
      authorization_servers: ["https://auth.example.com/"],
      scopes_supported: ["mcp"]
    });

    expect(pathMetadataResponse.status).toBe(200);
    await expect(pathMetadataResponse.json()).resolves.toMatchObject({
      resource: runtime.address.endpointUrl,
      authorization_servers: ["https://auth.example.com/"],
      scopes_supported: ["mcp"]
    });
  });

  it("uses OAuth-style bearer challenges with resource metadata and invalidates deleted sessions", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      authorization: createStaticBearerAuthorization({
        token: "access-token",
        authorizationServers: ["https://auth.example.com"],
        scopesSupported: ["mcp"],
        requiredScopes: ["mcp"]
      }),
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const unauthorizedInitialize = await postJson(runtime.address.endpointUrl, {
      jsonrpc: "2.0",
      id: "init-http-unauthorized",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "vitest-http",
          version: "1.0.0"
        }
      }
    });

    expect(unauthorizedInitialize.status).toBe(401);
    expect(unauthorizedInitialize.headers.get("www-authenticate")).toContain("Bearer");
    expect(unauthorizedInitialize.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(unauthorizedInitialize.headers.get("www-authenticate")).toContain('scope="mcp"');
    const resourceMetadataUrl = readWwwAuthenticateParameter(
      unauthorizedInitialize.headers.get("www-authenticate"),
      "resource_metadata"
    );
    expect(resourceMetadataUrl).toBeTruthy();
    await expect(getJson(resourceMetadataUrl ?? "")).resolves.toMatchObject({
      status: 200
    });

    const authorizedInitialize = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-authorized",
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
        authorization: "Bearer access-token"
      }
    );
    const sessionId = authorizedInitialize.headers.get("mcp-session-id");

    expect(authorizedInitialize.status).toBe(200);
    expect(sessionId).toBeTruthy();

    const deleteResponse = await deleteRequest(runtime.address.endpointUrl, {
      authorization: "Bearer access-token",
      "mcp-session-id": sessionId ?? "",
      "mcp-protocol-version": "2025-11-25"
    });

    expect(deleteResponse.status).toBe(200);

    const postDeleteResponse = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "list-http-deleted",
        method: "tools/list",
        params: {}
      },
      {
        authorization: "Bearer access-token",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2025-11-25"
      }
    );

    expect(postDeleteResponse.status).toBe(404);
  });

  it("expires idle sessions and returns HTTP 404 for the stale session id", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      sessionIdleTtlMs: 40,
      sessionSweepIntervalMs: 10,
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const { session, initializeResponse } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-expiring-session",
      capabilities: {}
    });

    expect(initializeResponse.status).toBe(200);
    expect(session.sessionId).toBeTruthy();

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });

    const expiredResponse = await callHttpJsonRpc(session, {
      requestId: "list-http-expired-session",
      method: "tools/list",
      params: {}
    });

    expect(expiredResponse.status).toBe(404);
    await expect(expiredResponse.json()).resolves.toMatchObject({
      error: {
        message: "Session not found"
      }
    });
  });

  it("returns insufficient_scope challenges when the access token lacks required scopes", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      authorization: createStaticBearerAuthorization({
        token: "access-token",
        authorizationServers: ["https://auth.example.com"],
        scopesSupported: ["mcp:read", "mcp:write"],
        requiredScopes: ["mcp:write"],
        grantedScopes: ["mcp:read"]
      }),
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });
    openServers.push(runtime);

    const response = await postJson(
      runtime.address.endpointUrl,
      {
        jsonrpc: "2.0",
        id: "init-http-insufficient-scope",
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
        authorization: "Bearer access-token"
      }
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("www-authenticate")).toContain('scope="mcp:write"');
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Insufficient scope",
        data: {
          requiredScopes: ["mcp:write"]
        }
      }
    });
  });
});
