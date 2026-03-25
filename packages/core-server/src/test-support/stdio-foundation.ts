import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import type {
  EngineMcpAdapterRegistry,
  EngineMcpCapabilityAdapter,
  EngineMcpJournalService,
  EngineMcpStdioServerOptions
} from "../index.js";

import { createHarness, expectResultMessage, type StdioHarness } from "./stdio.js";

export async function createInitializedHarness(
  openHarnesses: StdioHarness[],
  options: {
    adapter?: EngineMcpCapabilityAdapter;
    adapterRegistry?: EngineMcpAdapterRegistry;
    adapterName?: string;
    clientCapabilities?: Record<string, unknown>;
    conformancePreflight?: EngineMcpStdioServerOptions["conformancePreflight"];
    experimentalTasks?: EngineMcpStdioServerOptions["experimentalTasks"];
    journalService?: EngineMcpJournalService;
    unityBridge?: EngineMcpStdioServerOptions["unityBridge"];
  } = {}
): Promise<{
  harness: StdioHarness;
  initializeResponse: JSONRPCMessage;
}> {
  const harness = await createHarness(options);
  openHarnesses.push(harness);

  return {
    harness,
    initializeResponse: await harness.initialize()
  };
}

export async function requestResult<T>(
  harness: StdioHarness,
  method: string,
  params?: Record<string, unknown>
): Promise<{
  result: T;
}> {
  return expectResultMessage<T>(await harness.request(method, params));
}
