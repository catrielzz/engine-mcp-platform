import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_CAPABILITY_CATALOG,
  EXPERIMENTAL_CAPABILITY_SLICE,
  FIRST_CAPABILITY_SLICE,
  P0_CAPABILITY_CATALOG,
  getCapabilityDescriptor,
  getCapabilitySchemas,
  isCapabilityName,
  validateCapabilityCatalog,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName
} from "./index.js";

interface CapabilitySample {
  input: unknown;
  output: unknown;
}

const VALID_SAMPLES: Record<CapabilityName, CapabilitySample> = {
  "editor.state.read": {
    input: {
      includeDiagnostics: true,
      includeActiveContainer: true
    },
    output: {
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
    }
  },
  "scene.hierarchy.read": {
    input: {
      depth: 2,
      includeComponents: true
    },
    output: {
      roots: [
        {
          object: {
            logicalName: "SandboxRoot"
          },
          active: true,
          labels: ["sandbox"],
          components: ["Transform"],
          children: [
            {
              object: {
                logicalName: "SandboxRoot/Cube"
              },
              active: true,
              children: []
            }
          ]
        }
      ]
    }
  },
  "scene.object.create": {
    input: {
      parent: {
        logicalName: "SandboxRoot"
      },
      name: "GeneratedCube",
      kind: "mesh",
      transform: {
        position: [0, 1, 0]
      },
      components: [
        {
          type: "Renderer",
          properties: {
            enabled: true
          }
        }
      ],
      setActive: true
    },
    output: {
      object: {
        logicalName: "SandboxRoot/GeneratedCube",
        displayName: "GeneratedCube"
      },
      created: true,
      transform: {
        position: [0, 1, 0]
      },
      appliedComponents: ["Renderer"]
    }
  },
  "scene.object.update": {
    input: {
      target: {
        logicalName: "SandboxRoot/GeneratedCube"
      },
      newName: "GeneratedCubeRenamed",
      active: false
    },
    output: {
      object: {
        logicalName: "SandboxRoot/GeneratedCubeRenamed"
      },
      updatedFields: ["newName", "active"]
    }
  },
  "scene.object.delete": {
    input: {
      target: {
        logicalName: "SandboxRoot/GeneratedCubeRenamed"
      },
      snapshotLabel: "sandbox-pre-delete"
    },
    output: {
      target: {
        logicalName: "SandboxRoot/GeneratedCubeRenamed"
      },
      deleted: true,
      snapshotId: "snapshot-001"
    }
  },
  "snapshot.restore": {
    input: {
      snapshotId: "snapshot-001"
    },
    output: {
      snapshotId: "snapshot-001",
      restored: true,
      target: {
        logicalName: "SandboxRoot/GeneratedCubeRenamed",
        displayName: "GeneratedCubeRenamed"
      }
    }
  },
  "asset.search": {
    input: {
      query: "Sandbox",
      kinds: ["scene", "prefab"],
      limit: 10
    },
    output: {
      results: [
        {
          assetPath: "Assets/Scenes/Sandbox.unity",
          displayName: "Sandbox",
          kind: "scene"
        }
      ],
      total: 1,
      truncated: false
    }
  },
  "script.validate": {
    input: {
      path: "Assets/Scripts/Spawner.cs",
      includeWarnings: true
    },
    output: {
      targetPath: "Assets/Scripts/Spawner.cs",
      isValid: true,
      diagnostics: []
    }
  },
  "console.read": {
    input: {
      sinceSequence: 10,
      severities: ["warning", "error"],
      limit: 25
    },
    output: {
      entries: [
        {
          severity: "warning",
          message: "Unused variable in Spawner.cs",
          sequence: 11,
          timestamp: "2026-03-19T01:00:00Z"
        }
      ],
      nextSequence: 12,
      truncated: false
    }
  },
  "test.run": {
    input: {
      filter: {
        namePattern: "Sandbox"
      },
      executionTarget: "editor",
      waitForCompletion: false
    },
    output: {
      jobId: "job-123",
      status: "queued",
      acceptedFilter: {
        namePattern: "Sandbox"
      }
    }
  },
  "test.job.read": {
    input: {
      jobId: "job-123",
      maxResults: 20
    },
    output: {
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
  }
};

describe("@engine-mcp/contracts", () => {
  it("keeps the published slices aligned with the capability catalogs", () => {
    expect(P0_CAPABILITY_CATALOG.slice).toBe("p0");
    expect(P0_CAPABILITY_CATALOG.capabilities.map(({ capability }) => capability)).toEqual(
      FIRST_CAPABILITY_SLICE
    );
    expect(validateCapabilityCatalog(P0_CAPABILITY_CATALOG).valid).toBe(true);

    expect(EXPERIMENTAL_CAPABILITY_CATALOG.slice).toBe("experimental");
    expect(EXPERIMENTAL_CAPABILITY_CATALOG.capabilities.map(({ capability }) => capability)).toEqual(
      EXPERIMENTAL_CAPABILITY_SLICE
    );
    expect(validateCapabilityCatalog(EXPERIMENTAL_CAPABILITY_CATALOG).valid).toBe(true);
  });

  it("exposes canonical descriptors and validates representative payloads", () => {
    for (const capability of Object.keys(VALID_SAMPLES) as CapabilityName[]) {
      const descriptor = getCapabilityDescriptor(capability);
      const sample = VALID_SAMPLES[capability];

      expect(descriptor.capability).toBe(capability);
      expect(validateCapabilityInput(capability, sample.input)).toEqual({
        valid: true,
        errors: []
      });
      expect(validateCapabilityOutput(capability, sample.output)).toEqual({
        valid: true,
        errors: []
      });
    }
  });

  it("materializes tool-ready schemas from the contracts package", () => {
    const readSchemas = getCapabilitySchemas("editor.state.read");
    const deleteSchemas = getCapabilitySchemas("scene.object.delete");

    expect(readSchemas.inputSchema).toMatchObject({
      type: "object",
      properties: {
        includeDiagnostics: {
          type: "boolean"
        }
      }
    });
    expect(deleteSchemas.outputSchema).toMatchObject({
      properties: {
        target: {
          $ref: "#/$defs/entityRef"
        },
        snapshotId: {
          $ref: "#/$defs/nonEmptyString"
        }
      },
      $defs: {
        entityRef: {
          type: "object"
        },
        nonEmptyString: {
          type: "string",
          minLength: 1
        }
      }
    });
  });

  it("rejects unknown capability ids and malformed payloads", () => {
    expect(isCapabilityName("test.run")).toBe(true);
    expect(isCapabilityName("snapshot.restore")).toBe(true);
    expect(isCapabilityName("unity.manage_gameobject")).toBe(false);

    const invalidCreate = validateCapabilityInput("scene.object.create", {
      parent: {
        logicalName: "SandboxRoot"
      }
    });
    const invalidRestore = validateCapabilityInput("snapshot.restore", {});
    const invalidJobOutput = validateCapabilityOutput("test.job.read", {
      jobId: "job-123",
      status: "completed",
      summary: {
        passed: 1,
        failed: 0
      }
    });

    expect(invalidCreate.valid).toBe(false);
    expect(invalidCreate.errors.some((error) => error.keyword === "required")).toBe(true);
    expect(invalidRestore.valid).toBe(false);
    expect(invalidRestore.errors.some((error) => error.keyword === "required")).toBe(true);
    expect(invalidJobOutput.valid).toBe(false);
    expect(invalidJobOutput.errors.some((error) => error.keyword === "required")).toBe(true);
  });
});
