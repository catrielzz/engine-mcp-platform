import type { CapabilityName, ContractValidationIssue } from "@engine-mcp/contracts";
import type { PolicyDecision } from "@engine-mcp/policy-engine";

import type { UnityLocalBridgeErrorCode } from "./contracts/plugin-contract.js";

export class UnityBridgeValidationError extends Error {
  readonly capability: CapabilityName;
  readonly issues: readonly ContractValidationIssue[];

  constructor(capability: CapabilityName, message: string, issues: readonly ContractValidationIssue[]) {
    super(message);
    this.name = "UnityBridgeValidationError";
    this.capability = capability;
    this.issues = issues;
  }
}

export class UnityBridgePolicyError extends Error {
  readonly capability: CapabilityName;
  readonly decision: PolicyDecision;

  constructor(capability: CapabilityName, decision: PolicyDecision) {
    super(decision.reason ?? `Policy denied ${capability}.`);
    this.name = "UnityBridgePolicyError";
    this.capability = capability;
    this.decision = decision;
  }
}

export class UnityBridgeRemoteError extends Error {
  readonly code: UnityLocalBridgeErrorCode;
  readonly details?: unknown;

  constructor(code: UnityLocalBridgeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "UnityBridgeRemoteError";
    this.code = code;
    this.details = details;
  }
}

export class UnityBridgePluginBootstrapError extends Error {
  readonly bootstrapFilePath?: string;

  constructor(message: string, bootstrapFilePath?: string) {
    super(message);
    this.name = "UnityBridgePluginBootstrapError";
    this.bootstrapFilePath = bootstrapFilePath;
  }
}
