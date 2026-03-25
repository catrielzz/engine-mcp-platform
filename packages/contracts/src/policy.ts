import type { CapabilityName, OperationRiskClass } from "./types.js";
import type { CoreErrorCode } from "./errors.js";

export const POLICY_SCOPE_VALUES = ["read", "write", "project", "external"] as const;
export const POLICY_DECISION_VALUES = ["allow", "deny"] as const;

export type PolicyScope = (typeof POLICY_SCOPE_VALUES)[number];
export type PolicyDecisionValue = (typeof POLICY_DECISION_VALUES)[number];

export interface PolicyTargetDescriptor {
  logicalName?: string;
  assetPath?: string;
  sandboxed?: boolean;
}

export interface PolicyDecisionRecord {
  capability: CapabilityName;
  riskClass: OperationRiskClass;
  decision: PolicyDecisionValue;
  requiredScopes: readonly PolicyScope[];
  requiresSnapshot: boolean;
  sandboxOnly: boolean;
  reasonCode?: CoreErrorCode;
}
