import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ErrorCode, McpError, type ServerNotification, type ServerRequest } from "@modelcontextprotocol/sdk/types.js";

import { isJsonRecord } from "./json.js";
import type {
  EngineMcpCapabilityInvocationContext,
  EngineMcpCoreRequestExtra,
  EngineMcpInvocationRootsState,
  EngineMcpInvocationSamplingState,
  EngineMcpModelImmediateResponseContext,
  EngineMcpModelImmediateResponseResolver,
  EngineMcpRelatedRequest,
  EngineMcpRelatedRequestOptions,
  EngineMcpRelatedRequestResultSchema,
  EngineMcpRootsChangeState,
  EngineMcpRootsListResult,
  EngineMcpSamplingPolicyOptions
} from "../shared.js";

export function createInvocationRootsState(
  changeState: EngineMcpRootsChangeState
): EngineMcpInvocationRootsState {
  return {
    changeState
  };
}

export function createInvocationSamplingState(): EngineMcpInvocationSamplingState {
  return {
    turnCount: 0
  };
}

export function createInvocationContext(
  server: Server,
  extra: RequestHandlerExtra<
    ServerRequest,
    ServerNotification
  >,
  options: {
    cancellationSignal?: AbortSignal;
    relatedTaskId?: string;
    childRequestTimeoutMs?: number;
    rootsState?: EngineMcpInvocationRootsState;
    samplingState?: EngineMcpInvocationSamplingState;
    samplingPolicy?: EngineMcpSamplingPolicyOptions;
  } = {}
): EngineMcpCapabilityInvocationContext {
  const progressToken = extra._meta?.progressToken;
  const cancellationSignal = options.cancellationSignal;
  const relatedTaskId = options.relatedTaskId;
  const childRequestTimeoutMs = options.childRequestTimeoutMs;
  const rootsState = options.rootsState;
  const samplingState = options.samplingState;
  const samplingPolicy = options.samplingPolicy;

  return {
    requestId: extra.requestId,
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(progressToken !== undefined ? { progressToken } : {}),
    ...(cancellationSignal ? { cancellationSignal } : {}),
    isCancellationRequested(): boolean {
      return cancellationSignal?.aborted ?? false;
    },
    throwIfCancelled(): void {
      cancellationSignal?.throwIfAborted();
    },
    async sendProgress(update): Promise<void> {
      if (progressToken === undefined) {
        return;
      }

      await extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: update.progress,
          ...(update.total !== undefined ? { total: update.total } : {}),
          ...(update.message !== undefined ? { message: update.message } : {})
        }
      });
    },
    async sendNotification(notification): Promise<void> {
      try {
        await server.notification(notification, {
          relatedRequestId: extra.requestId,
          ...(relatedTaskId
            ? {
                relatedTask: {
                  taskId: relatedTaskId
                }
              }
            : {})
        });
      } catch (error) {
        throw normalizeTaskSideQueueError(error, notification.method, relatedTaskId);
      }
    },
    async sendRequest<TResult = unknown>(
      request: EngineMcpRelatedRequest,
      resultSchema: EngineMcpRelatedRequestResultSchema,
      requestOptions?: EngineMcpRelatedRequestOptions
    ): Promise<TResult> {
      if (request.method === "roots/list") {
        const cachedRoots = readCachedRootsListResult(rootsState);

        if (cachedRoots) {
          return cachedRoots as TResult;
        }
      }

      const policyAdjustedRequest =
        request.method === "sampling/createMessage"
          ? applySamplingRequestPolicy(request, samplingState, samplingPolicy)
          : request;

      if (relatedTaskId && extra.taskStore) {
        await extra.taskStore.updateTaskStatus(relatedTaskId, "input_required");
      }

      assertSupportedClientRequest(server, policyAdjustedRequest);

      const requestTimeoutMs = resolveChildRequestTimeoutMs(
        relatedTaskId,
        childRequestTimeoutMs,
        requestOptions
      );
      const relatedRequestOptions = withCancellationSignal(
        withRequestTimeout(
          createRelatedRequestOptions(extra.requestId, relatedTaskId, requestOptions),
          requestTimeoutMs
        ),
        cancellationSignal
      );
      let result: TResult;

      try {
        result = shouldUseTaskAugmentedClientRequest(server, policyAdjustedRequest.method)
          ? await resolveTaskAugmentedClientRequest<TResult>(
              server,
              policyAdjustedRequest,
              resultSchema,
              ensureTaskCreationRequestOptions(relatedRequestOptions)
            )
          : ((await server.request(
              policyAdjustedRequest,
              resultSchema,
              relatedRequestOptions
            )) as TResult);
      } catch (error) {
        throw normalizeClientRequestError(
          error,
          policyAdjustedRequest.method,
          relatedTaskId,
          requestTimeoutMs
        );
      }

      if (policyAdjustedRequest.method === "roots/list") {
        cacheRootsListResult(rootsState, result);
      }

      return result;
    },
    createElicitationCompletionNotifier(elicitationId: string): () => Promise<void> {
      const requestScopedNotifier = server.createElicitationCompletionNotifier(
        elicitationId,
        createRelatedRequestOptions(extra.requestId, relatedTaskId, undefined)
      );
      const standaloneNotifier = server.createElicitationCompletionNotifier(
        elicitationId,
        relatedTaskId
          ? {
              relatedTask: {
                taskId: relatedTaskId
              }
            }
          : undefined
      );

      return async () => {
        try {
          await requestScopedNotifier();
        } catch (error) {
          if (!isMissingRelatedRequestConnectionError(error)) {
            throw error;
          }

          await standaloneNotifier();
        }
      };
    }
  };
}

