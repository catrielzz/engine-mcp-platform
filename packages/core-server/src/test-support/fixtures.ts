import {
  validateCapabilityInput,
  type CapabilityName,
  type PromptDefinition
} from "@engine-mcp/contracts";

import type { EngineMcpCapabilityAdapter } from "../index.js";
import type { TaskDescriptor } from "./types.js";

export interface CapabilitySample {
  input: unknown;
  output: unknown;
}

export const VALID_SAMPLES = {
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
    input: {},
    output: {
      container: {
        displayName: "SandboxScene",
        enginePath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity"
      },
      roots: [
        {
          object: {
            logicalName: "SandboxRoot",
            displayName: "SandboxRoot"
          },
          active: true,
          children: [
            {
              object: {
                logicalName: "SandboxRoot/Gameplay",
                displayName: "Gameplay"
              },
              active: true,
              children: [
                {
                  object: {
                    logicalName: "SandboxRoot/Gameplay/CheckpointMarker",
                    displayName: "CheckpointMarker"
                  },
                  active: true,
                  children: []
                }
              ]
            }
          ]
        }
      ]
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
  "asset.search": {
    input: {
      query: "Spawner",
      kinds: ["script"],
      limit: 50
    },
    output: {
      results: [
        {
          assetPath: "Assets/Scripts/Spawner.cs",
          displayName: "Spawner",
          kind: "script"
        },
        {
          assetPath: "Assets/Scripts/SpawnerAuthoring.cs",
          displayName: "SpawnerAuthoring",
          kind: "script"
        }
      ],
      total: 2,
      truncated: false
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
  }
} satisfies Record<string, CapabilitySample>;

export function createFakeAdapter(
  capabilities: readonly EngineMcpCapabilityAdapter["capabilities"][number][],
  handler: (request: any) => Promise<unknown> | unknown,
  options: {
    prompts?: readonly PromptDefinition[];
    listResources?: EngineMcpCapabilityAdapter["listResources"];
    readResource?: EngineMcpCapabilityAdapter["readResource"];
    completePromptArgument?: EngineMcpCapabilityAdapter["completePromptArgument"];
  } = {}
): EngineMcpCapabilityAdapter {
  return {
    adapter: "fake-core-server-adapter",
    capabilities,
    ...(options.prompts ? { prompts: options.prompts } : {}),
    ...(options.listResources ? { listResources: options.listResources } : {}),
    ...(options.readResource ? { readResource: options.readResource } : {}),
    ...(options.completePromptArgument
      ? { completePromptArgument: options.completePromptArgument }
      : {}),
    invoke: handler as EngineMcpCapabilityAdapter["invoke"]
  };
}

export function createContractAwareFakeAdapter(
  outputs: Partial<Record<CapabilityName, unknown>>,
  adapterId = "fake-contract-aware-adapter"
): EngineMcpCapabilityAdapter {
  const capabilities = Object.keys(outputs) as CapabilityName[];

  return {
    adapter: adapterId,
    capabilities,
    async invoke(request) {
      const validation = validateCapabilityInput(request.capability, request.input);

      if (!validation.valid) {
        throw new Error(`Invalid ${request.capability} input.`);
      }

      const output = outputs[request.capability];

      if (output === undefined) {
        throw new Error(`No fake output configured for ${request.capability}.`);
      }

      return output;
    }
  };
}

export function createDeferred<T = unknown>(): {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
  reject(error?: unknown): void;
} {
  let promiseResolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((innerResolve, promiseReject) => {
    promiseResolve = innerResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve(value) {
      promiseResolve(value as T | PromiseLike<T>);
    },
    reject
  };
}

export function createRemoteTaskDescriptor(
  taskId: string,
  status: "working" | "input_required" | "completed" | "failed" | "cancelled",
  pollInterval = 1,
  ttl = 1_500
): TaskDescriptor {
  const timestamp = "2026-03-20T00:00:00.000Z";

  return {
    taskId,
    status,
    ttl,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
    pollInterval
  };
}
