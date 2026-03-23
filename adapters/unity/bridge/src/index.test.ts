import {
  ROLLBACK_UNAVAILABLE_POLICY_REASON,
  SNAPSHOT_REQUIRED_POLICY_REASON,
  TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
  createStaticPolicyEvaluator,
  createTargetOutsideSandboxPolicyDetails,
  denyTargetOutsideSandbox
} from "@engine-mcp/policy-engine";
import { describe, expect, it } from "vitest";

import { runConformanceSuite, type ConformanceCase } from "@engine-mcp/conformance-runner";

import { UnityBridgePolicyError, UnityBridgeValidationError } from "./index.js";
import {
  runUnityBridgeP0Conformance,
  runUnityBridgeReadHeavyConformance
} from "./test-support/conformance.js";
import {
  createSandboxObject,
  createSandboxTestAdapter,
  readSandboxHierarchy
} from "./test-support/sandbox.js";

describe("@engine-mcp/unity-bridge", () => {
  it("passes the P0 sub-suite for read/create/update/delete when the session scope allows destructive writes", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write"
    });
    const { report, selectedCases } = await runUnityBridgeP0Conformance(adapter);

    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.passed).toBe(selectedCases.length);
  });

  it("persists created objects into the sandbox hierarchy", async () => {
    const adapter = createSandboxTestAdapter();

    await createSandboxObject(adapter, {
      labels: ["generated"],
      components: [
        {
          type: "MeshRenderer"
        }
      ],
      transform: {
        position: [1, 2, 3]
      }
    });

    const hierarchy = await readSandboxHierarchy(adapter, {
      includeComponents: true
    });

    expect(hierarchy.roots[0]?.children).toContainEqual({
      object: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
        displayName: "MCP_E2E__GeneratedCube"
      },
      active: true,
      components: ["Transform", "MeshRenderer"],
      labels: ["generated"],
      children: []
    });
  });

  it("updates logical names and active state for existing objects", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write"
    });

    await createSandboxObject(adapter);

    const updateResult = (await adapter.invoke({
      capability: "scene.object.update",
      input: {
        target: {
          logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
        },
        newName: "GeneratedCubeRenamed",
        active: false
      }
    })) as {
      object: {
        logicalName: string;
        displayName: string;
      };
      updatedFields: string[];
    };

    const hierarchy = await readSandboxHierarchy(adapter);

    expect(updateResult.object).toEqual({
      logicalName: "SandboxRoot/MCP_E2E__GeneratedCubeRenamed",
      displayName: "MCP_E2E__GeneratedCubeRenamed"
    });
    expect(updateResult.updatedFields).toEqual(["newName", "active"]);
    expect(hierarchy.roots[0]?.children).toContainEqual({
      object: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCubeRenamed",
        displayName: "MCP_E2E__GeneratedCubeRenamed"
      },
      active: false,
      labels: [],
      children: []
    });
  });

  it("captures a snapshot before delete and restores it through the canonical rollback capability", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write"
    });

    await createSandboxObject(adapter);

    const deleteResult = (await adapter.invoke({
      capability: "scene.object.delete",
      input: {
        target: {
          logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
        },
        snapshotLabel: "before-delete"
      }
    })) as {
      deleted: boolean;
      snapshotId: string;
    };

    const afterDelete = adapter.snapshotHierarchy();

    expect(deleteResult.deleted).toBe(true);
    expect(adapter.listSnapshots()).toHaveLength(1);
    expect(afterDelete[0]?.children).toHaveLength(0);
    await expect(
      adapter.invoke({
        capability: "snapshot.restore",
        input: {
          snapshotId: deleteResult.snapshotId
        }
      })
    ).resolves.toEqual({
      snapshotId: deleteResult.snapshotId,
      restored: true,
      target: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
        displayName: "MCP_E2E__GeneratedCube"
      }
    });
    expect(adapter.snapshotHierarchy()[0]?.children[0]?.logicalName).toBe(
      "SandboxRoot/MCP_E2E__GeneratedCube"
    );
    expect(adapter.listSnapshots()).toHaveLength(0);
    expect(adapter.restoreSnapshot(deleteResult.snapshotId)).toBe(false);

    await expect(
      adapter.invoke({
        capability: "snapshot.restore",
        input: {
          snapshotId: deleteResult.snapshotId
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgePolicyError",
      capability: "snapshot.restore",
      decision: {
        allowed: false,
        code: "policy_denied",
        reason: ROLLBACK_UNAVAILABLE_POLICY_REASON,
        details: {
          capability: "snapshot.restore",
          snapshotId: deleteResult.snapshotId
        }
      }
    });
  });

  it("rejects destructive deletes without dangerous scope and leaves state untouched", async () => {
    const adapter = createSandboxTestAdapter();

    await createSandboxObject(adapter);

    await expect(
      adapter.invoke({
        capability: "scene.object.delete",
        input: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
          }
        }
      })
    ).rejects.toBeInstanceOf(UnityBridgePolicyError);

    expect(adapter.snapshotHierarchy()[0]?.children[0]?.logicalName).toBe(
      "SandboxRoot/MCP_E2E__GeneratedCube"
    );
  });

  it("rejects destructive deletes when snapshot capture is unavailable", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write",
      canCaptureSnapshots: false
    });

    await createSandboxObject(adapter);

    await expect(
      adapter.invoke({
        capability: "scene.object.delete",
        input: {
          target: {
            logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
          }
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgePolicyError",
      capability: "scene.object.delete",
      decision: {
        allowed: false,
        code: "policy_denied",
        reason: SNAPSHOT_REQUIRED_POLICY_REASON,
        details: {
          capability: "scene.object.delete",
          targetLogicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
        }
      }
    });
  });

  it("rejects sandbox updates that target objects outside the reserved namespace", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write"
    });

    await expect(
      adapter.invoke({
        capability: "scene.object.update",
        input: {
          target: {
            logicalName: "UnsafeRoot/UnsafeCube"
          },
          active: false
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgePolicyError",
      capability: "scene.object.update",
      decision: {
        allowed: false,
        code: "policy_denied",
        reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
        details: {
          rule: "object_namespace",
          targetLogicalName: "UnsafeRoot/UnsafeCube",
          expectedScenePath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity"
        }
      }
    });
  });

  it("rejects creates whose requested parent is outside the sandbox boundary", async () => {
    const adapter = createSandboxTestAdapter();

    await expect(
      adapter.invoke({
        capability: "scene.object.create",
        input: {
          parent: {
            displayName: "UnsafeRoot"
          },
          name: "GeneratedCube"
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgePolicyError",
      capability: "scene.object.create",
      decision: {
        allowed: false,
        code: "policy_denied",
        reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
        details: {
          rule: "object_namespace",
          targetDisplayName: "UnsafeRoot",
          expectedScenePath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity"
        }
      }
    });
  });

  it("rejects sandbox deletes that try to mutate the immutable sandbox root", async () => {
    const adapter = createSandboxTestAdapter({
      sessionScope: "dangerous_write"
    });

    await expect(
      adapter.invoke({
        capability: "scene.object.delete",
        input: {
          target: {
            logicalName: "SandboxRoot"
          }
        }
      })
    ).rejects.toMatchObject({
      name: "UnityBridgePolicyError",
      capability: "scene.object.delete",
      decision: {
        allowed: false,
        code: "policy_denied",
        reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
        details: {
          rule: "sandbox_root_immutable",
          targetLogicalName: "SandboxRoot",
          expectedScenePath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity"
        }
      }
    });
  });

  it("passes a conformance case for structured sandbox policy denials in the fallback adapter", async () => {
    const adapter = createSandboxTestAdapter({
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
    });
    const cases: ConformanceCase[] = [
      {
        id: "scene.object.delete:policy-denied-fallback",
        capability: "scene.object.delete",
        expectation: "error",
        summary: "Fallback adapter preserves canonical sandbox denial details.",
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

    const report = await runConformanceSuite(adapter, cases, {
      requiredCapabilities: ["scene.object.delete"]
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it("passes richer read-heavy conformance cases in the fallback adapter", async () => {
    const adapter = createSandboxTestAdapter();
    const { report, cases } = await runUnityBridgeReadHeavyConformance(adapter);

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(cases.length);
  });

  it("rejects invalid canonical inputs before mutating state", async () => {
    const adapter = createSandboxTestAdapter();

    await expect(
      adapter.invoke({
        capability: "scene.object.create",
        input: {
          parent: {
            logicalName: "SandboxRoot"
          }
        }
      })
    ).rejects.toBeInstanceOf(UnityBridgeValidationError);

    expect(adapter.snapshotHierarchy()[0]?.children).toHaveLength(0);
  });

  it("tracks synthetic test jobs through test.run and test.job.read in the sandbox adapter", async () => {
    const adapter = createSandboxTestAdapter();

    const runResult = (await adapter.invoke({
      capability: "test.run",
      input: {
        filter: {
          namePattern: "Sandbox"
        },
        executionTarget: "editor",
        waitForCompletion: false
      }
    })) as {
      jobId: string;
      status: string;
      acceptedFilter?: {
        namePattern?: string;
      };
    };

    const readResult = (await adapter.invoke({
      capability: "test.job.read",
      input: {
        jobId: runResult.jobId
      }
    })) as {
      jobId: string;
      status: string;
      progress: number;
      summary: {
        passed: number;
        failed: number;
        skipped: number;
      };
      results: Array<{
        name: string;
        status: string;
      }>;
    };

    expect(runResult.status).toBe("completed");
    expect(runResult.acceptedFilter).toEqual({
      namePattern: "Sandbox"
    });
    expect(readResult.jobId).toBe(runResult.jobId);
    expect(readResult.status).toBe("completed");
    expect(readResult.progress).toBe(1);
    expect(readResult.summary).toEqual({
      passed: 1,
      failed: 0,
      skipped: 0
    });
    expect(readResult.results).toEqual([
      {
        name: "Sandbox.EditMode.GeneratedTest",
        status: "passed"
      }
    ]);
  });

  it("returns filtered console entries with incremental sequencing in the sandbox adapter", async () => {
    const adapter = createSandboxTestAdapter();

    const firstPage = (await adapter.invoke({
      capability: "console.read",
      input: {
        sinceSequence: 0,
        severities: ["warning", "error"],
        limit: 1
      }
    })) as {
      entries: Array<{
        severity: string;
        message: string;
        sequence: number;
      }>;
      nextSequence: number;
      truncated: boolean;
    };

    expect(firstPage.truncated).toBe(true);
    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.entries[0]).toMatchObject({
      severity: "warning",
      message: "Sandbox compile warning",
      sequence: 2
    });

    const secondPage = (await adapter.invoke({
      capability: "console.read",
      input: {
        sinceSequence: firstPage.nextSequence,
        severities: ["warning", "error"],
        limit: 10
      }
    })) as {
      entries: Array<{
        severity: string;
        message: string;
        sequence: number;
      }>;
      nextSequence: number;
      truncated: boolean;
    };

    expect(secondPage.truncated).toBe(false);
    expect(secondPage.entries).toEqual([
      {
        severity: "error",
        message: "Sandbox exception captured",
        channel: "unity",
        source: "editor",
        sequence: 3,
        timestamp: "2026-03-20T00:00:02.000Z"
      }
    ]);
    expect(secondPage.nextSequence).toBe(3);
  });

  it("returns filtered asset search results with truncation in the sandbox adapter", async () => {
    const adapter = createSandboxTestAdapter();

    const result = (await adapter.invoke({
      capability: "asset.search",
      input: {
        query: "Sandbox",
        roots: ["Assets/MCP_Sandbox"],
        kinds: ["scene", "prefab"],
        limit: 1
      }
    })) as {
      results: Array<{
        assetGuid: string;
        assetPath: string;
        displayName: string;
        kind: string;
      }>;
      total: number;
      truncated: boolean;
    };

    expect(result.truncated).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.kind).toMatch(/scene|prefab/);
    expect(result.results[0]?.assetPath).toMatch(/^Assets\/MCP_Sandbox\//);
    expect(result.results[0]?.assetGuid).toBeTruthy();
  });

  it("resolves script.validate through the sandbox adapter by asset guid", async () => {
    const adapter = createSandboxTestAdapter();

    const result = (await adapter.invoke({
      capability: "script.validate",
      input: {
        assetGuid: "sandbox-script-001",
        includeWarnings: true
      }
    })) as {
      targetPath: string;
      isValid: boolean;
      diagnostics: unknown[];
    };

    expect(result).toEqual({
      targetPath: "Assets/Scripts/Spawner.cs",
      isValid: true,
      diagnostics: []
    });
  });
});
