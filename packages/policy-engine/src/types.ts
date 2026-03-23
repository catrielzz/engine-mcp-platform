import type { CapabilityName, OperationClass } from "@engine-mcp/contracts";

export const SESSION_SCOPES = [
  "inspect",
  "sandbox_write",
  "project_write",
  "dangerous_write"
] as const;

export type SessionScope = (typeof SESSION_SCOPES)[number];
export type PolicyDecisionCode = "scope_missing" | "policy_denied";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  code?: PolicyDecisionCode;
  details?: unknown;
}

export interface PolicyContext {
  adapter: string;
  capability: CapabilityName;
  operationClass: OperationClass;
  sessionScope: SessionScope;
  input: unknown;
  target?: string;
  snapshotAvailable?: boolean;
}

export type PolicyEvaluator = (context: PolicyContext) => PolicyDecision | Promise<PolicyDecision>;
