import type { EngineMcpStreamableHttpServerRuntime } from "../index.js";

import { createRemoteTaskDescriptor } from "./fixtures.js";
import {
  createTextStreamReader,
  extractSseRequestByMethod,
  postJson,
  readJson,
  readTextStreamUntil
} from "./http.js";

export interface HttpClientSession {
  endpointUrl: string;
  sessionId: string;
  origin: string;
  protocolVersion: string;
  requestHeaders: Record<string, string>;
}

export interface HttpRequestMessage<TParams = any> {
  id: number;
  method: string;
  params?: TParams;
  rawBody: string;
}

export type HttpStreamReader = ReturnType<typeof createTextStreamReader>;

export async function initializeHttpClientSession(
  runtime: EngineMcpStreamableHttpServerRuntime,
  options: {
    requestId: string;
    capabilities: Record<string, unknown>;
    protocolVersion?: string;
    clientInfo?: {
      name: string;
      version: string;
    };
    origin?: string;
  }
): Promise<{
  session: HttpClientSession;
  initializeResponse: Response;
  initializeBody: string;
}> {
  const origin = options.origin ?? "http://localhost:4100";
  const protocolVersion = options.protocolVersion ?? "2025-11-25";
  const initializeResponse = await postJson(
    runtime.address.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: options.capabilities,
        clientInfo: options.clientInfo ?? {
          name: "vitest-http",
          version: "1.0.0"
        }
      }
    },
    {
      origin
    }
  );
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  const initializeBody = await initializeResponse.text();

  if (!sessionId) {
    throw new Error("Expected initialize to return an MCP session id.");
  }

  return {
    session: {
      endpointUrl: runtime.address.endpointUrl,
      sessionId,
      origin,
      protocolVersion,
      requestHeaders: {
        origin,
        "mcp-session-id": sessionId,
        "mcp-protocol-version": protocolVersion
      }
    },
    initializeResponse,
    initializeBody
  };
}

export async function startHttpTaskToolCall(
  session: HttpClientSession,
  options: {
    requestId: string;
    taskResultRequestId?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    ttl?: number;
  }
): Promise<{
  taskId: string;
  taskCreatedResponse: Response;
  taskCreatedBody: string;
  taskResultStream: Response;
  streamReader: HttpStreamReader;
}> {
  const taskCreatedResponse = await postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: "tools/call",
      params: {
        name: options.name ?? "editor.state.read",
        arguments: options.arguments ?? {},
        task: {
          ttl: options.ttl ?? 1_500
        }
      }
    },
    session.requestHeaders
  );
  const taskCreatedBody = await taskCreatedResponse.text();
  const taskId = taskCreatedBody.match(/"taskId":"([^"]+)"/)?.[1];

  if (!taskId) {
    throw new Error(`Expected task creation response to include a taskId. Body: ${taskCreatedBody}`);
  }

  const taskResultStream = await postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.taskResultRequestId ?? `tasks-result-${taskId}`,
      method: "tasks/result",
      params: {
        taskId
      }
    },
    session.requestHeaders
  );

  return {
    taskId,
    taskCreatedResponse,
    taskCreatedBody,
    taskResultStream,
    streamReader: createTextStreamReader(taskResultStream.body)
  };
}

export async function openHttpToolCallStream(
  session: HttpClientSession,
  options: {
    requestId: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }
): Promise<{
  toolCallResponse: Response;
  streamReader: HttpStreamReader;
}> {
  const toolCallResponse = await postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: "tools/call",
      params: {
        name: options.name ?? "editor.state.read",
        arguments: options.arguments ?? {}
      }
    },
    session.requestHeaders
  );

  return {
    toolCallResponse,
    streamReader: createTextStreamReader(toolCallResponse.body)
  };
}

export async function callHttpJsonRpc(
  session: HttpClientSession,
  options: {
    requestId: string;
    method: string;
    params?: Record<string, unknown>;
  }
): Promise<Response> {
  return postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: options.method,
      params: options.params ?? {}
    },
    session.requestHeaders
  );
}

export async function createHttpJsonTask<TTask extends { taskId: string }>(
  session: HttpClientSession,
  options: {
    requestId: string;
    name?: string;
    arguments?: Record<string, unknown>;
    ttl?: number;
  }
): Promise<{
  taskId: string;
  response: Response;
  json: {
    result: {
      task: TTask;
    };
  };
}> {
  const response = await callHttpJsonRpc(session, {
    requestId: options.requestId,
    method: "tools/call",
    params: {
      name: options.name ?? "editor.state.read",
      arguments: options.arguments ?? {},
      task: {
        ttl: options.ttl ?? 1_500
      }
    }
  });
  const json = await readJson<{
    result: {
      task: TTask;
    };
  }>(response);
  const taskId = json.result.task.taskId;

  if (!taskId) {
    throw new Error("Expected JSON task creation response to include a taskId.");
  }

  return {
    taskId,
    response,
    json
  };
}

export async function getHttpTask<TTask extends { taskId: string }>(
  session: HttpClientSession,
  options: {
    taskId: string;
    requestId: string;
  }
): Promise<{
  response: Response;
  json: {
    result: TTask;
  };
}> {
  const response = await callHttpJsonRpc(session, {
    requestId: options.requestId,
    method: "tasks/get",
    params: {
      taskId: options.taskId
    }
  });

  return {
    response,
    json: await readJson<{
      result: TTask;
    }>(response)
  };
}

