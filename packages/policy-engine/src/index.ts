export type {
  PolicyContext,
  PolicyDecision,
  PolicyDecisionCode,
  PolicyEvaluator,
  SessionScope
} from "./types.js";

export { SESSION_SCOPES } from "./types.js";

export {
  allowPolicy,
  createPolicyContext,
  createStaticPolicyEvaluator,
  defaultPolicyEvaluator,
  denyPolicy,
  evaluateScopePolicy,
  hasScopeForOperationClass,
  requiredScopeForOperationClass,
  resolvePolicyDecision
} from "./core/scope.js";

export type {
  SandboxBoundaryContextResolver,
  SandboxBoundaryPolicyContext,
  SandboxBoundaryReference,
  SandboxPolicyRule,
  TargetOutsideSandboxPolicyDetails
} from "./sandbox/boundary.js";

export {
  SANDBOX_POLICY_RULES,
  TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
  createSandboxBoundaryPolicyEvaluator,
  createTargetOutsideSandboxPolicyDetails,
  denyTargetOutsideSandbox,
  evaluateSandboxBoundaryPolicy
} from "./sandbox/boundary.js";

export type { SnapshotAvailabilityPolicyDetails } from "./rollback/snapshot.js";

export {
  ROLLBACK_UNAVAILABLE_POLICY_REASON,
  SNAPSHOT_REQUIRED_POLICY_REASON,
  createSnapshotAvailabilityPolicyDetails,
  createSnapshotAvailabilityPolicyEvaluator,
  denyRollbackUnavailable,
  denySnapshotRequired,
  evaluateSnapshotAvailabilityPolicy
} from "./rollback/snapshot.js";
