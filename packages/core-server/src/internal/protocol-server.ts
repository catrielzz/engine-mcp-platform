import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  UrlElicitationRequiredError,
  type CallToolRequest,
  type Implementation,
  type ServerNotification,
  type ServerRequest
} from "@modelcontextprotocol/sdk/types.js";
import {
  isCapabilityName,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName
} from "@engine-mcp/contracts";

import { isJsonRecord } from "./json.js";
import { createPolicyDeniedToolError, evaluateToolPolicy } from "./policy-engine.js";
import {
  completePromptArgument,
  getRenderedPrompt,
  listRegisteredPrompts
} from "./prompts.js";
import {
  createInvocationContext,
  createInvocationRootsState,
  createInvocationSamplingState,
  resolveModelImmediateResponse
} from "./invocation-context.js";
import {
  createToolDefinition,
  createToolErrorResult,
  createToolSuccessResult,
  normalizeToolError
} from "./tool-results.js";
import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
  MODEL_IMMEDIATE_RESPONSE_META_KEY,
  type EngineMcpAdapterStateResource,
  type EngineMcpCapabilityAdapter,
  type EngineMcpCapabilityInvocationContext,
  type EngineMcpInvocationRootsState,
  type EngineMcpProtocolServerRuntime,
  type EngineMcpRootsChangeState,
  type EngineMcpTaskCancellationRegistry,
  type ResolvedExperimentalTasksOptions
} from "../shared.js";
import {
  isKnownResourceUri,
  listRegisteredResources,
  readRegisteredResource
} from "./adapter-resources.js";

export function createProtocolServer(options: {
  getAdapter: () => EngineMcpCapabilityAdapter;
  getAdapterStateResource: () => EngineMcpAdapterStateResource;
  serverInfo: Implementation;
  instructions: string;
  experimentalTasks?: ResolvedExperimentalTasksOptions;
}): EngineMcpProtocolServerRuntime {
  const resourceSubscriptions = new Set<string>();
  const rootsChangeState: EngineMcpRootsChangeState = {
    version: 0
  };
  const server = new Server(options.serverInfo, {
    capabilities: {
      completions: {},
      logging: {},
      prompts: {
        listChanged: true
      },
      resources: {
        subscribe: true
      },
      ...(options.experimentalTasks
        ? {
            tasks: {
              list: {},
              cancel: {},
              requests: {
                tools: {
                  call: {}
                }
              }
            }
          }
        : {}),
      tools: {
        listChanged: true
      }
    },
    instructions: options.instructions,
    ...(options.experimentalTasks
      ? {
          taskStore: options.experimentalTasks.taskStore,
          taskMessageQueue: options.experimentalTasks.taskMessageQueue,
          defaultTaskPollInterval: options.experimentalTasks.defaultPollIntervalMs,
          maxTaskQueueSize: options.experimentalTasks.maxQueueSize
        }
      : {}),
    debouncedNotificationMethods: [
      "notifications/tools/list_changed",
      "notifications/prompts/list_changed"
    ]
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: options.getAdapter().capabilities.map((capability) =>
      createToolDefinition(
        capability,
        options.getAdapter().adapter,
        options.experimentalTasks ? "optional" : "forbidden"
      )
    )
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listRegisteredPrompts(options.getAdapter())
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) =>
    getRenderedPrompt(
      request.params.name,
      request.params.arguments,
      options.getAdapter()
    )
  );

  server.setRequestHandler(CompleteRequestSchema, async (request, extra) =>
    completePromptArgument(server, extra, options.getAdapter(), request.params)
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listRegisteredResources(options.getAdapter())
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    readRegisteredResource({
      uri: request.params.uri,
      adapter: options.getAdapter(),
      getAdapterStateResource: options.getAdapterStateResource
    })
  );

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    if (!(await isKnownResourceUri(options.getAdapter(), request.params.uri))) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${request.params.uri}`);
    }

    resourceSubscriptions.add(request.params.uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    if (!(await isKnownResourceUri(options.getAdapter(), request.params.uri))) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${request.params.uri}`);
    }

    resourceSubscriptions.delete(request.params.uri);
    return {};
  });

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    rootsChangeState.version += 1;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    handleToolCall(
      server,
      options.getAdapter(),
      request.params,
      extra,
      options.experimentalTasks,
      createInvocationRootsState(rootsChangeState)
    )
  );

  return {
    server,
    sendToolListChanged(): Promise<void> {
      return server.sendToolListChanged();
    },
    sendPromptListChanged(): Promise<void> {
      return server.sendPromptListChanged();
    },
    sendAdapterStateUpdated(): Promise<void> {
      if (!resourceSubscriptions.has(CORE_SERVER_ADAPTER_STATE_RESOURCE_URI)) {
        return Promise.resolve();
      }

      return server.sendResourceUpdated({
        uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
      });
    }
  };
}

