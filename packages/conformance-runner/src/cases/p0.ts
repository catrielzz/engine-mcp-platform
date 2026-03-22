import { FIRST_CAPABILITY_SLICE } from "@engine-mcp/contracts";

import type {
  ConformanceCase,
  ConformanceExpectation,
  P0CapabilityFixtures,
  P0CapabilityName
} from "../types.js";

export const P0_CAPABILITY_FIXTURES = Object.freeze({
  "editor.state.read": {
    validInput: {
      includeDiagnostics: true,
      includeSelection: true
    },
    invalidInput: {
      verbose: true
    }
  },
  "scene.hierarchy.read": {
    validInput: {
      depth: 2,
      includeComponents: true
    },
    invalidInput: {
      depth: -1
    }
  },
  "scene.object.create": {
    validInput: {
      parent: {
        logicalName: "SandboxRoot"
      },
      name: "GeneratedCube",
      kind: "mesh",
      transform: {
        position: [0, 1, 0]
      }
    },
    invalidInput: {
      parent: {
        logicalName: "SandboxRoot"
      }
    }
  },
  "scene.object.update": {
    validInput: {
      target: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
      },
      active: false
    },
    invalidInput: {
      target: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
      }
    }
  },
  "scene.object.delete": {
    validInput: {
      target: {
        logicalName: "SandboxRoot/MCP_E2E__GeneratedCube"
      },
      snapshotLabel: "before-delete"
    },
    invalidInput: {
      allowMissing: true
    }
  },
  "asset.search": {
    validInput: {
      query: "Sandbox",
      kinds: ["scene", "prefab"],
      limit: 10
    },
    invalidInput: {
      limit: 0
    }
  },
  "script.validate": {
    validInput: {
      path: "Assets/Scripts/Spawner.cs",
      includeWarnings: true
    },
    invalidInput: {
      includeWarnings: true
    }
  },
  "console.read": {
    validInput: {
      sinceSequence: 10,
      severities: ["warning", "error"],
      limit: 25
    },
    invalidInput: {
      severities: ["fatal"]
    }
  },
  "test.run": {
    validInput: {
      filter: {
        namePattern: "Sandbox"
      },
      executionTarget: "editor",
      waitForCompletion: false
    },
    invalidInput: {
      executionTarget: "server"
    }
  },
  "test.job.read": {
    validInput: {
      jobId: "job-123",
      maxResults: 20
    },
    invalidInput: {}
  }
} satisfies P0CapabilityFixtures);

function createP0CaseId(capability: P0CapabilityName, expectation: ConformanceExpectation): string {
  return `${capability}:${expectation}`;
}

export function createP0ConformanceCases(
  fixtures: P0CapabilityFixtures = P0_CAPABILITY_FIXTURES
): readonly ConformanceCase[] {
  return Object.freeze(
    FIRST_CAPABILITY_SLICE.flatMap((capability) => [
      {
        id: createP0CaseId(capability, "success"),
        capability,
        expectation: "success" as const,
        summary: `Accepts a canonical valid request for ${capability}.`,
        input: fixtures[capability].validInput
      },
      {
        id: createP0CaseId(capability, "invalid-input-rejected"),
        capability,
        expectation: "invalid-input-rejected" as const,
        summary: `Rejects a canonical invalid request for ${capability}.`,
        input: fixtures[capability].invalidInput
      }
    ])
  );
}

export const P0_CONFORMANCE_CASES = createP0ConformanceCases();
