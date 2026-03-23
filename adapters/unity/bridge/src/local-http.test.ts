import {
  setTimeout as delay
} from "node:timers/promises";

import {
  createStaticPolicyEvaluator,
  createTargetOutsideSandboxPolicyDetails,
  denyTargetOutsideSandbox
} from "@engine-mcp/policy-engine";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_UNITY_LOCAL_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_INVOCATION_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_MAX_REQUESTS_PER_SOCKET,
  DEFAULT_UNITY_LOCAL_HTTP_REQUEST_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_SESSION_IDLE_TTL_MS,
  DEFAULT_UNITY_LOCAL_HTTP_SESSION_SWEEP_INTERVAL_MS,
  UnityBridgeRemoteError,
  createUnityBridgeLocalHttpServer
} from "./index.js";
import {
  createLocalHttpTestRequest,
  createUnityBridgeLocalHttpHarness
} from "./test-support/local-http.js";
import { createSandboxTestAdapter } from "./test-support/sandbox.js";

describe("@engine-mcp/unity-bridge localhost transport", () => {
  const localHttpHarness = createUnityBridgeLocalHttpHarness();

  afterEach(async () => {
    await localHttpHarness.cleanup();
  });

  async function waitForCondition(
    condition: () => Promise<boolean>,
    timeoutMs: number = 500
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await delay(10);
    }

    throw new Error(`Timed out waiting for test condition after ${timeoutMs}ms.`);
  }

  function createEditorStateReadRequest(requestId: string) {
    return createLocalHttpTestRequest({
      requestId,
      capability: "editor.state.read",
      sessionScope: "inspect",
      payload: {}
    });
  }

  function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    return {
      promise,
      resolve,
      reject
    };
  }

  it("applies explicit localhost HTTP server timeout defaults", async () => {
    const server = createUnityBridgeLocalHttpServer({
      adapter: createSandboxTestAdapter(),
      port: 0,
      sessionToken: "test-token"
    });

    try {
      await server.start();

      expect(server.httpServer?.requestTimeout).toBe(DEFAULT_UNITY_LOCAL_HTTP_REQUEST_TIMEOUT_MS);
      expect(server.httpServer?.headersTimeout).toBe(DEFAULT_UNITY_LOCAL_HTTP_HEADERS_TIMEOUT_MS);
      expect(server.httpServer?.keepAliveTimeout).toBe(
        DEFAULT_UNITY_LOCAL_HTTP_KEEP_ALIVE_TIMEOUT_MS
      );
    } finally {
      await server.stop();
    }
  });

  it("applies explicit localhost session idle timeout defaults", async () => {
    const server = createUnityBridgeLocalHttpServer({
      adapter: createSandboxTestAdapter(),
      port: 0,
      sessionToken: "test-token"
    });

    try {
      await server.start();

      expect(DEFAULT_UNITY_LOCAL_HTTP_SESSION_IDLE_TTL_MS).toBeGreaterThan(0);
      expect(DEFAULT_UNITY_LOCAL_HTTP_SESSION_SWEEP_INTERVAL_MS).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  it("applies an explicit localhost maxRequestsPerSocket default", async () => {
    const server = createUnityBridgeLocalHttpServer({
      adapter: createSandboxTestAdapter(),
      port: 0,
      sessionToken: "test-token"
    });

    try {
      await server.start();

      expect(server.httpServer?.maxRequestsPerSocket).toBe(
        DEFAULT_UNITY_LOCAL_HTTP_MAX_REQUESTS_PER_SOCKET
      );
    } finally {
      await server.stop();
    }
  });

  it("exports an explicit localhost invocation timeout default", () => {
    expect(DEFAULT_UNITY_LOCAL_HTTP_INVOCATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("round-trips canonical local bridge envelopes over localhost HTTP", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter({
        sessionScope: "dangerous_write"
      })
    });

    const { response: createResponse, envelope: createEnvelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-create",
        capability: "scene.object.create",
        sessionScope: "sandbox_write",
        payload: {
          parent: {
            logicalName: "SandboxRoot"
          },
          name: "GeneratedCube",
          kind: "mesh"
        }
      })
    });

    expect(createResponse.status).toBe(200);
    expect(createEnvelope.success).toBe(true);
    expect(createEnvelope.requestId).toBe("req-create");

    const { envelope: deleteEnvelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-delete",
        capability: "scene.object.delete",
        sessionScope: "dangerous_write",
        payload: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
          },
          snapshotLabel: "before-delete"
        }
      })
    });

    expect(deleteEnvelope.success).toBe(true);
    expect(deleteEnvelope.snapshotId).toBe("snapshot-0001");

    const { envelope: restoreEnvelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-restore",
        capability: "snapshot.restore",
        sessionScope: "dangerous_write",
        payload: {
          snapshotId: "snapshot-0001"
        }
      })
    });

    expect(restoreEnvelope.success).toBe(true);
    expect(restoreEnvelope.payload).toEqual({
      snapshotId: "snapshot-0001",
      restored: true,
      target: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
        displayName: "MCP_E2E__GeneratedCube"
      }
    });
  });

  it("rejects requests without the local session token", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter(),
      sessionToken: "test-token"
    });

    const response = await session.postRaw({
      sessionToken: null,
      request: createLocalHttpTestRequest({
        requestId: "req-unauthorized",
        capability: "editor.state.read",
        sessionScope: "inspect",
        payload: {}
      })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Missing or invalid session token."
    });
  });

  it("expires the local session after idle inactivity", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter(),
      sessionToken: "test-token",
      sessionIdleTtlMs: 40,
      sessionSweepIntervalMs: 10
    });

    await delay(80);

    const response = await session.postRaw({
      request: createEditorStateReadRequest("req-idle-expired")
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Session token expired or revoked."
    });
  });

  it("refreshes localhost session activity on valid requests", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter(),
      sessionToken: "test-token",
      sessionIdleTtlMs: 120,
      sessionSweepIntervalMs: 10
    });

    await delay(70);

    const firstResponse = await session.postRaw({
      request: createEditorStateReadRequest("req-activity-1")
    });

    expect(firstResponse.status).toBe(200);

    await delay(70);

    const secondResponse = await session.postRaw({
      request: createEditorStateReadRequest("req-activity-2")
    });

    expect(secondResponse.status).toBe(200);
  });

  it("rejects requests that exceed the localhost concurrency cap and frees the slot after completion", async () => {
    const firstRequestStarted = createDeferred<void>();
    const releaseFirstRequest = createDeferred<void>();
    let invocationCount = 0;

    const session = await localHttpHarness.startServer({
      sessionToken: "test-token",
      maxConcurrentRequests: 1,
      adapter: {
        async invoke() {
          invocationCount += 1;

          if (invocationCount === 1) {
            firstRequestStarted.resolve();
            await releaseFirstRequest.promise;
          }

          return {
            invocationCount
          };
        }
      }
    });

    const firstResponsePromise = session.postRaw({
      request: createEditorStateReadRequest("req-concurrency-1")
    });

    await firstRequestStarted.promise;

    const overflowResponse = await session.postRaw({
      request: createEditorStateReadRequest("req-concurrency-2")
    });

    expect(overflowResponse.status).toBe(503);
    expect(await overflowResponse.json()).toEqual({
      error: "Too many concurrent bridge requests."
    });

    releaseFirstRequest.resolve();

    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);

    const recoveredResponse = await session.postRaw({
      request: createEditorStateReadRequest("req-concurrency-3")
    });

    expect(recoveredResponse.status).toBe(200);
  });

  it("returns a canonical bridge transport error when an invocation times out", async () => {
    const session = await localHttpHarness.startServer({
      sessionToken: "test-token",
      invocationTimeoutMs: 40,
      adapter: {
        async invoke(_request, context) {
          await new Promise<void>((resolve) => {
            context?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });

          return {
            unreachable: true
          };
        }
      }
    });

    const { response, envelope } = await session.postEnvelope({
      request: createEditorStateReadRequest("req-timeout")
    });

    expect(response.status).toBe(200);
    expect(envelope.success).toBe(false);
    expect(envelope.error).toEqual({
      code: "bridge_transport_error",
      message: "Bridge invocation timed out.",
      details: {
        capability: "editor.state.read",
        timeoutMs: 40
      }
    });
  });

  it("releases the localhost concurrency slot after an invocation timeout", async () => {
    let invocationCount = 0;
    const session = await localHttpHarness.startServer({
      sessionToken: "test-token",
      maxConcurrentRequests: 1,
      invocationTimeoutMs: 40,
      adapter: {
        async invoke(_request, context) {
          invocationCount += 1;

          if (invocationCount === 1) {
            await new Promise<void>((resolve) => {
              context?.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          }

          return {
            invocationCount
          };
        }
      }
    });

    const { envelope: timeoutEnvelope } = await session.postEnvelope({
      request: createEditorStateReadRequest("req-timeout-release-1")
    });

    expect(timeoutEnvelope.success).toBe(false);
    expect(timeoutEnvelope.error).toEqual({
      code: "bridge_transport_error",
      message: "Bridge invocation timed out.",
      details: {
        capability: "editor.state.read",
        timeoutMs: 40
      }
    });

    const { response: recoveredResponse, envelope: recoveredEnvelope } = await session.postEnvelope({
      request: createEditorStateReadRequest("req-timeout-release-2")
    });

    expect(recoveredResponse.status).toBe(200);
    expect(recoveredEnvelope.success).toBe(true);
    expect(recoveredEnvelope.payload).toEqual({
      invocationCount: 2
    });
  });

  it("aborts an in-flight invocation when the client disconnects early and frees the slot", async () => {
    const firstRequestStarted = createDeferred<void>();
    const firstRequestAborted = createDeferred<void>();
    let invocationCount = 0;

    const session = await localHttpHarness.startServer({
      sessionToken: "test-token",
      maxConcurrentRequests: 1,
      invocationTimeoutMs: 1_000,
      adapter: {
        async invoke(_request, context) {
          invocationCount += 1;

          if (invocationCount === 1) {
            firstRequestStarted.resolve();
            await new Promise<void>((resolve) => {
              context?.signal?.addEventListener(
                "abort",
                () => {
                  firstRequestAborted.resolve();
                  resolve();
                },
                { once: true }
              );
            });
          }

          return {
            invocationCount
          };
        }
      }
    });

    const abortableRequest = session.postAbortable({
      request: createEditorStateReadRequest("req-disconnect-1")
    });

    await firstRequestStarted.promise;
    abortableRequest.abort();
    await firstRequestAborted.promise;
    await abortableRequest.closed;
    await expect(abortableRequest.response).rejects.toBeDefined();

    const { response: recoveredResponse, envelope: recoveredEnvelope } = await session.postEnvelope({
      request: createEditorStateReadRequest("req-disconnect-2")
    });

    expect(recoveredResponse.status).toBe(200);
    expect(recoveredEnvelope.success).toBe(true);
    expect(recoveredEnvelope.payload).toEqual({
      invocationCount: 2
    });
  });

  it("preserves remote adapter error codes in local bridge envelopes", async () => {
    const session = await localHttpHarness.startServer({
      adapter: {
        invoke() {
          throw new UnityBridgeRemoteError("policy_denied", "target_outside_sandbox", {
            rule: "object_namespace",
            targetLogicalName: "UnsafeRoot",
            targetDisplayName: "UnsafeRoot"
          });
        }
      },
      sessionToken: "test-token"
    });

    const { envelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-remote-error",
        capability: "scene.object.delete",
        sessionScope: "dangerous_write",
        payload: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__Cube"
          }
        }
      })
    });

    expect(envelope.success).toBe(false);
    expect(envelope.error).toEqual({
      code: "policy_denied",
      message: "target_outside_sandbox",
      details: {
        rule: "object_namespace",
        targetLogicalName: "UnsafeRoot",
        targetDisplayName: "UnsafeRoot"
      }
    });
  });

  it("preserves rollback_unavailable when a snapshot cannot be restored", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter({
        sessionScope: "dangerous_write"
      }),
      sessionToken: "test-token"
    });

    const { envelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-restore-missing",
        capability: "snapshot.restore",
        sessionScope: "dangerous_write",
        payload: {
          snapshotId: "snapshot-missing"
        }
      })
    });

    expect(envelope.success).toBe(false);
    expect(envelope.error).toEqual({
      code: "policy_denied",
      message: "rollback_unavailable",
      details: {
        capability: "snapshot.restore",
        snapshotId: "snapshot-missing"
      }
    });
  });

  it("normalizes legacy rollback_unavailable transport errors to policy_denied", async () => {
    const session = await localHttpHarness.startServer({
      adapter: {
        invoke() {
          throw new Error("rollback_unavailable: Snapshot snapshot-legacy could not be restored.");
        }
      },
      sessionToken: "test-token"
    });

    const { envelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-legacy-rollback",
        capability: "snapshot.restore",
        sessionScope: "dangerous_write",
        payload: {
          snapshotId: "snapshot-legacy"
        }
      })
    });

    expect(envelope.success).toBe(false);
    expect(envelope.error).toEqual({
      code: "policy_denied",
      message: "rollback_unavailable"
    });
  });

  it("preserves structured policy decision details from the sandbox adapter", async () => {
    const session = await localHttpHarness.startServer({
      adapter: createSandboxTestAdapter({
        sessionScope: "dangerous_write",
        policyEvaluator: createStaticPolicyEvaluator(
          denyTargetOutsideSandbox(
            createTargetOutsideSandboxPolicyDetails({
              rule: "object_namespace",
              targetLogicalName: "UnsafeRoot",
              targetDisplayName: "UnsafeRoot",
              expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
            })
          )
        )
      }),
      sessionToken: "test-token"
    });

    const { envelope } = await session.postEnvelope({
      request: createLocalHttpTestRequest({
        requestId: "req-policy-details",
        capability: "scene.object.delete",
        sessionScope: "dangerous_write",
        payload: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__Cube"
          }
        }
      })
    });

    expect(envelope.success).toBe(false);
    expect(envelope.error).toEqual({
      code: "policy_denied",
      message: "target_outside_sandbox",
      details: {
        rule: "object_namespace",
        targetLogicalName: "UnsafeRoot",
        targetDisplayName: "UnsafeRoot",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
  });
});
