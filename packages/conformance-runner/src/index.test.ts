import { describe, expect, it } from "vitest";

import {
  FIRST_CAPABILITY_SLICE,
  validateCapabilityInput
} from "@engine-mcp/contracts";

import {
  READ_HEAVY_CONFORMANCE_CASES,
  createReadHeavyConformanceCases,
  P0_CONFORMANCE_CASES,
  getMissingCapabilities,
  isConformancePassing,
  runConformanceSuite,
  runP0Conformance,
  summarizeConformanceReport,
  type ConformanceCase,
  type ConformanceAdapter,
  type P0CapabilityName
} from "./index.js";

const VALID_OUTPUTS: Record<P0CapabilityName, unknown> = {
  "editor.state.read": {
    engine: "Unity",
    engineVersion: "6000.2",
    workspaceName: "SandboxProject",
    isReady: true,
    activity: "idle",
    selectionCount: 1,
    activeContainer: {
      enginePath: "Assets/Scenes/Sandbox.unity"
    },
    diagnostics: []
  },
  "scene.hierarchy.read": {
    roots: [
      {
        object: {
          logicalName: "SandboxRoot"
        },
        active: true,
        labels: ["sandbox"],
        components: ["Transform"],
        children: []
      }
    ]
  },
  "scene.object.create": {
    object: {
      logicalName: "SandboxRoot/MCP_E2E__GeneratedCube",
      displayName: "MCP_E2E__GeneratedCube"
    },
    created: true,
    transform: {
      position: [0, 1, 0]
    },
    appliedComponents: ["Transform"]
  },
  "scene.object.update": {
    object: {
      logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
    },
    updatedFields: ["active"]
  },
  "scene.object.delete": {
    target: {
      logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
    },
    deleted: true,
    snapshotId: "snapshot-001"
  },
  "asset.search": {
    results: [
      {
        assetPath: "Assets/Scenes/Sandbox.unity",
        displayName: "Sandbox",
        kind: "scene"
      }
    ],
    total: 1,
    truncated: false
  },
  "script.validate": {
    targetPath: "Assets/Scripts/Spawner.cs",
    isValid: true,
    diagnostics: []
  },
  "console.read": {
    entries: [
      {
        severity: "warning",
        message: "Unused variable",
        sequence: 11
      }
    ],
    nextSequence: 12,
    truncated: false
  },
  "test.run": {
    jobId: "job-123",
    status: "queued",
    acceptedFilter: {
      namePattern: "Sandbox"
    }
  },
  "test.job.read": {
    jobId: "job-123",
    status: "completed",
    progress: 1,
    summary: {
      passed: 4,
      failed: 0,
      skipped: 1
    },
    results: [
      {
        name: "Sandbox_CreatesObject",
        status: "passed",
        durationMs: 42
      }
    ]
  }
};

function createConformingAdapter(): ConformanceAdapter {
  return {
    adapter: "fake-unity",
    capabilities: FIRST_CAPABILITY_SLICE,
    async invoke({ capability, input }) {
      const validation = validateCapabilityInput(capability, input);

      if (!validation.valid) {
        throw new Error(`invalid ${capability} request`);
      }

      return VALID_OUTPUTS[capability as P0CapabilityName];
    }
  };
}

