import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import {
  isConformancePassing,
  P0_CONFORMANCE_CASES,
  runConformanceSuite,
  summarizeConformanceReport
} from "@engine-mcp/conformance-runner";
import type { CapabilityName } from "@engine-mcp/contracts";

import {
  createInMemoryTaskMessageQueue,
  createTaskCancellationRegistry,
  createTaskStoreWithCancellationHooks,
  hasTaskMessageQueueCleanup,
  hasTaskStoreCleanup
} from "./tasks.js";
import { uniqueCapabilities } from "./tool-results.js";
import { getVisiblePromptNames } from "./prompts.js";
import {
  DEFAULT_CORE_SERVER_INFO,
  DEFAULT_CORE_SERVER_INSTRUCTIONS,
  DEFAULT_EXPERIMENTAL_TASK_CHILD_REQUEST_TIMEOUT_MS,
  DEFAULT_EXPERIMENTAL_TASK_POLL_INTERVAL_MS,
  DEFAULT_EXPERIMENTAL_TASK_TTL_MS,
  DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS,
  DEFAULT_IN_MEMORY_TASK_MESSAGE_RETENTION_MS,
  EngineMcpConformancePreflightError,
  type EngineMcpAdapterRegistry,
  type EngineMcpAdapterState,
  type EngineMcpAdapterStateResource,
  type EngineMcpAdapterSwitchOptions,
  type EngineMcpCapabilityAdapter,
  type EngineMcpConformancePreflightOptions,
  type EngineMcpConformancePreflightResult,
  type EngineMcpCoreServerOptions,
  type EngineMcpExperimentalTasksOptions,
  type EngineMcpRuntimeAdapterController,
  type ResolvedCoreServerAdapter,
  type ResolvedCoreServerBootstrap,
  type ResolvedExperimentalTasksOptions
} from "../shared.js";

export function createRuntimeAdapterController(options: {
  bootstrap: ResolvedCoreServerBootstrap;
  unityBridge?: EngineMcpCoreServerOptions["unityBridge"];
  onToolListChanged: (adapterState: EngineMcpAdapterState) => Promise<void>;
  onPromptListChanged: (adapterState: EngineMcpAdapterState) => Promise<void>;
  onAdapterStateChanged: (adapterState: EngineMcpAdapterState) => Promise<void>;
}): EngineMcpRuntimeAdapterController {
  const adapterState: EngineMcpAdapterState = {
    adapter: options.bootstrap.adapter,
    adapterName: options.bootstrap.adapterName,
    updatedAt: new Date().toISOString(),
    ...(options.bootstrap.preflight ? { preflight: options.bootstrap.preflight } : {})
  };

  return {
    getAdapter(): EngineMcpCapabilityAdapter {
      return adapterState.adapter;
    },
    getAdapterName(): string | undefined {
      return adapterState.adapterName;
    },
    getPreflight(): EngineMcpConformancePreflightResult | undefined {
      return adapterState.preflight;
    },
    getAdapterStateResource(): EngineMcpAdapterStateResource {
      return createAdapterStateResourcePayload(adapterState, this.availableAdapterNames);
    },
    availableAdapterNames: options.bootstrap.availableAdapterNames,
    notifyToolListChanged(): Promise<void> {
      return options.onToolListChanged(adapterState);
    },
    notifyPromptListChanged(): Promise<void> {
      return options.onPromptListChanged(adapterState);
    },
    async replaceAdapter(
      adapter: EngineMcpCapabilityAdapter,
      adapterSwitchOptions: EngineMcpAdapterSwitchOptions = {}
    ): Promise<void> {
      const previousVisiblePromptNames = getVisiblePromptNames(adapterState.adapter);
      const preflight = await runCoreServerConformancePreflight(
        adapter,
        adapterSwitchOptions.conformancePreflight ?? options.bootstrap.preflightOptions
      );

      adapterState.adapter = adapter;
      adapterState.adapterName = adapterSwitchOptions.adapterName;
      adapterState.preflight = preflight;
      adapterState.updatedAt = new Date().toISOString();

      const nextVisiblePromptNames = getVisiblePromptNames(adapterState.adapter);

      if (!samePromptNameList(previousVisiblePromptNames, nextVisiblePromptNames)) {
        await options.onPromptListChanged(adapterState);
      }

      await options.onAdapterStateChanged(adapterState);
    },
    async selectAdapter(
      adapterName: string,
      adapterSwitchOptions: Omit<EngineMcpAdapterSwitchOptions, "adapterName"> = {}
    ): Promise<void> {
      const adapterRegistry = options.bootstrap.adapterRegistry;

      if (!adapterRegistry) {
        throw new Error("No adapter registry is available for runtime selection.");
      }

      const nextAdapter = await adapterRegistry.resolve(adapterName, {
        unityBridge: options.unityBridge
      });

      await this.replaceAdapter(nextAdapter, {
        adapterName,
        conformancePreflight: adapterSwitchOptions.conformancePreflight
      });
    }
  };
}

