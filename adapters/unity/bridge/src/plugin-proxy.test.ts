import { TARGET_OUTSIDE_SANDBOX_POLICY_REASON } from "@engine-mcp/policy-engine";
import { afterEach, describe, expect, it } from "vitest";

import {
  createReadHeavyConformanceCases,
  runConformanceSuite,
  type ConformanceCase
} from "@engine-mcp/conformance-runner";

import {
  UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  UnityBridgePluginBootstrapError,
  UnityBridgeRemoteError,
  UnityBridgeValidationError,
  createUnityBridgePreferredAdapter,
  createUnityBridgePluginProxyAdapter,
  createUnityLocalBridgeErrorResponse,
  createUnityLocalBridgeSuccessResponse,
  getDefaultUnityPluginSessionBootstrapPath,
  parseUnityLocalBridgeRequest
} from "./index.js";
import { createUnityBridgeBootstrapHarness } from "./test-support/bootstrap.js";
import {
  createPluginHostHarness,
  type PluginHostResponder
} from "./test-support/plugin-host.js";

describe("@engine-mcp/unity-bridge plugin proxy adapter", () => {
  const bootstrapHarness = createUnityBridgeBootstrapHarness();
  const pluginHostHarness = createPluginHostHarness();

  afterEach(async () => {
    await pluginHostHarness.cleanup();
    await bootstrapHarness.cleanup();
  });

  async function createPluginProxyTestFixture(options: {
    responder: PluginHostResponder;
    sessionScope?: NonNullable<Parameters<typeof createUnityBridgePluginProxyAdapter>[0]>["sessionScope"];
    sessionToken?: string;
    fetchFn?: typeof fetch;
    tempDirectoryPrefix?: string;
    createdAt?: string;
    ownerProcessId?: number;
  }) {
    const sessionToken = options.sessionToken ?? "plugin-session-token";
    const { endpointUrl } = await pluginHostHarness.start(options.responder);
    const tempDirectory = await bootstrapHarness.createTempDirectory(
      options.tempDirectoryPrefix ?? "engine-mcp-plugin-proxy-"
    );
    const bootstrapFilePath = await bootstrapHarness.writePluginBootstrap({
      tempDirectory,
      endpointUrl,
      sessionToken,
      createdAt: options.createdAt,
      ownerProcessId: options.ownerProcessId
    });

    return {
      sessionToken,
      endpointUrl,
      tempDirectory,
      bootstrapFilePath,
      adapter: createUnityBridgePluginProxyAdapter({
        bootstrapFilePath,
        sessionScope: options.sessionScope ?? "inspect",
        fetchFn: options.fetchFn
      })
    };
  }

  it("forwards canonical requests through a plugin bootstrap manifest", async () => {
    const requests: Array<{ capability: string; sessionScope: string }> = [];
    const sessionToken = "plugin-session-token";
    const fixture = await createPluginProxyTestFixture({
      sessionToken,
      responder: async (request, body) => {
        expect(request.headers[UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]).toBe(sessionToken);
        const envelope = parseUnityLocalBridgeRequest(body);
        requests.push({
          capability: envelope.capability,
          sessionScope: envelope.sessionScope
        });

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          engine: "Unity",
          engineVersion: "6000.3.11f1",
          workspaceName: "Unity-Tests",
          isReady: true,
          activity: "idle",
          selectionCount: 0,
          activeContainer: {
            displayName: "MCP_Sandbox",
            enginePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
          },
          diagnostics: []
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "editor.state.read",
      input: {
        includeSelection: true,
        includeActiveContainer: true,
        includeDiagnostics: true
      }
    });

    expect(result).toEqual({
      engine: "Unity",
      engineVersion: "6000.3.11f1",
      workspaceName: "Unity-Tests",
      isReady: true,
      activity: "idle",
      selectionCount: 0,
      activeContainer: {
        displayName: "MCP_Sandbox",
        enginePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      },
      diagnostics: []
    });
    expect(requests).toEqual([
      {
        capability: "editor.state.read",
        sessionScope: "inspect"
      }
    ]);
  });

  it("forwards invocation abort signals to the plugin fetch call", async () => {
    const receivedSignals: Array<AbortSignal | null> = [];
    const fixture = await createPluginProxyTestFixture({
      responder: async () => {
        throw new Error("Unexpected fallback to the real plugin host responder.");
      },
      fetchFn: async (_input, init) => {
        receivedSignals.push((init?.signal as AbortSignal | undefined) ?? null);
        const envelope = parseUnityLocalBridgeRequest(String(init?.body ?? ""));

        return new Response(
          JSON.stringify(
            createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              engine: "Unity",
              engineVersion: "6000.3.11f1",
              workspaceName: "Unity-Tests",
              isReady: true,
              activity: "idle",
              selectionCount: 0,
              activeContainer: {
                displayName: "MCP_Sandbox",
                enginePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
              },
              diagnostics: []
            })
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    });
    const invocationController = new AbortController();

    await fixture.adapter.invoke(
      {
        capability: "editor.state.read",
        input: {
          includeSelection: true,
          includeActiveContainer: true,
          includeDiagnostics: true
        }
      },
      {
        signal: invocationController.signal
      }
    );

    expect(receivedSignals).toEqual([invocationController.signal]);
  });

  it("maps remote error envelopes to a typed remote error", async () => {
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "dangerous_write",
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        return createUnityLocalBridgeErrorResponse(envelope.requestId, {
          code: "policy_denied",
          message: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
          details: {
            rule: "object_namespace",
            targetLogicalName: "UnsafeRoot",
            targetDisplayName: "UnsafeRoot"
          }
        });
      }
    });

    await expect(
      fixture.adapter.invoke({
        capability: "scene.object.delete",
        input: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__Cube"
          }
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgeRemoteError",
      code: "policy_denied",
      message: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details: {
        rule: "object_namespace",
        targetLogicalName: "UnsafeRoot",
        targetDisplayName: "UnsafeRoot"
      }
    });
  });

  it("forwards snapshot.restore and validates the canonical rollback output", async () => {
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "dangerous_write",
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        expect(envelope.capability).toBe("snapshot.restore");

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          snapshotId: "snapshot-restore-001",
          restored: true,
          target: {
            logicalName: "SandboxRoot/MCP_E2E__DeletedCube",
            displayName: "MCP_E2E__DeletedCube"
          }
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "snapshot.restore",
      input: {
        snapshotId: "snapshot-restore-001"
      }
    });

    expect(result).toEqual({
      snapshotId: "snapshot-restore-001",
      restored: true,
      target: {
        logicalName: "SandboxRoot/MCP_E2E__DeletedCube",
        displayName: "MCP_E2E__DeletedCube"
      }
    });
  });

  it("maps rollback_unavailable remote errors for snapshot.restore", async () => {
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "dangerous_write",
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        return createUnityLocalBridgeErrorResponse(envelope.requestId, {
          code: "policy_denied",
          message: "rollback_unavailable",
          details: {
            capability: "snapshot.restore",
            snapshotId: "snapshot-restore-001"
          }
        });
      }
    });

    await expect(
      fixture.adapter.invoke({
        capability: "snapshot.restore",
        input: {
          snapshotId: "snapshot-restore-001"
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgeRemoteError",
      code: "policy_denied",
      message: "rollback_unavailable",
      details: {
        capability: "snapshot.restore",
        snapshotId: "snapshot-restore-001"
      }
    });
  });

  it("normalizes legacy rollback_unavailable remote error codes from older plugin envelopes", async () => {
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "dangerous_write",
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        return {
          protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
          requestId: envelope.requestId,
          success: false,
          payload: null,
          error: {
            code: "rollback_unavailable",
            message: "Snapshot snapshot-restore-legacy could not be restored."
          }
        };
      }
    });

    await expect(
      fixture.adapter.invoke({
        capability: "snapshot.restore",
        input: {
          snapshotId: "snapshot-restore-legacy"
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgeRemoteError",
      code: "policy_denied",
      message: "rollback_unavailable"
    });
  });

  it("validates canonical test job outputs returned by the live plugin proxy", async () => {
    const fixture = await createPluginProxyTestFixture({
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        expect(envelope.capability).toBe("test.run");

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          jobId: "job-200",
          status: "running",
          acceptedFilter: {
            namePattern: "Sandbox"
          }
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "test.run",
      input: {
        filter: {
          namePattern: "Sandbox"
        },
        executionTarget: "editor",
        waitForCompletion: false
      }
    });

    expect(result).toEqual({
      jobId: "job-200",
      status: "running",
      acceptedFilter: {
        namePattern: "Sandbox"
      }
    });
  });

  it("forwards console.read and validates the canonical output shape", async () => {
    const fixture = await createPluginProxyTestFixture({
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        expect(envelope.capability).toBe("console.read");

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          entries: [
            {
              severity: "warning",
              message: "Live Unity warning",
              channel: "unity",
              source: "editor",
              sequence: 42,
              timestamp: "2026-03-20T00:00:00.000Z"
            }
          ],
          nextSequence: 42,
          truncated: false
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "console.read",
      input: {
        sinceSequence: 0,
        severities: ["warning"],
        limit: 10
      }
    });

    expect(result).toEqual({
      entries: [
        {
          severity: "warning",
          message: "Live Unity warning",
          channel: "unity",
          source: "editor",
          sequence: 42,
          timestamp: "2026-03-20T00:00:00.000Z"
        }
      ],
      nextSequence: 42,
      truncated: false
    });
  });

  it("forwards asset.search and validates the canonical output shape", async () => {
    const fixture = await createPluginProxyTestFixture({
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        expect(envelope.capability).toBe("asset.search");

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          results: [
            {
              assetGuid: "guid-prefab-001",
              assetPath: "Assets/MCP_Sandbox/Generated/EngineMcpAsset.prefab",
              displayName: "EngineMcpAsset",
              kind: "prefab"
            }
          ],
          total: 1,
          truncated: false
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "asset.search",
      input: {
        query: "EngineMcpAsset",
        roots: ["Assets/MCP_Sandbox/Generated"],
        kinds: ["prefab"],
        limit: 10
      }
    });

    expect(result).toEqual({
      results: [
        {
          assetGuid: "guid-prefab-001",
          assetPath: "Assets/MCP_Sandbox/Generated/EngineMcpAsset.prefab",
          displayName: "EngineMcpAsset",
          kind: "prefab"
        }
      ],
      total: 1,
      truncated: false
    });
  });

  it("forwards script.validate and validates the canonical output shape", async () => {
    const fixture = await createPluginProxyTestFixture({
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        expect(envelope.capability).toBe("script.validate");

        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
          targetPath: "Assets/EditorTests/EngineMcpBatchTestRunner.cs",
          isValid: false,
          diagnostics: [
            {
              severity: "error",
              message: "CS0246: The type or namespace name 'MissingType' could not be found.",
              path: "Assets/EditorTests/OtherFile.cs",
              line: 8,
              column: 18
            }
          ]
        });
      }
    });

    const result = await fixture.adapter.invoke({
      capability: "script.validate",
      input: {
        path: "Assets/EditorTests/EngineMcpBatchTestRunner.cs",
        includeWarnings: true
      }
    });

    expect(result).toEqual({
      targetPath: "Assets/EditorTests/EngineMcpBatchTestRunner.cs",
      isValid: false,
      diagnostics: [
        {
          severity: "error",
          message: "CS0246: The type or namespace name 'MissingType' could not be found.",
          path: "Assets/EditorTests/OtherFile.cs",
          line: 8,
          column: 18
        }
      ]
    });
  });

  it("validates canonical inputs before contacting the plugin endpoint", async () => {
    let requestCount = 0;
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "sandbox_write",
      responder: async (_request, body) => {
        requestCount += 1;
        const envelope = parseUnityLocalBridgeRequest(body);
        return createUnityLocalBridgeSuccessResponse(envelope.requestId, {});
      }
    });

    await expect(
      fixture.adapter.invoke({
        capability: "scene.object.create",
        input: {
          parent: {
            logicalName: "SandboxRoot"
          }
        }
      })
    ).rejects.toBeInstanceOf(UnityBridgeValidationError);

    expect(requestCount).toBe(0);
  });

  it("falls back to the sandbox adapter when the plugin bootstrap is unavailable", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory();

    const adapter = createUnityBridgePreferredAdapter({
      proxy: {
        bootstrapFilePath: getDefaultUnityPluginSessionBootstrapPath(tempDirectory),
        sessionScope: "inspect"
      },
      sandbox: {
        sceneName: "FallbackScene"
      }
    });
    const result = await adapter.invoke({
      capability: "editor.state.read",
      input: {
        includeSelection: true,
        includeActiveContainer: true,
        includeDiagnostics: true
      }
    });

    expect(result).toEqual({
      engine: "Unity",
      engineVersion: "6000.2.0f1",
      workspaceName: "UnitySandboxProject",
      isReady: true,
      activity: "idle",
      selectionCount: 0,
      activeContainer: {
        displayName: "FallbackScene",
        enginePath: "Assets/MCP_Sandbox/Scenes/FallbackScene.unity"
      },
      diagnostics: []
    });
  });

  it("surfaces a typed bootstrap error when fallback is disabled", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory();

    const adapter = createUnityBridgePreferredAdapter({
      proxy: {
        bootstrapFilePath: getDefaultUnityPluginSessionBootstrapPath(tempDirectory),
        sessionScope: "inspect"
      },
      fallbackToSandbox: false
    });

    await expect(
      adapter.invoke({
        capability: "editor.state.read",
        input: {
          includeSelection: true,
          includeActiveContainer: true,
          includeDiagnostics: true
        }
      })
    ).rejects.toBeInstanceOf(UnityBridgePluginBootstrapError);
  });

  it("passes a conformance case for structured sandbox denials through the live plugin proxy", async () => {
    const fixture = await createPluginProxyTestFixture({
      sessionScope: "dangerous_write",
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        return createUnityLocalBridgeErrorResponse(envelope.requestId, {
          code: "policy_denied",
          message: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
          details: {
            rule: "object_namespace",
            targetLogicalName: "UnsafeRoot",
            targetDisplayName: "UnsafeRoot",
            expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
          }
        });
      }
    });
    const cases: ConformanceCase[] = [
      {
        id: "scene.object.delete:policy-denied-live-proxy",
        capability: "scene.object.delete",
        expectation: "error",
        summary: "Live proxy preserves canonical sandbox denial details.",
        input: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__Cube"
          }
        },
        expectedError: {
          code: "policy_denied",
          message: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
          detailsSubset: {
            rule: "object_namespace",
            targetLogicalName: "UnsafeRoot",
            targetDisplayName: "UnsafeRoot"
          }
        }
      }
    ];

    const report = await runConformanceSuite(fixture.adapter, cases, {
      requiredCapabilities: ["scene.object.delete"]
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it("passes richer read-heavy conformance cases through the live plugin proxy", async () => {
    const testJobId = "job-321";
    const fixture = await createPluginProxyTestFixture({
      responder: async (_request, body) => {
        const envelope = parseUnityLocalBridgeRequest(body);

        switch (envelope.capability) {
          case "asset.search":
            return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              results: [
                {
                  assetGuid: "guid-scene-001",
                  assetPath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
                  displayName: "MCP_Sandbox",
                  kind: "scene"
                }
              ],
              total: 2,
              truncated: true
            });
          case "script.validate":
            return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              targetPath: "Assets/Scripts/Spawner.cs",
              isValid: true,
              diagnostics: []
            });
          case "console.read":
            return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              entries: [
                {
                  severity: "warning",
                  message: "Live Unity warning",
                  channel: "unity",
                  source: "editor",
                  sequence: 2,
                  timestamp: "2026-03-20T00:00:01.000Z"
                }
              ],
              nextSequence: 2,
              truncated: true
            });
          case "test.run":
            return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              jobId: "job-654",
              status: "completed",
              acceptedFilter: {
                namePattern: "Sandbox"
              }
            });
          case "test.job.read":
            return createUnityLocalBridgeSuccessResponse(envelope.requestId, {
              jobId: testJobId,
              status: "completed",
              progress: 1,
              summary: {
                passed: 1,
                failed: 0,
                skipped: 0
              },
              results: [
                {
                  name: "Sandbox.EditMode.GeneratedTest",
                  status: "passed"
                }
              ]
            });
          default:
            throw new Error(`Unexpected capability ${envelope.capability}.`);
        }
      }
    });
    const cases = createReadHeavyConformanceCases({
      testJobId
    });

    const report = await runConformanceSuite(fixture.adapter, cases, {
      requiredCapabilities: [
        "asset.search",
        "script.validate",
        "console.read",
        "test.run",
        "test.job.read"
      ]
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(cases.length);
  });

  it("falls back to the sandbox adapter when the plugin bootstrap owner process is stale", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory();
    const bootstrapFilePath = await bootstrapHarness.writePluginBootstrap({
      tempDirectory,
      endpointUrl: "http://127.0.0.1:38123/bridge/call",
      sessionToken: "plugin-session-token",
      createdAt: "2026-03-20T00:00:00.000Z",
      ownerProcessId: 2147483647
    });

    const adapter = createUnityBridgePreferredAdapter({
      proxy: {
        bootstrapFilePath,
        sessionScope: "inspect"
      },
      sandbox: {
        sceneName: "FallbackScene"
      }
    });
    const result = await adapter.invoke({
      capability: "editor.state.read",
      input: {
        includeSelection: true,
        includeActiveContainer: true,
        includeDiagnostics: true
      }
    });

    expect(result).toEqual({
      engine: "Unity",
      engineVersion: "6000.2.0f1",
      workspaceName: "UnitySandboxProject",
      isReady: true,
      activity: "idle",
      selectionCount: 0,
      activeContainer: {
        displayName: "FallbackScene",
        enginePath: "Assets/MCP_Sandbox/Scenes/FallbackScene.unity"
      },
      diagnostics: []
    });
  });
});
