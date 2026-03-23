import { allowPolicy, defaultPolicyEvaluator } from "../core/scope.js";
import type { PolicyContext, PolicyDecision, PolicyEvaluator } from "../types.js";

export const TARGET_OUTSIDE_SANDBOX_POLICY_REASON = "target_outside_sandbox";
export const SANDBOX_POLICY_RULES = [
  "scene_path",
  "object_namespace",
  "sandbox_root_immutable"
] as const;

export type SandboxPolicyRule = (typeof SANDBOX_POLICY_RULES)[number];

export interface TargetOutsideSandboxPolicyDetails {
  rule: SandboxPolicyRule;
  targetLogicalName?: string;
  targetDisplayName?: string;
  scenePath?: string;
  expectedScenePath?: string;
}

export interface SandboxBoundaryReference {
  logicalName?: string;
  displayName?: string;
  scenePath?: string;
  allowSandboxRoot?: boolean;
}

export interface SandboxBoundaryPolicyContext {
  expectedScenePath?: string;
  scenePath?: string;
  sandboxRootLogicalName: string;
  sandboxRootDisplayName?: string;
  sandboxObjectNamePrefix: string;
  references: readonly SandboxBoundaryReference[];
}

export type SandboxBoundaryContextResolver = (
  context: PolicyContext
) => SandboxBoundaryPolicyContext | undefined;

export function createTargetOutsideSandboxPolicyDetails(
  details: TargetOutsideSandboxPolicyDetails
): TargetOutsideSandboxPolicyDetails {
  return {
    rule: details.rule,
    ...(details.targetLogicalName ? { targetLogicalName: details.targetLogicalName } : {}),
    ...(details.targetDisplayName ? { targetDisplayName: details.targetDisplayName } : {}),
    ...(details.scenePath ? { scenePath: details.scenePath } : {}),
    ...(details.expectedScenePath ? { expectedScenePath: details.expectedScenePath } : {})
  };
}

export function denyTargetOutsideSandbox(
  details: TargetOutsideSandboxPolicyDetails
): PolicyDecision {
  return {
    allowed: false,
    code: "policy_denied",
    reason: TARGET_OUTSIDE_SANDBOX_POLICY_REASON,
    details: createTargetOutsideSandboxPolicyDetails(details)
  };
}

export function evaluateSandboxBoundaryPolicy(
  context: SandboxBoundaryPolicyContext
): PolicyDecision {
  const expectedScenePath = normalizeOptionalString(context.expectedScenePath);
  const references = context.references.filter((reference) => hasSandboxReference(reference));

  if (expectedScenePath) {
    for (const reference of references) {
      const scenePath =
        normalizeOptionalString(reference.scenePath) ?? normalizeOptionalString(context.scenePath);

      if (scenePath && scenePath !== expectedScenePath) {
        return denyTargetOutsideSandbox({
          rule: "scene_path",
          targetLogicalName: reference.logicalName,
          targetDisplayName: reference.displayName,
          scenePath,
          expectedScenePath
        });
      }
    }

    const scenePath = normalizeOptionalString(context.scenePath);

    if (scenePath && scenePath !== expectedScenePath) {
      return denyTargetOutsideSandbox({
        rule: "scene_path",
        scenePath,
        expectedScenePath
      });
    }
  }

  const sandboxRootDisplayName =
    normalizeOptionalString(context.sandboxRootDisplayName) ?? context.sandboxRootLogicalName;

  for (const reference of references) {
    const logicalName = normalizeOptionalString(reference.logicalName);
    const displayName = normalizeOptionalString(reference.displayName);

    if (logicalName === context.sandboxRootLogicalName || displayName === sandboxRootDisplayName) {
      if (reference.allowSandboxRoot) {
        continue;
      }

      return denyTargetOutsideSandbox({
        rule: "sandbox_root_immutable",
        ...(logicalName ? { targetLogicalName: logicalName } : {}),
        ...(displayName ? { targetDisplayName: displayName } : {}),
        ...(expectedScenePath ? { expectedScenePath } : {})
      });
    }

    if (logicalName && !isAllowedSandboxLogicalName(logicalName, context)) {
      return denyTargetOutsideSandbox({
        rule: "object_namespace",
        targetLogicalName: logicalName,
        ...(displayName ? { targetDisplayName: displayName } : {}),
        ...(expectedScenePath ? { expectedScenePath } : {})
      });
    }

    if (
      !logicalName &&
      displayName &&
      !isAllowedSandboxDisplayName(displayName, sandboxRootDisplayName, context)
    ) {
      return denyTargetOutsideSandbox({
        rule: "object_namespace",
        targetDisplayName: displayName,
        ...(expectedScenePath ? { expectedScenePath } : {})
      });
    }
  }

  return allowPolicy();
}

export function createSandboxBoundaryPolicyEvaluator(
  resolveBoundaryContext: SandboxBoundaryContextResolver,
  baseEvaluator: PolicyEvaluator = defaultPolicyEvaluator
): PolicyEvaluator {
  return async (context) => {
    const baseDecision = await baseEvaluator(context);

    if (!baseDecision.allowed) {
      return baseDecision;
    }

    const boundaryContext = resolveBoundaryContext(context);

    if (!boundaryContext) {
      return baseDecision;
    }

    const boundaryDecision = evaluateSandboxBoundaryPolicy(boundaryContext);

    return boundaryDecision.allowed ? baseDecision : boundaryDecision;
  };
}

function hasSandboxReference(reference: SandboxBoundaryReference): boolean {
  return (
    normalizeOptionalString(reference.logicalName) !== undefined ||
    normalizeOptionalString(reference.displayName) !== undefined ||
    normalizeOptionalString(reference.scenePath) !== undefined
  );
}

function isAllowedSandboxLogicalName(
  logicalName: string,
  context: Pick<SandboxBoundaryPolicyContext, "sandboxRootLogicalName" | "sandboxObjectNamePrefix">
): boolean {
  const segments = logicalName
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  if (segments[0] === context.sandboxRootLogicalName) {
    return (
      segments.length === 1 ||
      segments.slice(1).every((segment) => segment.startsWith(context.sandboxObjectNamePrefix))
    );
  }

  return segments.every((segment) => segment.startsWith(context.sandboxObjectNamePrefix));
}

function isAllowedSandboxDisplayName(
  displayName: string,
  sandboxRootDisplayName: string,
  context: Pick<SandboxBoundaryPolicyContext, "sandboxObjectNamePrefix">
): boolean {
  return (
    displayName === sandboxRootDisplayName ||
    displayName.startsWith(context.sandboxObjectNamePrefix)
  );
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
