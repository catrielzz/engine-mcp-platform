import { createUnityBridgeSandboxAdapter } from "../index.js";

export type UnityBridgeSandboxTestAdapter = ReturnType<typeof createUnityBridgeSandboxAdapter>;

interface SandboxParentReference {
  logicalName?: string;
  displayName?: string;
}

interface SandboxComponentInput {
  type: string;
}

interface SandboxTransformInput {
  position?: [number, number, number];
}

interface SandboxObjectInput {
  parent?: SandboxParentReference;
  name?: string;
  kind?: string;
  labels?: string[];
  components?: SandboxComponentInput[];
  transform?: SandboxTransformInput;
}

export interface SandboxHierarchyNode {
  object: {
    logicalName: string;
    displayName: string;
  };
  active: boolean;
  labels?: string[];
  components?: string[];
  children: SandboxHierarchyNode[];
}

export interface SandboxHierarchyResult {
  roots: SandboxHierarchyNode[];
}

export function createSandboxTestAdapter(
  options?: Parameters<typeof createUnityBridgeSandboxAdapter>[0]
): UnityBridgeSandboxTestAdapter {
  return createUnityBridgeSandboxAdapter(options);
}

export async function createSandboxObject(
  adapter: UnityBridgeSandboxTestAdapter,
  input: SandboxObjectInput = {}
): Promise<void> {
  await adapter.invoke({
    capability: "scene.object.create",
    input: {
      parent: input.parent ?? {
        logicalName: "SandboxRoot"
      },
      name: input.name ?? "GeneratedCube",
      kind: input.kind ?? "mesh",
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.components ? { components: input.components } : {}),
      ...(input.transform ? { transform: input.transform } : {})
    }
  });
}

export async function readSandboxHierarchy(
  adapter: UnityBridgeSandboxTestAdapter,
  input: Record<string, unknown> = {}
): Promise<SandboxHierarchyResult> {
  return (await adapter.invoke({
    capability: "scene.hierarchy.read",
    input
  })) as SandboxHierarchyResult;
}
