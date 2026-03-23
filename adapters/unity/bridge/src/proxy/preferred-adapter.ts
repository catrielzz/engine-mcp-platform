import type { CapabilityName } from "@engine-mcp/contracts";

import { UnityBridgePluginBootstrapError } from "../errors.js";
import { UnityBridgeSandboxAdapter } from "../fallback/sandbox-adapter.js";
import {
  UNITY_BRIDGE_CAPABILITIES,
  type UnityBridgeAdapterRequest,
  type UnityBridgeSandboxOptions
} from "../fallback/sandbox-model.js";
import {
  UnityBridgePluginProxyAdapter,
  type UnityBridgePluginProxyOptions
} from "./plugin-proxy.js";

export interface UnityBridgePreferredAdapterOptions {
  proxy?: UnityBridgePluginProxyOptions;
  sandbox?: UnityBridgeSandboxOptions;
  fallbackToSandbox?: boolean;
}

export class UnityBridgePreferredAdapter {
  readonly adapter = "unity-bridge-preferred";
  readonly capabilities: readonly CapabilityName[] = UNITY_BRIDGE_CAPABILITIES;

  private readonly proxyAdapter: UnityBridgePluginProxyAdapter;
  private readonly fallbackAdapter: UnityBridgeSandboxAdapter | null;

  constructor(options: UnityBridgePreferredAdapterOptions = {}) {
    this.proxyAdapter = new UnityBridgePluginProxyAdapter(options.proxy);
    this.fallbackAdapter =
      options.fallbackToSandbox === false ? null : new UnityBridgeSandboxAdapter(options.sandbox);
  }

  async invoke(
    request: UnityBridgeAdapterRequest,
    context?: { signal?: AbortSignal }
  ): Promise<unknown> {
    try {
      return await this.proxyAdapter.invoke(request, context);
    } catch (error) {
      if (this.fallbackAdapter && error instanceof UnityBridgePluginBootstrapError) {
        return this.fallbackAdapter.invoke(request, context);
      }

      throw error;
    }
  }
}

export function createUnityBridgePreferredAdapter(
  options: UnityBridgePreferredAdapterOptions = {}
): UnityBridgePreferredAdapter {
  return new UnityBridgePreferredAdapter(options);
}
