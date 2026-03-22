import { getCapabilityDescriptor, type CapabilityName, type OperationClass } from "@engine-mcp/contracts";

import type {
  PolicyContext,
  PolicyDecision,
  PolicyDecisionCode,
  PolicyEvaluator,
  SessionScope
} from "../types.js";

const SESSION_SCOPE_RANK: Record<SessionScope, number> = {
  inspect: 0,
  sandbox_write: 1,
  project_write: 2,
  dangerous_write: 3
};

const MINIMUM_SCOPE_BY_OPERATION_CLASS: Record<OperationClass, SessionScope> = {
  read: "inspect",
  write_safe: "sandbox_write",
  write_project: "project_write",
  destructive: "dangerous_write",
  external: "dangerous_write"
};

export function requiredScopeForOperationClass(operationClass: OperationClass): SessionScope {
  return MINIMUM_SCOPE_BY_OPERATION_CLASS[operationClass];
}

export function hasScopeForOperationClass(
  sessionScope: SessionScope,
  operationClass: OperationClass
): boolean {
  return (
    SESSION_SCOPE_RANK[sessionScope] >=
    SESSION_SCOPE_RANK[requiredScopeForOperationClass(operationClass)]
  );
}

export function allowPolicy(reason?: string): PolicyDecision {
  return {
    allowed: true,
    reason
  };
}

export function denyPolicy(
  reason: string,
  code: PolicyDecisionCode = "policy_denied"
): PolicyDecision {
  return {
    allowed: false,
    reason,
    code
  };
}

export function evaluateScopePolicy(context: PolicyContext): PolicyDecision {
  const requiredScope = requiredScopeForOperationClass(context.operationClass);

  if (!hasScopeForOperationClass(context.sessionScope, context.operationClass)) {
    return denyPolicy(
      `${context.capability} requires session scope ${requiredScope}.`,
      "scope_missing"
    );
  }

  return allowPolicy();
}

export const defaultPolicyEvaluator: PolicyEvaluator = evaluateScopePolicy;

export async function resolvePolicyDecision(
  context: PolicyContext,
  evaluator: PolicyEvaluator = defaultPolicyEvaluator
): Promise<PolicyDecision> {
  return evaluator(context);
}

export function createPolicyContext(
  adapter: string,
  capability: CapabilityName,
  sessionScope: SessionScope,
  input: unknown,
  extras: Pick<PolicyContext, "target" | "snapshotAvailable"> = {}
): PolicyContext {
  const descriptor = getCapabilityDescriptor(capability);

  return {
    adapter,
    capability,
    operationClass: descriptor.operationClass,
    sessionScope,
    input,
    target: extras.target,
    snapshotAvailable: extras.snapshotAvailable
  };
}

export function createStaticPolicyEvaluator(decision: PolicyDecision): PolicyEvaluator {
  return async () => decision;
}
