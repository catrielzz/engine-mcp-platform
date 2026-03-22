import { describe, expect, it } from "vitest";

import {
  ROLLBACK_UNAVAILABLE_POLICY_REASON,
  SANDBOX_POLICY_RULES,
  SNAPSHOT_REQUIRED_POLICY_REASON,
  TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
  createSnapshotAvailabilityPolicyDetails,
  createSnapshotAvailabilityPolicyEvaluator,
  createSandboxBoundaryPolicyEvaluator,
  createPolicyContext,
  createTargetOutsideSandboxPolicyDetails,
  createStaticPolicyEvaluator,
  denyRollbackUnavailable,
  denySnapshotRequired,
  denyTargetOutsideSandbox,
  evaluateSandboxBoundaryPolicy,
  evaluateSnapshotAvailabilityPolicy,
  evaluateScopePolicy,
  hasScopeForOperationClass,
  requiredScopeForOperationClass,
  resolvePolicyDecision
} from "./index.js";

describe("@engine-mcp/policy-engine", () => {
  it("maps operation classes to the expected minimum session scope", () => {
    expect(requiredScopeForOperationClass("read")).toBe("inspect");
    expect(requiredScopeForOperationClass("write_safe")).toBe("sandbox_write");
    expect(requiredScopeForOperationClass("write_project")).toBe("project_write");
    expect(requiredScopeForOperationClass("destructive")).toBe("dangerous_write");
  });

  it("enforces session scopes by operation class", () => {
    expect(hasScopeForOperationClass("inspect", "read")).toBe(true);
    expect(hasScopeForOperationClass("inspect", "write_safe")).toBe(false);
    expect(hasScopeForOperationClass("sandbox_write", "write_safe")).toBe(true);
    expect(hasScopeForOperationClass("sandbox_write", "destructive")).toBe(false);
    expect(hasScopeForOperationClass("dangerous_write", "destructive")).toBe(true);
  });

  it("returns scope_missing for requests below the required scope", async () => {
    const context = createPolicyContext(
      "unity-bridge-sandbox",
      "scene.object.delete",
      "sandbox_write",
      {
        target: {
          logicalName: "SandboxRoot/Cube"
        }
      },
      {
        target: "SandboxRoot/Cube",
        snapshotAvailable: true
      }
    );

    const decision = await resolvePolicyDecision(context);

    expect(decision).toEqual({
      allowed: false,
      code: "scope_missing",
      reason: "scene.object.delete requires session scope dangerous_write."
    });
    expect(evaluateScopePolicy(context)).toEqual(decision);
  });

  it("supports explicit policy overrides", async () => {
    const context = createPolicyContext(
      "unity-bridge-sandbox",
      "scene.object.create",
      "inspect",
      {
        name: "Cube"
      }
    );

    const decision = await resolvePolicyDecision(
      context,
      createStaticPolicyEvaluator({
        allowed: true,
        reason: "bootstrap override"
      })
    );

    expect(decision).toEqual({
      allowed: true,
      reason: "bootstrap override"
    });
  });

  it("provides canonical helpers for target_outside_sandbox denials", () => {
    const details = createTargetOutsideSandboxPolicyDetails({
      rule: "object_namespace",
      targetLogicalName: "UnsafeRoot",
      targetDisplayName: "UnsafeRoot",
      scenePath: "Assets/Scenes/UnsafeScene.unity",
      expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
    });

    expect(SANDBOX_POLICY_RULES).toEqual([
      "scene_path",
      "object_namespace",
      "sandbox_root_immutable"
    ]);
    expect(denyTargetOutsideSandbox(details)).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details
    });
  });

  it("evaluates sandbox boundary rules with canonical object namespace and root immutability semantics", () => {
    const allowed = evaluateSandboxBoundaryPolicy({
      expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      scenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      sandboxRootLogicalName: "SandboxRoot",
      sandboxObjectNamePrefix: "MCP_E2E__",
      references: [
        {
          logicalName: "SandboxRoot",
          displayName: "SandboxRoot",
          allowSandboxRoot: true
        },
        {
          logicalName: "SandboxRoot/MCP_E2E__Cube",
          displayName: "MCP_E2E__Cube"
        }
      ]
    });
    const namespaceDenied = evaluateSandboxBoundaryPolicy({
      expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      scenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      sandboxRootLogicalName: "SandboxRoot",
      sandboxObjectNamePrefix: "MCP_E2E__",
      references: [
        {
          logicalName: "SandboxRoot/UnsafeCube",
          displayName: "UnsafeCube"
        }
      ]
    });
    const rootDenied = evaluateSandboxBoundaryPolicy({
      expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      scenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      sandboxRootLogicalName: "SandboxRoot",
      sandboxObjectNamePrefix: "MCP_E2E__",
      references: [
        {
          logicalName: "SandboxRoot",
          displayName: "SandboxRoot"
        }
      ]
    });
    const sceneDenied = evaluateSandboxBoundaryPolicy({
      expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
      scenePath: "Assets/Scenes/Main.unity",
      sandboxRootLogicalName: "SandboxRoot",
      sandboxObjectNamePrefix: "MCP_E2E__",
      references: [
        {
          logicalName: "SandboxRoot/MCP_E2E__Cube",
          displayName: "MCP_E2E__Cube"
        }
      ]
    });

    expect(allowed).toEqual({
      allowed: true,
      reason: undefined
    });
    expect(namespaceDenied).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details: {
        rule: "object_namespace",
        targetLogicalName: "SandboxRoot/UnsafeCube",
        targetDisplayName: "UnsafeCube",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
    expect(rootDenied).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details: {
        rule: "sandbox_root_immutable",
        targetLogicalName: "SandboxRoot",
        targetDisplayName: "SandboxRoot",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
    expect(sceneDenied).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details: {
        rule: "scene_path",
        targetLogicalName: "SandboxRoot/MCP_E2E__Cube",
        targetDisplayName: "MCP_E2E__Cube",
        scenePath: "Assets/Scenes/Main.unity",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
  });

  it("composes scope and reusable sandbox boundary hooks in a single evaluator", async () => {
    const evaluator = createSandboxBoundaryPolicyEvaluator((context) => {
      if (context.capability !== "scene.object.delete") {
        return undefined;
      }

      return {
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
        scenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity",
        sandboxRootLogicalName: "SandboxRoot",
        sandboxObjectNamePrefix: "MCP_E2E__",
        references: [
          {
            logicalName: "UnsafeRoot/UnsafeCube",
            displayName: "UnsafeCube"
          }
        ]
      };
    });
    const context = createPolicyContext(
      "unity-bridge-sandbox",
      "scene.object.delete",
      "dangerous_write",
      {
        target: {
          logicalName: "UnsafeRoot/UnsafeCube"
        }
      },
      {
        target: "UnsafeRoot/UnsafeCube",
        snapshotAvailable: true
      }
    );

    await expect(resolvePolicyDecision(context, evaluator)).resolves.toEqual({
      allowed: false,
      code: "policy_denied",
      reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
      details: {
        rule: "object_namespace",
        targetLogicalName: "UnsafeRoot/UnsafeCube",
        targetDisplayName: "UnsafeCube",
        expectedScenePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
      }
    });
  });

  it("provides canonical helpers for snapshot-required and rollback-unavailable denials", () => {
    const deleteDetails = createSnapshotAvailabilityPolicyDetails({
      capability: "scene.object.delete",
      target: "SandboxRoot/GeneratedCube",
      input: {}
    });
    const restoreDetails = createSnapshotAvailabilityPolicyDetails({
      capability: "snapshot.restore",
      input: {
        snapshotId: "snapshot-001"
      }
    });

    expect(denySnapshotRequired(deleteDetails)).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: SNAPSHOT_REQUIRED_POLICY_REASON,
      details: {
        capability: "scene.object.delete",
        targetLogicalName: "SandboxRoot/GeneratedCube"
      }
    });
    expect(denyRollbackUnavailable(restoreDetails)).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: ROLLBACK_UNAVAILABLE_POLICY_REASON,
      details: {
        capability: "snapshot.restore",
        snapshotId: "snapshot-001"
      }
    });
  });

  it("evaluates snapshot availability for destructive delete and rollback restore flows", () => {
    const snapshotRequired = evaluateSnapshotAvailabilityPolicy(
      createPolicyContext(
        "unity-bridge-sandbox",
        "scene.object.delete",
        "dangerous_write",
        {
          target: {
            logicalName: "SandboxRoot/GeneratedCube"
          }
        },
        {
          target: "SandboxRoot/GeneratedCube",
          snapshotAvailable: false
        }
      )
    );
    const rollbackUnavailable = evaluateSnapshotAvailabilityPolicy(
      createPolicyContext(
        "unity-bridge-sandbox",
        "snapshot.restore",
        "dangerous_write",
        {
          snapshotId: "snapshot-missing"
        },
        {
          snapshotAvailable: false
        }
      )
    );
    const allowedDelete = evaluateSnapshotAvailabilityPolicy(
      createPolicyContext(
        "unity-bridge-sandbox",
        "scene.object.delete",
        "dangerous_write",
        {
          target: {
            logicalName: "SandboxRoot/GeneratedCube"
          }
        },
        {
          target: "SandboxRoot/GeneratedCube",
          snapshotAvailable: true
        }
      )
    );

    expect(snapshotRequired).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: SNAPSHOT_REQUIRED_POLICY_REASON,
      details: {
        capability: "scene.object.delete",
        targetLogicalName: "SandboxRoot/GeneratedCube"
      }
    });
    expect(rollbackUnavailable).toEqual({
      allowed: false,
      code: "policy_denied",
      reason: ROLLBACK_UNAVAILABLE_POLICY_REASON,
      details: {
        capability: "snapshot.restore",
        snapshotId: "snapshot-missing"
      }
    });
    expect(allowedDelete).toEqual({
      allowed: true,
      reason: undefined
    });
  });

  it("composes scope and snapshot availability hooks in a single evaluator", async () => {
    const evaluator = createSnapshotAvailabilityPolicyEvaluator();
    const context = createPolicyContext(
      "unity-bridge-sandbox",
      "snapshot.restore",
      "dangerous_write",
      {
        snapshotId: "snapshot-missing"
      },
      {
        snapshotAvailable: false
      }
    );

    await expect(resolvePolicyDecision(context, evaluator)).resolves.toEqual({
      allowed: false,
      code: "policy_denied",
      reason: ROLLBACK_UNAVAILABLE_POLICY_REASON,
      details: {
        capability: "snapshot.restore",
        snapshotId: "snapshot-missing"
      }
    });
  });
});