export function resolveModelImmediateResponse(
  resolver: EngineMcpModelImmediateResponseResolver | undefined,
  context: EngineMcpModelImmediateResponseContext
): string | undefined {
  if (resolver === undefined) {
    return undefined;
  }

  if (typeof resolver === "string") {
    return resolver;
  }

  return resolver(context);
}

function readCachedRootsListResult(
  rootsState: EngineMcpInvocationRootsState | undefined
): EngineMcpRootsListResult | undefined {
  if (!rootsState?.cachedRoots) {
    return undefined;
  }

  if (rootsState.cachedVersion !== rootsState.changeState.version) {
    rootsState.cachedRoots = undefined;
    rootsState.cachedVersion = undefined;
    return undefined;
  }

  return cloneRootsListResult(rootsState.cachedRoots);
}

function cacheRootsListResult(
  rootsState: EngineMcpInvocationRootsState | undefined,
  result: unknown
): void {
  if (!rootsState || !isRootsListResult(result)) {
    return;
  }

  rootsState.cachedRoots = cloneRootsListResult(result);
  rootsState.cachedVersion = rootsState.changeState.version;
}

function isRootsListResult(value: unknown): value is EngineMcpRootsListResult {
  return (
    isJsonRecord(value) &&
    Array.isArray(value.roots) &&
    value.roots.every(
      (root) =>
        isJsonRecord(root) &&
        typeof root.uri === "string" &&
        (root.name === undefined || typeof root.name === "string")
    )
  );
}

function cloneRootsListResult(result: EngineMcpRootsListResult): EngineMcpRootsListResult {
  return {
    roots: result.roots.map((root) => ({
      uri: root.uri,
      ...(root.name !== undefined ? { name: root.name } : {})
    }))
  };
}