function samePromptNameList(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((name, index) => name === right[index]);
}

export async function resolveCoreServerBootstrap(
  options: EngineMcpCoreServerOptions,
  defaultAdapterRegistry: EngineMcpAdapterRegistry
): Promise<ResolvedCoreServerBootstrap> {
  const resolvedAdapter = await resolveCoreServerAdapter(options, defaultAdapterRegistry);
  const preflight = await runCoreServerConformancePreflight(
    resolvedAdapter.adapter,
    options.conformancePreflight
  );
  const experimentalTasks = resolveExperimentalTasksOptions(options.experimentalTasks);

  return {
    adapter: resolvedAdapter.adapter,
    ...(resolvedAdapter.adapterName ? { adapterName: resolvedAdapter.adapterName } : {}),
    availableAdapterNames: resolvedAdapter.availableAdapterNames,
    ...(resolvedAdapter.adapterRegistry ? { adapterRegistry: resolvedAdapter.adapterRegistry } : {}),
    ...(options.conformancePreflight ? { preflightOptions: options.conformancePreflight } : {}),
    ...(experimentalTasks ? { experimentalTasks } : {}),
    serverInfo: options.serverInfo ?? DEFAULT_CORE_SERVER_INFO,
    instructions: options.instructions ?? DEFAULT_CORE_SERVER_INSTRUCTIONS,
    cleanup(): void {
      experimentalTasks?.cleanup();
    },
    ...(preflight ? { preflight } : {})
  };
}

async function resolveCoreServerAdapter(
  options: EngineMcpCoreServerOptions,
  defaultAdapterRegistry: EngineMcpAdapterRegistry
): Promise<ResolvedCoreServerAdapter> {
  if (options.adapter) {
    return {
      adapter: options.adapter,
      adapterName: options.adapterName,
      availableAdapterNames: Object.freeze(
        options.adapterName ? [options.adapterName] : [options.adapter.adapter]
      )
    };
  }

  const adapterRegistry = options.adapterRegistry ?? defaultAdapterRegistry;

  return {
    adapter: await adapterRegistry.resolve(options.adapterName, {
      unityBridge: options.unityBridge
    }),
    adapterName: options.adapterName ?? adapterRegistry.defaultAdapterName,
    availableAdapterNames: adapterRegistry.list(),
    adapterRegistry
  };
}