export async function cancelHttpTask<TTask extends { taskId: string }>(
  session: HttpClientSession,
  options: {
    taskId: string;
    requestId: string;
  }
): Promise<{
  response: Response;
  json: {
    result: TTask;
  };
}> {
  const response = await callHttpJsonRpc(session, {
    requestId: options.requestId,
    method: "tasks/cancel",
    params: {
      taskId: options.taskId
    }
  });

  return {
    response,
    json: await readJson<{
      result: TTask;
    }>(response)
  };
}

export async function listHttpTasks<TTask>(
  session: HttpClientSession,
  options: {
    requestId: string;
  }
): Promise<{
  response: Response;
  json: {
    result: {
      tasks: TTask[];
    };
  };
}> {
  const response = await callHttpJsonRpc(session, {
    requestId: options.requestId,
    method: "tasks/list"
  });

  return {
    response,
    json: await readJson<{
      result: {
        tasks: TTask[];
      };
    }>(response)
  };
}

export async function waitForHttpRequest<TParams = any>(
  streamReader: HttpStreamReader,
  method: string,
  options: {
    timeoutMs?: number;
    occurrence?: number;
  } = {}
): Promise<HttpRequestMessage<TParams>> {
  const rawBody = await streamReader.readUntil(
    `"method":"${method}"`,
    options.timeoutMs,
    options.occurrence
  );
  let message: {
    id: number;
    method: string;
    params?: TParams;
  };

  try {
    message = extractSseRequestByMethod<TParams>(rawBody, method);
  } catch (error) {
    throw new Error(
      `Failed to extract SSE request for ${method}. Body: ${rawBody}`,
      { cause: error }
    );
  }

  return {
    ...message,
    rawBody
  };
}

export async function respondToHttpRequest<TResult>(
  session: HttpClientSession,
  requestId: number,
  result: TResult
): Promise<Response> {
  return postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: requestId,
      result
    },
    session.requestHeaders
  );
}

export async function resolveRemoteHttpChildTask<TResult>(
  session: HttpClientSession,
  options: {
    streamReader: HttpStreamReader;
    initialRequest: HttpRequestMessage;
    childTaskId: string;
    finalResult: TResult;
    getOccurrence?: number;
    resultOccurrence?: number;
  }
): Promise<void> {
  await respondToHttpRequest(session, options.initialRequest.id, {
    task: createRemoteTaskDescriptor(options.childTaskId, "working")
  });

  const childTaskGet = await waitForHttpRequest<{ taskId: string }>(
    options.streamReader,
    "tasks/get",
    {
      occurrence: options.getOccurrence
    }
  );
  await respondToHttpRequest(
    session,
    childTaskGet.id,
    createRemoteTaskDescriptor(options.childTaskId, "completed")
  );

  const childTaskResult = await waitForHttpRequest<{ taskId: string }>(
    options.streamReader,
    "tasks/result",
    {
      occurrence: options.resultOccurrence
    }
  );
  await respondToHttpRequest(session, childTaskResult.id, options.finalResult);
}

export async function cancelRemoteHttpChildTask(
  session: HttpClientSession,
  options: {
    streamReader: HttpStreamReader;
    initialRequest: HttpRequestMessage;
    childTaskId: string;
    getOccurrence?: number;
  }
): Promise<void> {
  await respondToHttpRequest(session, options.initialRequest.id, {
    task: createRemoteTaskDescriptor(options.childTaskId, "working")
  });

  const childTaskGet = await waitForHttpRequest<{ taskId: string }>(
    options.streamReader,
    "tasks/get",
    {
      occurrence: options.getOccurrence
    }
  );
  await respondToHttpRequest(
    session,
    childTaskGet.id,
    createRemoteTaskDescriptor(options.childTaskId, "cancelled")
  );
}

export async function readFinalHttpTaskResult(
  session: HttpClientSession,
  options: {
    taskId: string;
    requestId: string;
    pattern?: string;
  }
): Promise<{
  response: Response;
  body: string;
}> {
  const response = await postJson(
    session.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: "tasks/result",
      params: {
        taskId: options.taskId
      }
    },
    session.requestHeaders
  );
  const body = await readTextStreamUntil(response.body, options.pattern ?? "\"structuredContent\"");

  return {
    response,
    body
  };
}

export async function openHttpEventStream(
  session: HttpClientSession,
  options: {
    lastEventId?: string;
  } = {}
): Promise<Response> {
  return fetch(session.endpointUrl, {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      ...session.requestHeaders,
      ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {})
    }
  });
}

export async function openReplayHttpEventStream(
  session: HttpClientSession,
  options: {
    lastEventId: string;
    attempts?: number;
  }
): Promise<Response> {
  const attempts = options.attempts ?? 10;

  for (let index = 0; index < attempts; index += 1) {
    const response = await openHttpEventStream(session, {
      lastEventId: options.lastEventId
    });

    if (response.status !== 409) {
      return response;
    }

    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Replay stream stayed in 409 Conflict after closing the original stream.");
}
