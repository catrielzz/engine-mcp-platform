import { describe, expect, it } from "vitest";

import {
  UNITY_BRIDGE_P0_CAPABILITIES,
  UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
  createUnityLocalBridgeErrorResponse,
  createUnityLocalBridgeRequest,
  createUnityLocalBridgeSuccessResponse,
  parseUnityLocalBridgeRequest,
  parseUnityLocalBridgeResponse
} from "./index.js";

describe("@engine-mcp/unity-bridge local contract", () => {
  it("keeps the local bridge capability list aligned with the executable P0 bridge slice", () => {
    const request = createUnityLocalBridgeRequest({
      requestId: "req-001",
      capability: "scene.object.update",
      sessionScope: "sandbox_write",
      payload: {
        target: {
          logicalName: "SandboxRoot/GeneratedCube"
        }
      }
    });

    expect(request.protocolVersion).toBe(UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION);
    expect(UNITY_BRIDGE_P0_CAPABILITIES).toContain(request.capability);
  });

  it("parses canonical local bridge requests", () => {
    const request = parseUnityLocalBridgeRequest(
      JSON.stringify(
        createUnityLocalBridgeRequest({
          requestId: "req-002",
          capability: "scene.object.create",
          sessionScope: "sandbox_write",
          payload: {
            name: "GeneratedCube"
          }
        })
      )
    );

    expect(request).toEqual({
      protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
      requestId: "req-002",
      capability: "scene.object.create",
      sessionScope: "sandbox_write",
      payload: {
        name: "GeneratedCube"
      }
    });
  });

  it("parses experimental rollback requests", () => {
    const request = parseUnityLocalBridgeRequest(
      JSON.stringify(
        createUnityLocalBridgeRequest({
          requestId: "req-restore",
          capability: "snapshot.restore",
          sessionScope: "dangerous_write",
          payload: {
            snapshotId: "snapshot-0001"
          }
        })
      )
    );

    expect(request).toEqual({
      protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
      requestId: "req-restore",
      capability: "snapshot.restore",
      sessionScope: "dangerous_write",
      payload: {
        snapshotId: "snapshot-0001"
      }
    });
  });

  it("parses canonical success responses", () => {
    const response = parseUnityLocalBridgeResponse(
      JSON.stringify(
        createUnityLocalBridgeSuccessResponse(
          "req-003",
          {
            deleted: true
          },
          {
            snapshotId: "snapshot-0001"
          }
        )
      )
    );

    expect(response).toEqual({
      protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
      requestId: "req-003",
      success: true,
      payload: {
        deleted: true
      },
      snapshotId: "snapshot-0001"
    });
  });

  it("parses canonical error responses", () => {
    const response = parseUnityLocalBridgeResponse(
      JSON.stringify(
        createUnityLocalBridgeErrorResponse("req-004", {
          code: "policy_denied",
          message: "target_outside_sandbox",
          details: {
            rule: "object_namespace",
            targetLogicalName: "UnsafeRoot",
            targetDisplayName: "UnsafeRoot"
          }
        })
      )
    );

    expect(response).toEqual({
      protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
      requestId: "req-004",
      success: false,
      payload: null,
      error: {
        code: "policy_denied",
        message: "target_outside_sandbox",
        details: {
          rule: "object_namespace",
          targetLogicalName: "UnsafeRoot",
          targetDisplayName: "UnsafeRoot"
        }
      }
    });
  });

  it("normalizes legacy rollback_unavailable error responses for backward compatibility", () => {
    const response = parseUnityLocalBridgeResponse(
      JSON.stringify({
        protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
        requestId: "req-rollback-error",
        success: false,
        payload: null,
        error: {
          code: "rollback_unavailable",
          message: "snapshot-0001 could not be restored."
        }
      })
    );

    expect(response).toEqual({
      protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
      requestId: "req-rollback-error",
      success: false,
      payload: null,
      error: {
        code: "policy_denied",
        message: "rollback_unavailable"
      }
    });
  });

  it("rejects unsupported protocol versions and malformed failure envelopes", () => {
    expect(() =>
      parseUnityLocalBridgeRequest(
        JSON.stringify({
          protocolVersion: "9.9.9",
          requestId: "req-005",
          capability: "scene.object.create",
          sessionScope: "sandbox_write",
          payload: {}
        })
      )
    ).toThrow(/protocolVersion/);

    expect(() =>
      parseUnityLocalBridgeResponse(
        JSON.stringify({
          protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
          requestId: "req-006",
          success: false,
          payload: null
        })
      )
    ).toThrow(/must include error/);
  });
});