function assertSupportedClientRequest(
  server: Server,
  request: EngineMcpRelatedRequest
): void {
  if (request.method !== "elicitation/create") {
    return;
  }

  const elicitationCapabilities = server.getClientCapabilities()?.elicitation;
  const requestParams = (
    isJsonRecord(request.params) ? request.params : {}
  ) as Record<string, unknown>;
  const requestedMode = requestParams["mode"] === "url" ? "url" : "form";

  if (requestedMode === "url") {
    if (!isJsonRecord(elicitationCapabilities) || elicitationCapabilities.url === undefined) {
      throw new Error("Client does not support url elicitation.");
    }

    return;
  }

  if (!isJsonRecord(elicitationCapabilities)) {
    throw new Error("Client does not support form elicitation.");
  }

  if (
    elicitationCapabilities.form === undefined &&
    Object.keys(elicitationCapabilities).length > 0
  ) {
    throw new Error("Client does not support form elicitation.");
  }
}

function createRelatedRequestOptions(
  requestId: EngineMcpCoreRequestExtra["requestId"],
  relatedTaskId: string | undefined,
  requestOptions: EngineMcpRelatedRequestOptions | undefined
): EngineMcpRelatedRequestOptions {
  return {
    relatedRequestId: requestId,
    ...(relatedTaskId
      ? {
          relatedTask: {
            taskId: relatedTaskId
          }
        }
      : {}),
    ...requestOptions
  };
}

function withCancellationSignal(
  requestOptions: EngineMcpRelatedRequestOptions | undefined,
  cancellationSignal: AbortSignal | undefined
): EngineMcpRelatedRequestOptions {
  const resolvedRequestOptions = requestOptions ?? {};
  const mergedSignal = mergeAbortSignals(cancellationSignal, resolvedRequestOptions.signal);

  if (!mergedSignal || mergedSignal === resolvedRequestOptions.signal) {
    return resolvedRequestOptions;
  }

  return {
    ...resolvedRequestOptions,
    signal: mergedSignal
  };
}

function withRequestTimeout(
  requestOptions: EngineMcpRelatedRequestOptions | undefined,
  timeoutMs: number | undefined
): EngineMcpRelatedRequestOptions {
  if (timeoutMs === undefined) {
    return requestOptions ?? {};
  }

  return {
    ...(requestOptions ?? {}),
    timeout: timeoutMs
  };
}

function mergeAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined
): AbortSignal | undefined {
  if (!first) {
    return second;
  }

  if (!second || first === second) {
    return first;
  }

  return AbortSignal.any([first, second]);
}

function resolveChildRequestTimeoutMs(
  relatedTaskId: string | undefined,
  childRequestTimeoutMs: number | undefined,
  requestOptions: EngineMcpRelatedRequestOptions | undefined
): number | undefined {
  if (!relatedTaskId) {
    return requestOptions?.timeout;
  }

  return requestOptions?.timeout ?? childRequestTimeoutMs;
}

function ensureTaskCreationRequestOptions(
  requestOptions: EngineMcpRelatedRequestOptions | undefined
): EngineMcpRelatedRequestOptions {
  const resolvedRequestOptions = requestOptions ?? {};

  if (resolvedRequestOptions.task) {
    return resolvedRequestOptions;
  }

  return {
    ...resolvedRequestOptions,
    task: {}
  };
}

function shouldUseTaskAugmentedClientRequest(
  server: Server,
  method: EngineMcpRelatedRequest["method"]
): boolean {
  const clientCapabilities = server.getClientCapabilities();

  switch (method) {
    case "sampling/createMessage":
      return clientCapabilities?.tasks?.requests?.sampling?.createMessage !== undefined;
    case "elicitation/create":
      return clientCapabilities?.tasks?.requests?.elicitation?.create !== undefined;
    default:
      return false;
  }
}

async function resolveTaskAugmentedClientRequest<TResult = unknown>(
  server: Server,
  request: EngineMcpRelatedRequest,
  resultSchema: EngineMcpRelatedRequestResultSchema,
  requestOptions: EngineMcpRelatedRequestOptions
): Promise<TResult> {
  for await (const message of server.experimental.tasks.requestStream(
    request,
    resultSchema,
    requestOptions
  )) {
    if (message.type === "result") {
      return message.result as TResult;
    }

    if (message.type === "error") {
      throw message.error;
    }
  }

  throw new Error(
    `Task-augmented client request "${request.method}" completed without a terminal result.`
  );
}