describe("@engine-mcp/conformance-runner", () => {
  it("provides one success case and one invalid-input case for each P0 capability", () => {
    expect(P0_CONFORMANCE_CASES).toHaveLength(FIRST_CAPABILITY_SLICE.length * 2);

    for (const capability of FIRST_CAPABILITY_SLICE) {
      const capabilityCases = P0_CONFORMANCE_CASES.filter((entry) => entry.capability === capability);

      expect(capabilityCases.map((entry) => entry.expectation)).toEqual([
        "success",
        "invalid-input-rejected"
      ]);
    }
  });

  it("provides richer read-heavy conformance cases with output subsets", () => {
    expect(READ_HEAVY_CONFORMANCE_CASES).toHaveLength(6);
    expect(
      createReadHeavyConformanceCases({
        testJobId: "job-999"
      }).find((entry) => entry.capability === "test.job.read")
    ).toMatchObject({
      input: {
        jobId: "job-999"
      },
      expectedOutputSubset: {
        jobId: "job-999"
      }
    });
  });

  it("passes the full P0 suite for a contract-conforming adapter", async () => {
    const report = await runP0Conformance(createConformingAdapter());

    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.passed).toBe(P0_CONFORMANCE_CASES.length);
    expect(isConformancePassing(report)).toBe(true);
    expect(summarizeConformanceReport(report)).toBe("fake-unity: 20 passed, 0 failed, 0 skipped");
  });

  it("reports declaration gaps and invalid outputs", async () => {
    const selectedCapabilities = new Set<P0CapabilityName>(["scene.object.delete", "console.read"]);
    const selectedCases = P0_CONFORMANCE_CASES.filter(({ capability }) =>
      selectedCapabilities.has(capability as P0CapabilityName)
    );

    const adapter: ConformanceAdapter = {
      adapter: "broken-adapter",
      capabilities: ["console.read"],
      async invoke({ capability, input }) {
        const validation = validateCapabilityInput(capability, input);

        if (!validation.valid) {
          throw new Error(`invalid ${capability} request`);
        }

        if (capability === "console.read") {
          return {
            truncated: false
          };
        }

        return VALID_OUTPUTS[capability as P0CapabilityName];
      }
    };

    const report = await runConformanceSuite(adapter, selectedCases, {
      requiredCapabilities: ["scene.object.delete", "console.read"]
    });

    expect(getMissingCapabilities(adapter.capabilities, ["scene.object.delete", "console.read"])).toEqual([
      "scene.object.delete"
    ]);
    expect(isConformancePassing(report)).toBe(false);
    expect(report.failed).toBe(2);
    expect(report.skipped).toBe(2);
    expect(report.results.some((result) => result.phase === "declaration")).toBe(true);
    expect(report.results.some((result) => result.phase === "output")).toBe(true);
  });

  it("can validate expected structured policy denials for valid requests", async () => {
    const policyCase: ConformanceCase = {
      id: "scene.object.delete:policy-denied",
      capability: "scene.object.delete",
      expectation: "error",
      summary: "Rejects a valid destructive request with canonical sandbox policy details.",
      input: {
        target: {
          logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
        }
      },
      expectedError: {
        code: "policy_denied",
        message: "target_outside_sandbox",
        detailsSubset: {
          rule: "object_namespace",
          targetLogicalName: "UnsafeRoot"
        }
      }
    };

    const adapter: ConformanceAdapter = {
      adapter: "policy-adapter",
      capabilities: ["scene.object.delete"],
      async invoke() {
        const error = Object.assign(new Error("target_outside_sandbox"), {
          decision: {
            code: "policy_denied",
            reason: "target_outside_sandbox",
            details: {
              rule: "object_namespace",
              targetLogicalName: "UnsafeRoot",
              targetDisplayName: "UnsafeRoot"
            }
          }
        });

        throw error;
      }
    };

    const report = await runConformanceSuite(adapter, [policyCase], {
      requiredCapabilities: ["scene.object.delete"]
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.results[0]).toMatchObject({
      outcome: "passed",
      phase: "invoke"
    });
  });

  it("can validate expected output subsets for richer read-heavy cases", async () => {
    const cases = createReadHeavyConformanceCases({
      testJobId: "job-123"
    });

    const adapter: ConformanceAdapter = {
      adapter: "rich-adapter",
      capabilities: [
        "asset.search",
        "script.validate",
        "console.read",
        "test.run",
        "test.job.read"
      ],
      async invoke({ capability, input }) {
        switch (capability) {
          case "asset.search":
            return {
              results: [
                {
                  assetGuid: "guid-scene-001",
                  assetPath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity",
                  displayName: "SandboxScene",
                  kind: "scene"
                }
              ],
              total: 2,
              truncated: true
            };
          case "script.validate":
            return {
              targetPath:
                "assetGuid" in (input as Record<string, unknown>) && (input as Record<string, unknown>).assetGuid
                  ? "Assets/Scripts/Spawner.cs"
                  : "Assets/Scripts/Spawner.cs",
              isValid: true,
              diagnostics: []
            };
          case "console.read":
            return {
              entries: [
                {
                  severity: "warning",
                  message: "Sandbox compile warning",
                  channel: "unity",
                  source: "editor",
                  sequence: 2,
                  timestamp: "2026-03-20T00:00:01.000Z"
                }
              ],
              nextSequence: 2,
              truncated: true
            };
          case "test.run":
            return {
              jobId: "job-234",
              status: "completed",
              acceptedFilter: {
                namePattern: "Sandbox"
              }
            };
          case "test.job.read":
            return {
              jobId: "job-123",
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
            };
          default:
            throw new Error(`Unsupported capability ${capability}.`);
        }
      }
    };

    const report = await runConformanceSuite(adapter, cases, {
      requiredCapabilities: adapter.capabilities
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(cases.length);
  });
});
