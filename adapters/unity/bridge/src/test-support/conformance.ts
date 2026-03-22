import {
  P0_CONFORMANCE_CASES,
  createReadHeavyConformanceCases,
  runConformanceSuite,
  type ConformanceCase
} from "@engine-mcp/conformance-runner";

import { UNITY_BRIDGE_P0_CAPABILITIES } from "../index.js";
import type { UnityBridgeSandboxTestAdapter } from "./sandbox.js";

export const UNITY_BRIDGE_READ_HEAVY_CAPABILITIES = [
  "asset.search",
  "script.validate",
  "console.read",
  "test.run",
  "test.job.read"
] as const;

export async function runUnityBridgeP0Conformance(adapter: UnityBridgeSandboxTestAdapter): Promise<{
  report: Awaited<ReturnType<typeof runConformanceSuite>>;
  selectedCases: ConformanceCase[];
}> {
  const supportedCapabilities = new Set<string>(UNITY_BRIDGE_P0_CAPABILITIES);
  const selectedCases = P0_CONFORMANCE_CASES.filter(({ capability }) =>
    supportedCapabilities.has(capability)
  );
  const report = await runConformanceSuite(adapter, selectedCases, {
    requiredCapabilities: UNITY_BRIDGE_P0_CAPABILITIES
  });

  return {
    report,
    selectedCases
  };
}

export async function runUnityBridgeReadHeavyConformance(
  adapter: UnityBridgeSandboxTestAdapter
): Promise<{
  report: Awaited<ReturnType<typeof runConformanceSuite>>;
  cases: readonly ConformanceCase[];
}> {
  const seededRun = (await adapter.invoke({
    capability: "test.run",
    input: {
      filter: {
        namePattern: "Sandbox"
      },
      executionTarget: "editor",
      waitForCompletion: false
    }
  })) as { jobId: string };
  const cases = createReadHeavyConformanceCases({
    testJobId: seededRun.jobId
  });
  const report = await runConformanceSuite(adapter, cases, {
    requiredCapabilities: [...UNITY_BRIDGE_READ_HEAVY_CAPABILITIES]
  });

  return {
    report,
    cases
  };
}