async function runCoreServerConformancePreflight(
  adapter: EngineMcpCapabilityAdapter,
  options: EngineMcpConformancePreflightOptions | undefined
): Promise<EngineMcpConformancePreflightResult | undefined> {
  if (!options) {
    return undefined;
  }

  const requestedCapabilities = uniqueCapabilities(
    options.requiredCapabilities ??
      options.cases?.map(({ capability }) => capability as CapabilityName) ??
      adapter.capabilities
  );
  const requestedCapabilitySet = new Set(requestedCapabilities);
  const cases = (options.cases ?? P0_CONFORMANCE_CASES).filter(({ capability }) =>
    requestedCapabilitySet.has(capability)
  );
  const report = await runConformanceSuite(adapter, cases, {
    requiredCapabilities: requestedCapabilities
  });
  const result = {
    passed: isConformancePassing(report),
    report
  };

  if (!result.passed && options.enforce !== false) {
    throw new EngineMcpConformancePreflightError(report);
  }

  return result;
}

function resolveExperimentalTasksOptions(
  options: EngineMcpExperimentalTasksOptions | undefined
): ResolvedExperimentalTasksOptions | undefined {
  if (!options?.enabled) {
    return undefined;
  }

  const rawTaskStore = options.taskStore ?? new InMemoryTaskStore();
  const cancellationRegistry = createTaskCancellationRegistry();
  const taskStore = createTaskStoreWithCancellationHooks(rawTaskStore, cancellationRegistry);
  const rawTaskMessageQueue =
    options.taskMessageQueue ??
    createInMemoryTaskMessageQueue({
      maxMessageAgeMs:
        options.taskMessageRetentionMs ?? DEFAULT_IN_MEMORY_TASK_MESSAGE_RETENTION_MS,
      pruneIntervalMs:
        options.taskMessagePruneIntervalMs ?? DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS
    });
  const cleanupTasks = hasTaskStoreCleanup(rawTaskStore)
    ? () => rawTaskStore.cleanup()
    : () => undefined;
  const cleanupTaskMessages = hasTaskMessageQueueCleanup(rawTaskMessageQueue)
    ? () => rawTaskMessageQueue.cleanup()
    : () => undefined;

  return {
    taskStore,
    taskMessageQueue: rawTaskMessageQueue,
    cancellationRegistry,
    defaultTtlMs:
      options.defaultTtlMs === undefined
        ? DEFAULT_EXPERIMENTAL_TASK_TTL_MS
        : options.defaultTtlMs,
    defaultPollIntervalMs:
      options.defaultPollIntervalMs ?? DEFAULT_EXPERIMENTAL_TASK_POLL_INTERVAL_MS,
    maxQueueSize: options.maxQueueSize,
    childRequestTimeoutMs:
      options.childRequestTimeoutMs ?? DEFAULT_EXPERIMENTAL_TASK_CHILD_REQUEST_TIMEOUT_MS,
    modelImmediateResponse: options.modelImmediateResponse,
    samplingPolicy: options.samplingPolicy,
    cleanup(): void {
      cancellationRegistry.clear(new Error("Task store cleanup."));
      cleanupTaskMessages();
      cleanupTasks();
    }
  };
}

function createAdapterStateResourcePayload(
  adapterState: EngineMcpAdapterState,
  availableAdapterNames: readonly string[]
): EngineMcpAdapterStateResource {
  const preflight = adapterState.preflight
    ? {
        enabled: true as const,
        passed: adapterState.preflight.passed,
        summary: summarizeConformanceReport(adapterState.preflight.report),
        passedCases: adapterState.preflight.report.passed,
        failedCases: adapterState.preflight.report.failed,
        skippedCases: adapterState.preflight.report.skipped
      }
    : {
        enabled: false as const
      };

  return {
    selectedAdapter: adapterState.adapterName ?? adapterState.adapter.adapter,
    adapterId: adapterState.adapter.adapter,
    availableAdapters: [...availableAdapterNames],
    capabilities: [...adapterState.adapter.capabilities],
    toolCount: adapterState.adapter.capabilities.length,
    preflight,
    health:
      adapterState.preflight && !adapterState.preflight.passed
        ? {
            status: "degraded" as const,
            reason: "conformance_preflight_failed" as const
          }
        : {
            status: "ready" as const
          },
    updatedAt: adapterState.updatedAt
  };
}
