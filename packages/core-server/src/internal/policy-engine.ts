import {
  getCapabilityDescriptor,
  type CapabilityName,
  type OperationRiskClass,
  type PolicyDecisionRecord,
  type PolicyScope,
  type PolicyTargetDescriptor
} from "@engine-mcp/contracts";

import { isJsonRecord } from "./json.js";
import type { EngineMcpToolError } from "../shared.js";

const SANDBOX_LOGICAL_NAME_ROOT = "SandboxRoot";
const SANDBOX_SCENE_CAPABILITIES = new Set<CapabilityName>([
  "scene.object.create",
  "scene.object.update",
  "scene.object.delete"
]);

const REQUIRED_SCOPES_BY_RISK: Record<OperationRiskClass, readonly PolicyScope[]> = {
  read: ["read"],
  write_safe: ["write"],
  write_project: ["write", "project"],
  destructive: ["write", "project"],
  external: ["external"]
};

export interface ToolPolicyEvaluation {
  decision: PolicyDecisionRecord;
  target?: PolicyTargetDescriptor;
}

export function evaluateToolPolicy(
  capability: CapabilityName,
  input: unknown
): ToolPolicyEvaluation {
  const descriptor = getCapabilityDescriptor(capability);
  const target = extractPolicyTarget(capability, input);
  const sandboxOnly = SANDBOX_SCENE_CAPABILITIES.has(capability);
  const requiresSnapshot = descriptor.operationClass === "destructive";

  if (sandboxOnly && target && !isSandboxTarget(target)) {
    return {
      target,
      decision: {
        capability,
        riskClass: descriptor.operationClass,
        decision: "deny",
        requiredScopes: REQUIRED_SCOPES_BY_RISK[descriptor.operationClass],
        requiresSnapshot,
        sandboxOnly,
        reasonCode: "target_outside_sandbox"
      }
    };
  }

  return {
    target,
    decision: {
      capability,
      riskClass: descriptor.operationClass,
      decision: "allow",
      requiredScopes: REQUIRED_SCOPES_BY_RISK[descriptor.operationClass],
      requiresSnapshot,
      sandboxOnly
    }
  };
}

export function createPolicyDeniedToolError(
  evaluation: ToolPolicyEvaluation
): EngineMcpToolError {
  return {
    code: "policy_denied",
    message: evaluation.decision.reasonCode ?? "Policy denied the request.",
    details: {
      riskClass: evaluation.decision.riskClass,
      requiredScopes: evaluation.decision.requiredScopes,
      requiresSnapshot: evaluation.decision.requiresSnapshot,
      sandboxOnly: evaluation.decision.sandboxOnly,
      ...(evaluation.target?.logicalName
        ? { targetLogicalName: evaluation.target.logicalName }
        : {}),
      ...(evaluation.target?.assetPath ? { targetAssetPath: evaluation.target.assetPath } : {})
    }
  };
}

function extractPolicyTarget(
  capability: CapabilityName,
  input: unknown
): PolicyTargetDescriptor | undefined {
  if (!isJsonRecord(input)) {
    return undefined;
  }

  const containerKey = capability === "scene.object.create" ? "parent" : "target";
  const targetRecord = isJsonRecord(input[containerKey]) ? input[containerKey] : undefined;

  if (!targetRecord) {
    return undefined;
  }

  return {
    ...(typeof targetRecord.logicalName === "string"
      ? { logicalName: targetRecord.logicalName }
      : {}),
    ...(typeof targetRecord.assetPath === "string" ? { assetPath: targetRecord.assetPath } : {}),
    sandboxed: undefined
  };
}

function isSandboxTarget(target: PolicyTargetDescriptor): boolean {
  if (target.logicalName) {
    return (
      target.logicalName === SANDBOX_LOGICAL_NAME_ROOT ||
      target.logicalName.startsWith(`${SANDBOX_LOGICAL_NAME_ROOT}/`)
    );
  }

  if (target.assetPath) {
    return target.assetPath.startsWith("Assets/MCP_Sandbox/");
  }

  return false;
}
