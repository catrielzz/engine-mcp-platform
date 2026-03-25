import {
  ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
  ENGINE_SNAPSHOT_INDEX_RESOURCE_URI,
  ENGINE_TEST_CATALOG_RESOURCE_URI,
  type EngineSnapshotIndexResource,
  type EngineTestCatalogResource,
  getCapabilityDescriptor,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName,
  type PromptArgumentCompletionProvider
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
  createUnityLocalBridgeResourceReadRequest,
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
import { UNITY_BRIDGE_PROMPT_PACK } from "../prompts/prompt-pack.js";
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
  readonly prompts = UNITY_BRIDGE_PROMPT_PACK;

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

    const bootstrap = await this.readBootstrapOrThrow();

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

  listResources(): Array<{
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
  }> {
    const resources = [];

    if (this.capabilities.includes("snapshot.restore")) {
      resources.push({
        uri: ENGINE_SNAPSHOT_INDEX_RESOURCE_URI,
        name: "snapshot-index",
        title: "Snapshot Index",
        description: "Recent snapshot identifiers available to the active engine adapter.",
        mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
      });
    }

    if (this.capabilities.includes("test.job.read")) {
      resources.push({
        uri: ENGINE_TEST_CATALOG_RESOURCE_URI,
        name: "test-catalog",
        title: "Test Catalog",
        description: "Test identifiers exposed by the active engine adapter.",
        mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE
      });
    }

    return resources;
  }

  async readResource(uri: string): Promise<{ uri: string; mimeType: string; text: string } | undefined> {
    const bootstrap = await this.readBootstrapOrThrow();
    const liveResource = await this.tryReadLiveDiscoveryResource(bootstrap.endpointUrl, bootstrap.sessionToken, uri);

    if (liveResource) {
      return liveResource;
    }

    if (uri === ENGINE_SNAPSHOT_INDEX_RESOURCE_URI) {
      return createEmptySnapshotIndexResource(uri, this.adapter);
    }

    if (uri === ENGINE_TEST_CATALOG_RESOURCE_URI) {
      return createEmptyTestCatalogResource(uri, this.adapter);
    }

    return undefined;
  }

  async completePromptArgument(_request: {
    promptName: string;
    argumentName: string;
    provider: PromptArgumentCompletionProvider;
    value: string;
  }): Promise<string[]> {
    const bootstrap = await this.readBootstrapOrThrow();

    switch (_request.provider) {
      case "engine.snapshot_id": {
        const liveResource = await this.tryReadLiveDiscoveryResource(
          bootstrap.endpointUrl,
          bootstrap.sessionToken,
          ENGINE_SNAPSHOT_INDEX_RESOURCE_URI
        );

        return this.parseDiscoveryValues(liveResource?.text, "snapshots") ?? [];
      }
      case "engine.test_name": {
        const liveResource = await this.tryReadLiveDiscoveryResource(
          bootstrap.endpointUrl,
          bootstrap.sessionToken,
          ENGINE_TEST_CATALOG_RESOURCE_URI
        );

        return this.parseDiscoveryValues(liveResource?.text, "tests") ?? [];
      }
      default:
        return [];
    }
  }

  private async readBootstrapOrThrow() {
    try {
      return await readUnityPluginSessionBootstrap(this.bootstrapFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bootstrap read failure.";
      throw new UnityBridgePluginBootstrapError(
        `Could not read Unity plugin session bootstrap: ${message}`,
        this.bootstrapFilePath
      );
    }
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

  private async tryReadLiveDiscoveryResource(
    endpointUrl: string,
    sessionToken: string,
    uri: string
  ): Promise<{ uri: string; mimeType: string; text: string } | undefined> {
    try {
      const requestEnvelope = createUnityLocalBridgeResourceReadRequest({
        requestId: `plugin-proxy-resource-${String(++this.requestCounter).padStart(4, "0")}`,
        sessionScope: this.sessionScope,
        uri
      });
      const response = await this.fetchFn(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: sessionToken
        },
        body: JSON.stringify(requestEnvelope)
      });
      const responseText = await response.text();

      if (!response.ok) {
        return undefined;
      }

      const responseEnvelope = parseUnityLocalBridgeResponse(responseText);

      if (!responseEnvelope.success) {
        if (this.isCompatibleDiscoveryFallbackError(responseEnvelope.error?.code)) {
          return undefined;
        }

        const remoteError = responseEnvelope.error;

        if (!remoteError) {
          return undefined;
        }

        throw new UnityBridgeRemoteError(
          remoteError.code,
          remoteError.message,
          remoteError.details
        );
      }

      return parseBridgeResourcePayload(responseEnvelope.payload);
    } catch (error) {
      if (
        error instanceof UnityBridgeRemoteError &&
        !this.isCompatibleDiscoveryFallbackError(error.code)
      ) {
        throw error;
      }

      return undefined;
    }
  }

  private isCompatibleDiscoveryFallbackError(code: UnityLocalBridgeErrorCode | undefined): boolean {
    return code === undefined || code === "validation_error" || code === "target_not_found" || code === "bridge_transport_error";
  }

  private parseDiscoveryValues(
    resourceText: string | undefined,
    fieldName: "snapshots" | "tests"
  ): string[] | undefined {
    if (!resourceText) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(resourceText) as Record<string, unknown>;
      const values = parsed[fieldName];

      if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
        return undefined;
      }

      return [...values].sort() as string[];
    } catch {
      return undefined;
    }
  }
}

export function createUnityBridgePluginProxyAdapter(
  options: UnityBridgePluginProxyOptions = {}
): UnityBridgePluginProxyAdapter {
  return new UnityBridgePluginProxyAdapter(options);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBridgeResourcePayload(
  payload: unknown
): { uri: string; mimeType: string; text: string } | undefined {
  if (!isJsonRecord(payload)) {
    return undefined;
  }

  if (
    typeof payload.uri !== "string" ||
    typeof payload.mimeType !== "string" ||
    typeof payload.text !== "string"
  ) {
    return undefined;
  }

  return {
    uri: payload.uri,
    mimeType: payload.mimeType,
    text: payload.text
  };
}

function createEmptySnapshotIndexResource(uri: string, adapterId: string): {
  uri: string;
  mimeType: string;
  text: string;
} {
  const payload: EngineSnapshotIndexResource = {
    adapterId,
    snapshots: []
  };

  return {
    uri,
    mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
    text: JSON.stringify(payload, null, 2)
  };
}

function createEmptyTestCatalogResource(uri: string, adapterId: string): {
  uri: string;
  mimeType: string;
  text: string;
} {
  const payload: EngineTestCatalogResource = {
    adapterId,
    tests: []
  };

  return {
    uri,
    mimeType: ENGINE_DISCOVERY_RESOURCE_MIME_TYPE,
    text: JSON.stringify(payload, null, 2)
  };
}