function applySamplingRequestPolicy(
  request: Extract<EngineMcpRelatedRequest, { method: "sampling/createMessage" }>,
  samplingState: EngineMcpInvocationSamplingState | undefined,
  samplingPolicy: EngineMcpSamplingPolicyOptions | undefined
): EngineMcpRelatedRequest {
  if (!samplingState || !samplingPolicy) {
    return request;
  }

  const nextTurn = samplingState.turnCount + 1;
  const maxTurns = samplingPolicy.maxTurns;

  if (maxTurns !== undefined && nextTurn > maxTurns) {
    throw Object.assign(
      new Error(
        `Sampling iteration limit exceeded after ${String(maxTurns)} turns.`
      ),
      {
        code: "sampling_iteration_limit_exceeded",
        details: {
          maxTurns,
          attemptedTurn: nextTurn
        }
      }
    );
  }

  samplingState.turnCount = nextTurn;

  const requestParams = (isJsonRecord(request.params) ? request.params : {}) as Record<
    string,
    unknown
  >;
  const shouldForceFinalToolChoice =
    samplingPolicy.forceToolChoiceNoneOnFinalTurn === true &&
    maxTurns !== undefined &&
    nextTurn === maxTurns &&
    Array.isArray(requestParams.tools);

  if (!shouldForceFinalToolChoice) {
    return request;
  }

  return {
    ...request,
    params: {
      ...requestParams,
      toolChoice: {
        mode: "none"
      }
    }
  } as EngineMcpRelatedRequest;
}

function isMissingRelatedRequestConnectionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("No connection established for request ID:")
  );
}

function normalizeClientRequestError(
  error: unknown,
  method: EngineMcpRelatedRequest["method"],
  relatedTaskId: string | undefined,
  timeoutMs: number | undefined
): unknown {
  const queueOverflowError = normalizeTaskSideQueueError(error, method, relatedTaskId);

  if (queueOverflowError !== error) {
    return queueOverflowError;
  }

  const timeoutData = error instanceof McpError && isJsonRecord(error.data) ? error.data.timeout : undefined;

  if (
    relatedTaskId &&
    timeoutMs !== undefined &&
    error instanceof McpError &&
    error.code === ErrorCode.RequestTimeout &&
    typeof timeoutData === "number"
  ) {
    return {
      code: "client_request_timeout",
      message: `Client request timed out while waiting for ${method}.`,
      details: {
        method,
        timeoutMs,
        relatedTaskId
      }
    };
  }

  return error;
}

function normalizeTaskSideQueueError(
  error: unknown,
  method: string,
  relatedTaskId: string | undefined
): unknown {
  if (!relatedTaskId) {
    return error;
  }

  const queueOverflowDetails = extractTaskQueueOverflowDetails(error);

  if (!queueOverflowDetails) {
    return error;
  }

  return {
    code: "task_message_queue_overflow",
    message: `Task message queue overflow while queueing ${method}.`,
    details: {
      method,
      relatedTaskId,
      ...(queueOverflowDetails.queueSize !== undefined
        ? { queueSize: queueOverflowDetails.queueSize }
        : {}),
      ...(queueOverflowDetails.maxQueueSize !== undefined
        ? { maxQueueSize: queueOverflowDetails.maxQueueSize }
        : {})
    }
  };
}

function extractTaskQueueOverflowDetails(
  error: unknown
): {
  queueSize?: number;
  maxQueueSize?: number;
} | null {
  const message = readErrorText(error);
  const match = /Task message queue overflow: queue size \((\d+)\) exceeds maximum \((\d+)\)/.exec(
    message
  );

  if (!match) {
    return null;
  }

  return {
    queueSize: Number.parseInt(match[1], 10),
    maxQueueSize: Number.parseInt(match[2], 10)
  };
}

function readErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isJsonRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}
