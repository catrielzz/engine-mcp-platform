import type { CapabilityName } from "@engine-mcp/contracts";

import { allowPolicy, defaultPolicyEvaluator } from "../core/scope.js";
import type { PolicyContext, PolicyDecision, PolicyEvaluator } from "../types.js";

export const SNAPSHOT_REQUIRED_POLICY_REASON = "snapshot_required";
export const ROLLBACK_UNAVAILABLE_POLICY_REASON = "rollback_unavailable";

export interface SnapshotAvailabilityPolicyDetails {
  capability: CapabilityName;
  targetLogicalName?: string;
  snapshotId?: string;
}

export function createSnapshotAvailabilityPolicyDetails(
  context: Pick<PolicyContext, "capability" | "target" | "input">
): SnapshotAvailabilityPolicyDetails {
  const snapshotId = extractSnapshotId(context.input);

  return {
    capability: context.capability,
    ...(context.target ? { targetLogicalName: context.target } : {}),
    ...(snapshotId ? { snapshotId } : {})
  };
}

export function denySnapshotRequired(
  details: SnapshotAvailabilityPolicyDetails
): PolicyDecision {
  return {
    allowed: false,
    code: "policy_denied",
    reason: SNAPSHOT_REQUIRED_POLICY_REASON,
    details
  };
}

export function denyRollbackUnavailable(
  details: SnapshotAvailabilityPolicyDetails
): PolicyDecision {
  return {
    allowed: false,
    code: "policy_denied",
    reason: ROLLBACK_UNAVAILABLE_POLICY_REASON,
    details
  };
}

export function evaluateSnapshotAvailabilityPolicy(context: PolicyContext): PolicyDecision {
  if (context.capability === "snapshot.restore") {
    if (context.snapshotAvailable) {
      return allowPolicy();
    }

    return denyRollbackUnavailable(createSnapshotAvailabilityPolicyDetails(context));
  }

  if (context.operationClass === "destructive" && !context.snapshotAvailable) {
    return denySnapshotRequired(createSnapshotAvailabilityPolicyDetails(context));
  }

  return allowPolicy();
}

export function createSnapshotAvailabilityPolicyEvaluator(
  baseEvaluator: PolicyEvaluator = defaultPolicyEvaluator
): PolicyEvaluator {
  return async (context) => {
    const baseDecision = await baseEvaluator(context);

    if (!baseDecision.allowed) {
      return baseDecision;
    }

    const snapshotDecision = evaluateSnapshotAvailabilityPolicy(context);

    return snapshotDecision.allowed ? baseDecision : snapshotDecision;
  };
}

function extractSnapshotId(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  if ("snapshotId" in input && typeof input.snapshotId === "string") {
    const trimmed = input.snapshotId.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}