async function handleToolCall(
  server: Server,
  adapter: EngineMcpCapabilityAdapter,
  params: CallToolRequest["params"],
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  experimentalTasks?: ResolvedExperimentalTasksOptions,
  rootsState?: EngineMcpInvocationRootsState
): Promise<
  | {
      task: {
        taskId: string;
        status: string;
        createdAt: string;
        lastUpdatedAt: string;
        ttl: number | null;
        pollInterval?: number;
        statusMessage?: string;
      };
      _meta?: Record<string, unknown>;
    }
  | {
      _meta: Record<string, unknown>;
      content: Array<{
        type: "text";
        text: string;
      }>;
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }
> {
  if (params.task) {
    return handleTaskAugmentedToolCall(server, adapter, params, extra, experimentalTasks, rootsState);
  }

  return executeInlineToolCall(server, adapter, params.name, params.arguments ?? {}, extra, rootsState);
}

async function handleTaskAugmentedToolCall(
  server: Server,
  adapter: EngineMcpCapabilityAdapter,
  params: CallToolRequest["params"],
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  experimentalTasks: ResolvedExperimentalTasksOptions | undefined,
  rootsState?: EngineMcpInvocationRootsState
): Promise<{
  task: {
    taskId: string;
    status: string;
    createdAt: string;
    lastUpdatedAt: string;
    ttl: number | null;
    pollInterval?: number;
    statusMessage?: string;
  };
  _meta?: Record<string, unknown>;
}> {
  const toolName = params.name;

  if (!experimentalTasks || !extra.taskStore) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      "Task-augmented tools/call is not enabled for this server."
    );
  }

  if (!isCapabilityName(toolName)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown canonical capability: ${toolName}.`);
  }

  if (!adapter.capabilities.includes(toolName)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${adapter.adapter} does not implement ${toolName}.`
    );
  }

  const input = params.arguments ?? {};
  const inputValidation = validateCapabilityInput(toolName, input);

  if (!inputValidation.valid) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid ${toolName} input.`, {
      issues: inputValidation.errors
    });
  }

  const requestedTaskTtl = params.task?.ttl ?? experimentalTasks.defaultTtlMs ?? null;
  const task = await extra.taskStore.createTask({
    ttl: requestedTaskTtl,
    pollInterval: experimentalTasks.defaultPollIntervalMs
  });

  if (
    requestedTaskTtl !== null &&
    (!Number.isFinite(task.ttl) || task.ttl === null || task.ttl <= 0)
  ) {
    throw new McpError(
      ErrorCode.InternalError,
      "Task store contract violation: bounded tasks must report a bounded ttl.",
      {
        requestedTtl: requestedTaskTtl,
        actualTtl: task.ttl
      }
    );
  }

  const cancellationSignal = experimentalTasks.cancellationRegistry.register(task.taskId);
  const samplingState = createInvocationSamplingState();

  void executeTaskAugmentedToolCall({
    adapter,
    capability: toolName,
    input,
    invocationContext: createInvocationContext(server, extra, {
      cancellationSignal,
      relatedTaskId: task.taskId,
      childRequestTimeoutMs: experimentalTasks.childRequestTimeoutMs,
      rootsState,
      samplingState,
      samplingPolicy: experimentalTasks.samplingPolicy
    }),
    taskId: task.taskId,
    taskStore: extra.taskStore,
    cancellationRegistry: experimentalTasks.cancellationRegistry
  });

  const modelImmediateResponse = resolveModelImmediateResponse(
    experimentalTasks.modelImmediateResponse,
    {
      capability: toolName,
      adapterId: adapter.adapter,
      input,
      taskId: task.taskId,
      requestId: extra.requestId,
      ...(extra.sessionId ? { sessionId: extra.sessionId } : {})
    }
  );

  return {
    task,
    ...(modelImmediateResponse !== undefined
      ? {
          _meta: {
            [MODEL_IMMEDIATE_RESPONSE_META_KEY]: modelImmediateResponse
          }
        }
      : {})
  };
}

async function executeInlineToolCall(
  server: Server,
  adapter: EngineMcpCapabilityAdapter,
  toolName: string,
  input: unknown,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  rootsState?: EngineMcpInvocationRootsState
): Promise<{
  _meta: Record<string, unknown>;
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}> {
  const samplingState = createInvocationSamplingState();

  if (!isCapabilityName(toolName)) {
    return createToolErrorResult(toolName, {
      code: "capability_unsupported",
      message: `Unknown canonical capability: ${toolName}.`
    });
  }

  if (!adapter.capabilities.includes(toolName)) {
    return createToolErrorResult(toolName, {
      code: "capability_unsupported",
      message: `${adapter.adapter} does not implement ${toolName}.`
    });
  }

  const inputValidation = validateCapabilityInput(toolName, input);

  if (!inputValidation.valid) {
    return createToolErrorResult(toolName, {
      code: "validation_error",
      message: `Invalid ${toolName} input.`,
      details: {
        issues: inputValidation.errors
      }
    });
  }

  const policyEvaluation = evaluateToolPolicy(toolName, input);

  if (policyEvaluation.decision.decision === "deny") {
    return createToolErrorResult(toolName, createPolicyDeniedToolError(policyEvaluation));
  }

  let output: unknown;

  try {
    output = await adapter.invoke({
      capability: toolName,
      input,
      context: createInvocationContext(server, extra, {
        rootsState,
        samplingState
      })
    });
  } catch (error) {
    if (error instanceof UrlElicitationRequiredError) {
      throw error;
    }

    return createToolErrorResult(toolName, normalizeToolError(error));
  }

  const outputValidation = validateCapabilityOutput(toolName, output);

  if (!outputValidation.valid) {
    return createToolErrorResult(toolName, {
      code: "adapter_output_invalid",
      message: `Adapter returned an invalid ${toolName} payload.`,
      details: {
        issues: outputValidation.errors
      }
    });
  }

  if (!isJsonRecord(output)) {
    return createToolErrorResult(toolName, {
      code: "adapter_output_invalid",
      message: `Adapter returned a non-object ${toolName} payload.`,
      details: {
        receivedType: typeof output
      }
    });
  }

  return createToolSuccessResult(toolName, adapter.adapter, output);
}

async function executeTaskAugmentedToolCall(options: {
  adapter: EngineMcpCapabilityAdapter;
  capability: CapabilityName;
  input: unknown;
  invocationContext: EngineMcpCapabilityInvocationContext;
  taskId: string;
  cancellationRegistry: EngineMcpTaskCancellationRegistry;
  taskStore: NonNullable<RequestHandlerExtra<ServerRequest, ServerNotification>["taskStore"]>;
}): Promise<void> {
  let result:
    | ReturnType<typeof createToolSuccessResult>
    | ReturnType<typeof createToolErrorResult>;
  let status: "completed" | "failed" = "completed";

  try {
    const output = await options.adapter.invoke({
      capability: options.capability,
      input: options.input,
      context: options.invocationContext
    });
    const outputValidation = validateCapabilityOutput(options.capability, output);

    if (!outputValidation.valid) {
      result = createToolErrorResult(options.capability, {
        code: "adapter_output_invalid",
        message: `Adapter returned an invalid ${options.capability} payload.`,
        details: {
          issues: outputValidation.errors
        }
      });
      status = "failed";
    } else if (!isJsonRecord(output)) {
      result = createToolErrorResult(options.capability, {
        code: "adapter_output_invalid",
        message: `Adapter returned a non-object ${options.capability} payload.`,
        details: {
          receivedType: typeof output
        }
      });
      status = "failed";
    } else {
      result = createToolSuccessResult(options.capability, options.adapter.adapter, output);
    }
  } catch (error) {
    result = createToolErrorResult(options.capability, normalizeToolError(error));
    status = "failed";
  }

  const currentTask = await options.taskStore.getTask(options.taskId).catch(() => null);

  if (!currentTask || currentTask.status === "cancelled") {
    options.cancellationRegistry.delete(options.taskId);
    return;
  }

  await options.taskStore.storeTaskResult(options.taskId, status, result).catch(() => undefined);
  options.cancellationRegistry.delete(options.taskId);
}
