import {
  getCapabilityDescriptor,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName
} from "@engine-mcp/contracts";
import {
  defaultPolicyEvaluator,
  resolvePolicyDecision,
  type PolicyEvaluator,
  type SessionScope
} from "@engine-mcp/policy-engine";

import {
  UNITY_LOCAL_BRIDGE_CAPABILITIES,
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  createUnityLocalBridgeRequest,
  isUnityLocalBridgeCapability,
  parseUnityLocalBridgeResponse,
  type UnityLocalBridgeCapability,
  type UnityLocalBridgeErrorCode
} from "../contracts/plugin-contract.js";
import {
  UnityBridgePluginBootstrapError,
  UnityBridgePolicyError,
  UnityBridgeRemoteError,
  UnityBridgeValidationError
} from "../errors.js";
import { readUnityPluginSessionBootstrap } from "../bootstrap/plugin-session-bootstrap.js";
import { extractSnapshotId, extractTargetLogicalName } from "../policy/request-targets.js";

export interface UnityBridgePluginProxyOptions {
  bootstrapFilePath?: string;
  sessionScope?: SessionScope;
  policyEvaluator?: PolicyEvaluator;
  fetchFn?: typeof fetch;
}

export class UnityBridgePluginProxyAdapter {
  readonly adapter = "unity-bridge-plugin-proxy";
  readonly capabilities: readonly CapabilityName[] = UNITY_LOCAL_BRIDGE_CAPABILITIES;

  private readonly bootstrapFilePath?: string;
  private readonly sessionScope: SessionScope;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly fetchFn: typeof fetch;
  private requestCounter = 0;

  constructor(options: UnityBridgePluginProxyOptions = {}) {
    this.bootstrapFilePath = options.bootstrapFilePath;
    this.sessionScope = options.sessionScope ?? "inspect";
    this.policyEvaluator = options.policyEvaluator ?? defaultPolicyEvaluator;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async invoke(
    request: { capability: CapabilityName; input: unknown },
    context?: { signal?: AbortSignal }
  ): Promise<unknown> {
    this.assertSupportedCapability(request.capability);
    this.assertValidInput(request.capability, request.input);
    await this.assertPolicyAllowed(request.capability, request.input);

    let bootstrap;

    try {
      bootstrap = await readUnityPluginSessionBootstrap(this.bootstrapFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bootstrap read failure.";
      throw new UnityBridgePluginBootstrapError(
        `Could not read Unity plugin session bootstrap: ${message}`,
        this.bootstrapFilePath
      );
    }

    const requestEnvelope = createUnityLocalBridgeRequest({
      requestId: `plugin-proxy-${String(++this.requestCounter).padStart(4, "0")}`,
      capability: request.capability,
      sessionScope: this.sessionScope,
      payload: request.input
    });
    const response = await this.fetchFn(bootstrap.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: bootstrap.sessionToken
      },
      body: JSON.stringify(requestEnvelope),
      signal: context?.signal
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Unity plugin bridge HTTP call failed with status ${response.status}: ${responseText}`
      );
    }

    const responseEnvelope = parseUnityLocalBridgeResponse(responseText);

    if (!responseEnvelope.success) {
      const remoteError = responseEnvelope.error;

      if (!remoteError) {
        throw new Error("Unity plugin bridge returned an invalid error envelope.");
      }

      throw new UnityBridgeRemoteError(
        remoteError.code,
        remoteError.message,
        remoteError.details
      );
    }

    this.assertValidOutput(request.capability, responseEnvelope.payload);

    return responseEnvelope.payload;
  }

  private assertSupportedCapability(capability: CapabilityName): asserts capability is UnityLocalBridgeCapability {
    if (!isUnityLocalBridgeCapability(capability)) {
      throw new Error(`Capability ${capability} is not implemented by ${this.adapter}.`);
    }
  }

  private assertValidInput(capability: CapabilityName, input: unknown): void {
    const validation = validateCapabilityInput(capability, input);

    if (!validation.valid) {
      throw new UnityBridgeValidationError(
        capability,
        `Invalid ${capability} request for ${this.adapter}.`,
        validation.errors
      );
    }
  }

  private async assertPolicyAllowed(capability: CapabilityName, input: unknown): Promise<void> {
    const descriptor = getCapabilityDescriptor(capability);
    const decision = await resolvePolicyDecision(
      {
        adapter: this.adapter,
        capability,
        operationClass: descriptor.operationClass,
        sessionScope: this.sessionScope,
        input,
        target: extractTargetLogicalName(input),
        snapshotAvailable:
          capability === "scene.object.delete" ||
          (capability === "snapshot.restore" && extractSnapshotId(input) !== undefined)
      },
      this.policyEvaluator
    );

    if (!decision.allowed) {
      throw new UnityBridgePolicyError(capability, decision);
    }
  }

  private assertValidOutput(capability: CapabilityName, output: unknown): void {
    const validation = validateCapabilityOutput(capability, output);

    if (!validation.valid) {
      throw new UnityBridgeValidationError(
        capability,
        `Invalid ${capability} response from ${this.adapter}.`,
        validation.errors
      );
    }
  }
}

export function createUnityBridgePluginProxyAdapter(
  options: UnityBridgePluginProxyOptions = {}
): UnityBridgePluginProxyAdapter {
  return new UnityBridgePluginProxyAdapter(options);
}
