import type { CapabilityName } from "@engine-mcp/contracts";
import type {
  PolicyContext,
  SandboxBoundaryPolicyContext,
  SandboxBoundaryReference
} from "@engine-mcp/policy-engine";

import {
  type EntityReferenceInput,
  type SceneObjectCreateInput,
  type SceneObjectDeleteInput,
  type SceneObjectUpdateInput,
  UNITY_SANDBOX_OBJECT_NAME_PREFIX,
  UNITY_SANDBOX_ROOT_LOGICAL_NAME
} from "./sandbox-model.js";

export function createUnitySandboxBoundaryPolicyContext(
  context: PolicyContext,
  sceneEnginePath: string
): SandboxBoundaryPolicyContext | undefined {
  const references = resolveUnitySandboxBoundaryReferences(
    context.capability,
    context.input,
    sceneEnginePath
  );

  if (references.length === 0) {
    return undefined;
  }

  return {
    expectedScenePath: sceneEnginePath,
    scenePath: sceneEnginePath,
    sandboxRootLogicalName: UNITY_SANDBOX_ROOT_LOGICAL_NAME,
    sandboxObjectNamePrefix: UNITY_SANDBOX_OBJECT_NAME_PREFIX,
    references
  };
}

export function resolveUnitySandboxBoundaryReferences(
  capability: CapabilityName,
  input: unknown,
  sceneEnginePath: string
): SandboxBoundaryReference[] {
  switch (capability) {
    case "scene.object.create": {
      const createInput = input as SceneObjectCreateInput;

      return [
        toSandboxBoundaryReference(
          createInput.parent ?? {
            logicalName: UNITY_SANDBOX_ROOT_LOGICAL_NAME,
            displayName: UNITY_SANDBOX_ROOT_LOGICAL_NAME
          },
          true,
          sceneEnginePath
        )
      ].filter(isSandboxBoundaryReference);
    }
    case "scene.object.update": {
      const updateInput = input as SceneObjectUpdateInput;

      return [
        toSandboxBoundaryReference(updateInput.target, false, sceneEnginePath),
        toSandboxBoundaryReference(updateInput.newParent, true, sceneEnginePath)
      ].filter(isSandboxBoundaryReference);
    }
    case "scene.object.delete": {
      const deleteInput = input as SceneObjectDeleteInput;

      return [toSandboxBoundaryReference(deleteInput.target, false, sceneEnginePath)].filter(
        isSandboxBoundaryReference
      );
    }
    default:
      return [];
  }
}

function toSandboxBoundaryReference(
  reference: EntityReferenceInput | undefined,
  allowSandboxRoot: boolean,
  sceneEnginePath: string
): SandboxBoundaryReference | undefined {
  if (!reference) {
    return undefined;
  }

  return {
    ...(reference.logicalName ? { logicalName: reference.logicalName } : {}),
    ...(reference.displayName ? { displayName: reference.displayName } : {}),
    scenePath: sceneEnginePath,
    allowSandboxRoot
  };
}

function isSandboxBoundaryReference(
  reference: SandboxBoundaryReference | undefined
): reference is SandboxBoundaryReference {
  return reference !== undefined;
}
