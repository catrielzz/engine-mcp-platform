import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";
import { UNITY_BRIDGE_PROMPT_PACK } from "@engine-mcp/unity-bridge";
import {
  ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
  ENGINE_SNAPSHOT_INDEX_RESOURCE_URI
} from "@engine-mcp/contracts";

import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
  createCoreServer,
  createCoreServerAdapterRegistry,
  EngineMcpConformancePreflightError,
  startCoreServerStdio,
  type EngineMcpStdioServerOptions
} from "./index.js";
import {
  VALID_SAMPLES,
  createContractAwareFakeAdapter,
  createFakeAdapter
} from "./test-support/fixtures.js";
import { type StdioHarness } from "./test-support/stdio.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio foundation", () => {
  it("initializes over stdio and lists only the adapter-declared canonical tools", async () => {
    const { harness, initializeResponse } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["editor.state.read", "scene.object.delete"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });
    const listToolsResponse = await requestResult<{
      tools: Array<{
        name: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
        annotations: Record<string, boolean | undefined>;
        _meta: Record<string, unknown>;
      }>;
    }>(harness, "tools/list");

    expect(initializeResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "init-1",
      result: {
        serverInfo: {
          name: "@engine-mcp/core-server"
        },
        capabilities: {
          completions: {},
          prompts: {
            listChanged: true
          },
          tools: {
            listChanged: true
          }
        }
      }
    });

    expect(listToolsResponse).toMatchObject({
      jsonrpc: "2.0",
      result: {
        tools: [
          {
            name: "editor.state.read"
          },
          {
            name: "scene.object.delete"
          }
        ]
      }
    });

    const tools = listToolsResponse.result.tools;
    const readTool = tools.find(({ name }) => name === "editor.state.read");
    const deleteTool = tools.find(({ name }) => name === "scene.object.delete");

    expect(readTool).toMatchObject({
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "engine-mcp/adapter": "fake-core-server-adapter",
        "engine-mcp/capability": "editor.state.read"
      }
    });
    expect(readTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        includeDiagnostics: {
          type: "boolean"
        }
      }
    });
    expect(deleteTool).toMatchObject({
      annotations: {
        destructiveHint: true
      }
    });
    expect(deleteTool?.inputSchema).toMatchObject({
      properties: {
        target: {
          $ref: "#/$defs/entityRef"
        }
      },
      $defs: {
        entityRef: {
          type: "object"
        }
      }
    });
  });

  it("lists and reads the adapter-state resource over stdio", async () => {
    const { harness, initializeResponse } = await createInitializedHarness(openHarnesses, {
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "editor.state.read": VALID_SAMPLES["editor.state.read"].output
                },
                "registry-read-adapter"
              )
          }
        ]
      })
    });

    expect(initializeResponse).toMatchObject({
      result: {
        capabilities: {
          resources: {
            subscribe: true
          }
        }
      }
    });

    const listResourcesResponse = await requestResult<{
      resources: Array<{
        uri: string;
        name: string;
        mimeType: string;
      }>;
    }>(harness, "resources/list");
    const adapterStateResource = listResourcesResponse.result.resources.find(
      ({ uri }) => uri === CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
    );

    expect(adapterStateResource).toMatchObject({
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
      name: "adapter-state",
      mimeType: "application/json"
    });

    const readResourceResponse = await requestResult<{
      contents: Array<{
        uri: string;
        mimeType: string;
        text: string;
      }>;
    }>(harness, "resources/read", {
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
    });
    const adapterState = JSON.parse(readResourceResponse.result.contents[0].text) as Record<
      string,
      unknown
    >;

    expect(readResourceResponse.result.contents[0]).toMatchObject({
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
      mimeType: "application/json"
    });
    expect(adapterState).toMatchObject({
      selectedAdapter: "registry-read",
      adapterId: "registry-read-adapter",
      toolCount: 1,
      health: {
        status: "ready"
      },
      preflight: {
        enabled: false
      }
    });
    expect(adapterState.availableAdapters).toEqual(expect.arrayContaining(["unity", "registry-read"]));
  });

  it("lists and reads adapter discovery resources over stdio", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["snapshot.restore"],
        async () => VALID_SAMPLES["snapshot.restore"].output,
        {
          listResources: () => [
            {
              uri: ENGINE_SNAPSHOT_INDEX_RESOURCE_URI,
              name: "snapshot-index",
              title: "Snapshot Index",
              description: "Recent snapshot identifiers available to the active engine adapter.",
              mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
            }
          ],
          readResource: (uri) =>
            uri === ENGINE_SNAPSHOT_INDEX_RESOURCE_URI
              ? {
                  uri,
                  mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
                  text: JSON.stringify({
                    adapterId: "fake-core-server-adapter",
                    snapshots: ["snapshot-0001", "snapshot-0002"]
                  })
                }
              : undefined
        }
      )
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
          uri: ENGINE_SNAPSHOT_INDEX_RESOURCE_URI,
          name: "snapshot-index",
          mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
        })
      ])
    );

    const readResourceResponse = await requestResult<{
      contents: Array<{
        uri: string;
        mimeType?: string;
        text: string;
      }>;
    }>(harness, "resources/read", {
      uri: ENGINE_SNAPSHOT_INDEX_RESOURCE_URI
    });

    expect(readResourceResponse.result.contents[0]).toMatchObject({
      uri: ENGINE_SNAPSHOT_INDEX_RESOURCE_URI,
      mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
    });
    expect(JSON.parse(readResourceResponse.result.contents[0].text)).toEqual({
      adapterId: "fake-core-server-adapter",
      snapshots: ["snapshot-0001", "snapshot-0002"]
    });
  });

  it("lists and renders platform prompts over stdio", async () => {
    const { harness, initializeResponse } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["editor.state.read", "scene.object.create"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });

    expect(initializeResponse).toMatchObject({
      result: {
        capabilities: {
          completions: {},
          prompts: {
            listChanged: true
          }
        }
      }
    });

    const listPromptsResponse = await requestResult<{
      prompts: Array<{
        name: string;
        title?: string;
        arguments?: Array<{
          name: string;
          required?: boolean;
        }>;
      }>;
    }>(harness, "prompts/list");

    expect(listPromptsResponse.result.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "scene.object.create.workflow",
          arguments: expect.arrayContaining([
            expect.objectContaining({
              name: "objective",
              required: true
            }),
            expect.objectContaining({
              name: "object_name",
              required: true
            })
          ])
        }),
        expect.objectContaining({
          name: "test.failure.triage"
        })
      ])
    );

    const getPromptResponse = await requestResult<{
      description?: string;
      messages: Array<{
        role: string;
        content: {
          type: string;
          text: string;
        };
      }>;
    }>(harness, "prompts/get", {
      name: "scene.object.create.workflow",
      arguments: {
        objective: "Create a checkpoint marker",
        object_name: "CheckpointMarker",
        parent_path: "SandboxRoot/Gameplay",
        transform: "position=(0,0,0)",
        components: "BoxCollider",
        constraints: "Stay inside sandbox",
        verification: "Re-read hierarchy after creation"
      }
    });

    expect(getPromptResponse.result).toMatchObject({
      description:
        "Plan and execute creation of a scene object inside the managed sandbox using canonical Engine MCP tools.",
      messages: [
        {
          role: "assistant",
          content: {
            type: "text"
          }
        },
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("Object name: CheckpointMarker")
          }
        }
      ]
    });
    expect(getPromptResponse.result.messages[1]?.content.text).toContain(
      "Parent path: SandboxRoot/Gameplay"
    );
  });

  it("lists and renders Unity adapter prompt packs over stdio", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        [
          "editor.state.read",
          "scene.hierarchy.read",
          "scene.object.create",
          "scene.object.update"
        ],
        async () => VALID_SAMPLES["editor.state.read"].output,
        {
          prompts: UNITY_BRIDGE_PROMPT_PACK
        }
      )
    });

    const listPromptsResponse = await requestResult<{
      prompts: Array<{
        name: string;
      }>;
    }>(harness, "prompts/list");
    const promptNames = listPromptsResponse.result.prompts.map(({ name }) => name);

    expect(promptNames).toEqual(
      expect.arrayContaining([
        "scene.object.create.workflow",
        "unity.scene.object.create.gameobject",
        "unity.scene.object.configure.components"
      ])
    );
    expect(promptNames).not.toContain("unity.script.validate.fix-plan");

    const getPromptResponse = await requestResult<{
      description?: string;
      messages: Array<{
        role: string;
        content: {
          type: string;
          text: string;
        };
      }>;
    }>(harness, "prompts/get", {
      name: "unity.scene.object.create.gameobject",
      arguments: {
        objective: "Create a checkpoint trigger",
        object_name: "CheckpointTrigger",
        parent_path: "SandboxRoot/Gameplay",
        object_kind: "trigger",
        transform: "position=(0,1,0)",
        components: "BoxCollider(isTrigger=true)",
        labels: "checkpoint, gameplay",
        verification: "Re-read the branch after creation"
      }
    });

    expect(getPromptResponse.result.description).toBe(
      "Create a Unity GameObject with the smallest safe mutation plan, then verify its final hierarchy path and component state."
    );
    expect(getPromptResponse.result.messages[1]?.content.text).toContain(
      "Requested object name: CheckpointTrigger"
    );
    expect(getPromptResponse.result.messages[1]?.content.text).toContain(
      "Object kind: trigger"
    );
  });

  it("rejects prompts/get when required arguments are missing over stdio", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["editor.state.read", "scene.object.update"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });

    const errorResponse = await harness.request("prompts/get", {
      name: "scene.object.update.workflow",
      arguments: {
        objective: "Disable a broken trigger"
      }
    });

    expect(errorResponse).toMatchObject({
      error: {
        code: expect.any(Number),
        message: expect.stringContaining(
          "Invalid arguments for prompt scene.object.update.workflow"
        )
      }
    });
  });

  it("completes prompt arguments from scene hierarchy over stdio", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["scene.object.create", "scene.hierarchy.read"],
        async (request) => {
          if (request.capability === "scene.hierarchy.read") {
            return VALID_SAMPLES["scene.hierarchy.read"].output;
          }

          return {
            object: {
              logicalName: "SandboxRoot/Generated"
            },
            created: true
          };
        }
      )
    });

    const completionResponse = await requestResult<{
      completion: {
        values: string[];
        total: number;
        hasMore?: boolean;
      };
    }>(harness, "completion/complete", {
      ref: {
        type: "ref/prompt",
        name: "scene.object.create.workflow"
      },
      argument: {
        name: "parent_path",
        value: "game"
      }
    });

    expect(completionResponse.result.completion).toMatchObject({
      total: 2
    });
    expect(completionResponse.result.completion.values[0]).toBe("SandboxRoot/Gameplay");
    expect(completionResponse.result.completion.values).toContain(
      "SandboxRoot/Gameplay/CheckpointMarker"
    );
  });

  it("completes adapter-backed snapshot ids over stdio", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(
        ["snapshot.restore"],
        async () => VALID_SAMPLES["snapshot.restore"].output,
        {
          completePromptArgument: async ({ provider }) =>
            provider === "engine.snapshot_id"
              ? ["snapshot-0009", "snapshot-0010", "snapshot-0011"]
              : []
        }
      )
    });

    const completionResponse = await requestResult<{
      completion: {
        values: string[];
        total: number;
      };
    }>(harness, "completion/complete", {
      ref: {
        type: "ref/prompt",
        name: "snapshot.restore.workflow"
      },
      argument: {
        name: "snapshot_id",
        value: "10"
      }
    });

    expect(completionResponse.result.completion).toEqual({
      values: ["snapshot-0010"],
      total: 1
    });
  });

  it("emits prompts/list_changed and filters prompts when the active adapter changes at runtime", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-create",
        entries: [
          {
            name: "registry-create",
            create: () =>
              createFakeAdapter(
                ["scene.object.create"],
                async () => VALID_SAMPLES["editor.state.read"].output
              )
          },
          {
            name: "registry-restore",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "snapshot.restore": VALID_SAMPLES["snapshot.restore"].output
                },
                "registry-restore-adapter"
              )
          }
        ]
      })
    });

    const initialPromptsResponse = await requestResult<{
      prompts: Array<{
        name: string;
      }>;
    }>(harness, "prompts/list");

    expect(initialPromptsResponse.result.prompts.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["scene.object.create.workflow", "test.failure.triage"])
    );
    expect(initialPromptsResponse.result.prompts.map(({ name }) => name)).not.toContain(
      "snapshot.restore.workflow"
    );

    const notificationPromise = harness.collector.waitFor(
      "prompts/list_changed notification",
      (message) => "method" in message && message.method === "notifications/prompts/list_changed"
    );

    await harness.selectAdapter("registry-restore");
    await notificationPromise;

    const nextPromptsResponse = await requestResult<{
      prompts: Array<{
        name: string;
      }>;
    }>(harness, "prompts/list");
    const nextPromptNames = nextPromptsResponse.result.prompts.map(({ name }) => name);

    expect(nextPromptNames).toEqual(
      expect.arrayContaining(["snapshot.restore.workflow", "test.failure.triage"])
    );
    expect(nextPromptNames).not.toContain("scene.object.create.workflow");
  });

  it("delegates tools/call to the injected adapter and returns structured content", async () => {
    const invocations: Array<{
      capability: string;
      input: unknown;
    }> = [];
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        invocations.push(request);
        return VALID_SAMPLES["editor.state.read"].output;
      })
    });

    const callToolResponse = await requestResult<{
      content: Array<{
        type: string;
        text: string;
      }>;
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });

    expect(invocations).toEqual([
      expect.objectContaining({
        capability: "editor.state.read",
        input: VALID_SAMPLES["editor.state.read"].input,
        context: expect.objectContaining({
          requestId: "req-0001",
          sendProgress: expect.any(Function)
        })
      })
    ]);
    expect(callToolResponse.result.structuredContent).toEqual(VALID_SAMPLES["editor.state.read"].output);
    expect(JSON.parse(callToolResponse.result.content[0]?.text ?? "")).toEqual(
      VALID_SAMPLES["editor.state.read"].output
    );
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/capability": "editor.state.read",
      "engine-mcp/resultAdapter": "fake-core-server-adapter"
    });
  });

  it("returns a tool error result when the adapter throws", async () => {
    const bridgeDownError = Object.assign(new Error("Unity bridge is unavailable."), {
      code: "bridge_transport_error",
      details: {
        transport: "local_http"
      }
    });
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["editor.state.read"], async () => {
        throw bridgeDownError;
      })
    });

    const callToolResponse = await requestResult<{
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
          message: string;
          details?: unknown;
        };
      };
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error).toEqual({
      code: "bridge_transport_error",
      message: "Unity bridge is unavailable.",
      details: {
        transport: "local_http"
      }
    });
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/errorCode": "bridge_transport_error"
    });
  });

  it("flattens policy decisions into the public tool error shape", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["scene.object.delete"], async () => {
        throw Object.assign(new Error("Adapter-local policy wording."), {
          decision: {
            allowed: false,
            code: "policy_denied",
            reason: "target_outside_sandbox",
            details: {
              rule: "object_namespace",
              targetLogicalName: "SandboxRoot/ForbiddenCube",
              expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
            }
          }
        });
      })
    });

    const callToolResponse = await requestResult<{
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
          message: string;
          details?: unknown;
        };
      };
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error).toEqual({
      code: "policy_denied",
      message: "target_outside_sandbox",
      details: {
        rule: "object_namespace",
        targetLogicalName: "SandboxRoot/ForbiddenCube",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/errorCode": "policy_denied"
    });
  });

  it("lists and routes snapshot.restore when an adapter declares the rollback capability", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["snapshot.restore"], async (request) => {
        expect(request).toMatchObject({
          capability: "snapshot.restore",
          input: VALID_SAMPLES["snapshot.restore"].input
        });

        return VALID_SAMPLES["snapshot.restore"].output;
      })
    });

    const listToolsResponse = await requestResult<{
      tools: Array<{
        name: string;
        _meta: Record<string, unknown>;
      }>;
    }>(harness, "tools/list");
    const rollbackTool = listToolsResponse.result.tools.find(({ name }) => name === "snapshot.restore");

    expect(rollbackTool).toMatchObject({
      name: "snapshot.restore",
      _meta: {
        "engine-mcp/contractStatus": "bootstrap"
      }
    });

    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "snapshot.restore",
      arguments: VALID_SAMPLES["snapshot.restore"].input
    });

    expect(callToolResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["snapshot.restore"].output
    );
  });

  it("turns invalid adapter outputs into structured tool errors", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["editor.state.read"], async () => ({
        engine: "Unity"
      }))
    });

    const callToolResponse = await requestResult<{
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
          details?: unknown;
        };
      };
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error.code).toBe("adapter_output_invalid");
    expect(callToolResponse.result.structuredContent.error.details).toMatchObject({
      issues: expect.any(Array)
    });
  });

  it("uses the preferred Unity adapter by default and falls back to the sandbox when the plugin bootstrap is missing", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      unityBridge: {
        proxy: {
          bootstrapFilePath:
            "E:/engine-mcp-platform/artifacts/nonexistent-core-server-plugin-bootstrap.json"
        },
        fallbackToSandbox: true
      }
    });

    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });

    expect(callToolResponse.result.structuredContent).toMatchObject({
      engine: "Unity",
      workspaceName: "UnitySandboxProject",
      activity: "idle"
    });
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/resultAdapter": "unity-bridge-preferred"
    });
  });

  it("resolves the selected adapter from a registry before exposing tools", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-pass",
        entries: [
          {
            name: "registry-pass",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "editor.state.read": VALID_SAMPLES["editor.state.read"].output
                },
                "registry-selected-adapter"
              )
          }
        ]
      })
    });

    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });

    expect(callToolResponse.result.structuredContent).toEqual(VALID_SAMPLES["editor.state.read"].output);
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/resultAdapter": "registry-selected-adapter"
    });
  });

  it("fails startup when conformance preflight is enforced and the selected registry adapter does not pass", async () => {
    await expect(
      startCoreServerStdio({
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        adapterRegistry: createCoreServerAdapterRegistry({
          defaultAdapterName: "registry-fail",
          entries: [
            {
              name: "registry-fail",
              create: () =>
                createContractAwareFakeAdapter(
                  {
                    "editor.state.read": {
                      engine: "Unity"
                    }
                  },
                  "registry-failing-adapter"
                )
            }
          ]
        }),
        conformancePreflight: {
          requiredCapabilities: ["editor.state.read"]
        }
      } satisfies EngineMcpStdioServerOptions)
    ).rejects.toSatisfy(
      (error) =>
        error instanceof EngineMcpConformancePreflightError &&
        error.report.adapter === "registry-failing-adapter" &&
        error.report.failed === 1
    );
  });

  it("can keep a failing preflight report without blocking startup when enforcement is disabled", async () => {
    const runtime = await createCoreServer({
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-report-only",
        entries: [
          {
            name: "registry-report-only",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "editor.state.read": {
                    engine: "Unity"
                  }
                },
                "registry-report-only-adapter"
              )
          }
        ]
      }),
      conformancePreflight: {
        requiredCapabilities: ["editor.state.read"],
        enforce: false
      }
    });

    await runtime.close();

    expect(runtime.adapter.adapter).toBe("registry-report-only-adapter");
    expect(runtime.preflight).toMatchObject({
      passed: false,
      report: {
        adapter: "registry-report-only-adapter",
        failed: 1
      }
    });
  });

  it("emits tools/list_changed and switches tool routing when the active adapter changes at runtime", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "editor.state.read": VALID_SAMPLES["editor.state.read"].output
                },
                "registry-read-adapter"
              )
          },
          {
            name: "registry-delete",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "scene.object.delete": VALID_SAMPLES["scene.object.delete"].output
                },
                "registry-delete-adapter"
              )
          }
        ]
      })
    });

    const notificationPromise = harness.collector.waitFor(
      "tools/list_changed notification",
      (message) => "method" in message && message.method === "notifications/tools/list_changed"
    );

    await harness.selectAdapter("registry-delete");
    await notificationPromise;

    const listToolsResponse = await requestResult<{
      tools: Array<{
        name: string;
      }>;
    }>(harness, "tools/list");
    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input
    });

    expect(listToolsResponse).toMatchObject({
      result: {
        tools: [
          {
            name: "scene.object.delete"
          }
        ]
      }
    });
    expect(callToolResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["scene.object.delete"].output
    );
    expect(callToolResponse.result._meta).toMatchObject({
      "engine-mcp/resultAdapter": "registry-delete-adapter"
    });
  });

  it("emits notifications/resources/updated when a subscribed adapter-state resource changes", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapterRegistry: createCoreServerAdapterRegistry({
        defaultAdapterName: "registry-read",
        entries: [
          {
            name: "registry-read",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "editor.state.read": VALID_SAMPLES["editor.state.read"].output
                },
                "registry-read-adapter"
              )
          },
          {
            name: "registry-delete",
            create: () =>
              createContractAwareFakeAdapter(
                {
                  "scene.object.delete": VALID_SAMPLES["scene.object.delete"].output
                },
                "registry-delete-adapter"
              )
          }
        ]
      })
    });
    await harness.request("resources/subscribe", {
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
    });

    const notificationPromise = harness.collector.waitFor(
      "resources/updated notification",
      (message) =>
        "method" in message &&
        message.method === "notifications/resources/updated" &&
        "params" in message &&
        (message.params as { uri?: unknown }).uri === CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
    );

    await harness.selectAdapter("registry-delete");

    await expect(notificationPromise).resolves.toMatchObject({
      method: "notifications/resources/updated",
      params: {
        uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
      }
    });

    const readResourceResponse = await requestResult<{
      contents: Array<{
        text: string;
      }>;
    }>(harness, "resources/read", {
      uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
    });
    const adapterState = JSON.parse(readResourceResponse.result.contents[0].text) as Record<
      string,
      unknown
    >;

    expect(adapterState).toMatchObject({
      selectedAdapter: "registry-delete",
      adapterId: "registry-delete-adapter",
      toolCount: 1,
      health: {
        status: "ready"
      }
    });
  });

  it("emits notifications/message over stdio when the runtime sends a log message", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["editor.state.read"], async () => VALID_SAMPLES["editor.state.read"].output)
    });

    const notificationPromise = harness.collector.waitFor(
      "logging notification",
      (message) =>
        "method" in message &&
        message.method === "notifications/message" &&
        "params" in message &&
        (message.params as { data?: unknown }).data === "core-server log message"
    );

    await harness.sendLoggingMessage({
      level: "info",
      data: "core-server log message"
    });

    await expect(notificationPromise).resolves.toMatchObject({
      method: "notifications/message",
      params: {
        level: "info",
        data: "core-server log message"
      }
    });
  });

  it("emits notifications/progress during tools/call when the client provides a progress token", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        await request.context?.sendProgress({
          progress: 1,
          total: 2,
          message: "Reading editor state"
        });

        return VALID_SAMPLES["editor.state.read"].output;
      })
    });

    const progressNotificationPromise = harness.collector.waitFor(
      "progress notification",
      (message) =>
        "method" in message &&
        message.method === "notifications/progress" &&
        "params" in message &&
        (message.params as { progressToken?: unknown }).progressToken === "progress-stdio-1"
    );

    await harness.request("tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input,
      _meta: {
        progressToken: "progress-stdio-1"
      }
    });

    await expect(progressNotificationPromise).resolves.toMatchObject({
      method: "notifications/progress",
      params: {
        progressToken: "progress-stdio-1",
        progress: 1,
        total: 2,
        message: "Reading editor state"
      }
    });
  });
});
