import { PassThrough } from "node:stream";

import {
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema
} from "../../packages/core-server/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";

import {
  startCoreServerStdio,
  startCoreServerStreamableHttp,
  type EngineMcpCapabilityAdapter,
  type EngineMcpStdioServerRuntime,
  type EngineMcpStreamableHttpServerRuntime
} from "../../packages/core-server/src/index.ts";

import {
  measureScenario,
  parseBenchCliOptions,
  writeBenchArtifacts,
  type BenchCliOptions,
  type BenchReport
} from "./common.ts";

const SAMPLE_EDITOR_STATE_INPUT = {
  includeDiagnostics: true,
  includeActiveContainer: true
};

const SAMPLE_EDITOR_STATE_OUTPUT = {
  engine: "Unity",
  engineVersion: "6000.2",
  workspaceName: "SandboxProject",
  isReady: true,
  activity: "idle",
  selectionCount: 1,
  activeContainer: {
    enginePath: "Assets/Scenes/Sandbox.unity"
  },
  diagnostics: []
};

async function main(): Promise<void> {
  const options = parseBenchCliOptions(process.argv.slice(2));
  const scenarios = [
    await runStdioInlineToolCallScenario(options),
    await runHttpInitializeAndInlineToolCallScenario(options),
    await runHttpTaskLifecycleScenario(options),
    await runHttpTaskResultSseCompletedStreamScenario(options),
    await runHttpTaskResultSseReplayScenario(options),
    await runHttpTaskSideSamplingSingleTurnScenario(options),
    await runHttpTaskSideSamplingToolLoopScenario(options)
  ];
  const report: BenchReport = {
    benchmark: "core-server",
    generatedAt: new Date().toISOString(),
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    },
    options,
    scenarios
  };
  const artifacts = await writeBenchArtifacts(
    report.benchmark,
    report,
    options.outputDir
  );

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `Wrote benchmark artifacts to ${artifacts.latestPath} and ${artifacts.timestampedPath}`
  );
}

async function runStdioInlineToolCallScenario(options: BenchCliOptions) {
  const client = await createStdioBenchClient();

  try {
    await client.initialize();

    return await measureScenario(
      "stdio.inline_tool_call.editor_state_read",
      options,
      async (iteration) => {
        const response = await client.request("tools/call", {
          name: "editor.state.read",
          arguments: SAMPLE_EDITOR_STATE_INPUT,
          _meta: {
            progressToken: `bench-stdio-${iteration}`
          }
        });

        if (!("result" in response)) {
          throw new Error(`Expected stdio tools/call result. Received: ${JSON.stringify(response)}`);
        }
      }
    );
  } finally {
    await client.close();
  }
}

async function runHttpInitializeAndInlineToolCallScenario(options: BenchCliOptions) {
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    adapter: createBenchAdapter()
  });

  try {
    return await measureScenario(
      "http.initialize_and_inline_tool_call.editor_state_read",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(runtime, `bench-http-inline-init-${iteration}`);

        try {
          const toolCallResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-inline-call-${iteration}`,
              method: "tools/call",
              params: {
                name: "editor.state.read",
                arguments: SAMPLE_EDITOR_STATE_INPUT
              }
            },
            session.headers
          );

          if (toolCallResponse.status !== 200) {
            throw new Error(`Expected HTTP inline tools/call 200. Received ${toolCallResponse.status}.`);
          }
        } finally {
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    await runtime.close();
  }
}

async function runHttpTaskLifecycleScenario(options: BenchCliOptions) {
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    experimentalTasks: {
      enabled: true,
      defaultPollIntervalMs: 25
    },
    adapter: createBenchAdapter()
  });

  try {
    return await measureScenario(
      "http.task_lifecycle.editor_state_read",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(runtime, `bench-http-task-init-${iteration}`);

        try {
          const taskCreatedResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-task-call-${iteration}`,
              method: "tools/call",
              params: {
                name: "editor.state.read",
                arguments: SAMPLE_EDITOR_STATE_INPUT,
                task: {}
              }
            },
            session.headers
          );
          const taskCreatedBody = (await taskCreatedResponse.json()) as {
            result?: {
              task?: {
                taskId?: string;
              };
            };
          };
          const taskId = taskCreatedBody.result?.task?.taskId;

          if (taskCreatedResponse.status !== 200 || !taskId) {
            throw new Error(
              `Expected HTTP task creation to return a taskId. Body: ${JSON.stringify(taskCreatedBody)}`
            );
          }

          const getTaskResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-task-get-${iteration}`,
              method: "tasks/get",
              params: {
                taskId
              }
            },
            session.headers
          );

          if (getTaskResponse.status !== 200) {
            throw new Error(`Expected HTTP tasks/get 200. Received ${getTaskResponse.status}.`);
          }

          const taskResultResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-task-result-${iteration}`,
              method: "tasks/result",
              params: {
                taskId
              }
            },
            session.headers
          );

          if (taskResultResponse.status !== 200) {
            throw new Error(
              `Expected HTTP tasks/result 200. Received ${taskResultResponse.status}.`
            );
          }
        } finally {
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    await runtime.close();
  }
}

async function runHttpTaskResultSseCompletedStreamScenario(options: BenchCliOptions) {
  const pendingCompletions: Array<Deferred<void>> = [];
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    enableJsonResponse: false,
    experimentalTasks: {
      enabled: true,
      defaultTtlMs: 5_000,
      defaultPollIntervalMs: 25
    },
    adapter: createDeferredTaskBenchAdapter(pendingCompletions)
  });

  try {
    return await measureScenario(
      "http.task_result_sse.completed_stream.editor_state_read",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(runtime, `bench-http-task-sse-init-${iteration}`);
        const completion = createDeferred<void>();
        pendingCompletions.push(completion);

        try {
          const taskId = await createHttpTaskFromEventStream(runtime, session, {
            requestId: `bench-http-task-sse-call-${iteration}`
          });
          const taskResultResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-task-sse-result-${iteration}`,
              method: "tasks/result",
              params: {
                taskId
              }
            },
            session.headers
          );

          if (taskResultResponse.status !== 200) {
            throw new Error(
              `Expected HTTP tasks/result SSE 200. Received ${taskResultResponse.status}.`
            );
          }

          const streamReader = createTextStreamReader(taskResultResponse.body);

          completion.resolve();

          const finalBody = await streamReader.readUntil(
            `\"id\":\"bench-http-task-sse-result-${iteration}\"`
          );

          if (!finalBody.includes("\"structuredContent\"")) {
            throw new Error(`Expected SSE tasks/result payload. Received: ${finalBody}`);
          }

          await streamReader.close();
        } finally {
          completion.resolve();
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    while (pendingCompletions.length > 0) {
      pendingCompletions.pop()?.resolve();
    }
    await runtime.close();
  }
}

async function runHttpTaskResultSseReplayScenario(options: BenchCliOptions) {
  const pendingCompletions: Array<Deferred<void>> = [];
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    enableJsonResponse: false,
    experimentalTasks: {
      enabled: true,
      defaultTtlMs: 5_000,
      defaultPollIntervalMs: 25
    },
    adapter: createDeferredTaskBenchAdapter(pendingCompletions)
  });

  try {
    return await measureScenario(
      "http.task_result_sse.replay_after_disconnect.editor_state_read",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(
          runtime,
          `bench-http-task-replay-init-${iteration}`
        );
        const completion = createDeferred<void>();
        pendingCompletions.push(completion);

        try {
          const taskId = await createHttpTaskFromEventStream(runtime, session, {
            requestId: `bench-http-task-replay-call-${iteration}`
          });
          const taskResultResponse = await postJson(
            runtime.address.endpointUrl,
            {
              jsonrpc: "2.0",
              id: `bench-http-task-replay-result-${iteration}`,
              method: "tasks/result",
              params: {
                taskId
              }
            },
            session.headers
          );

          if (taskResultResponse.status !== 200) {
            throw new Error(
              `Expected HTTP tasks/result replay stream 200. Received ${taskResultResponse.status}.`
            );
          }

          const streamReader = createTextStreamReader(taskResultResponse.body);
          const primingBody = await streamReader.readUntil("id: event-");
          const lastEventId = extractEventId(primingBody);

          await streamReader.close();

          const replayResponse = await openReplayStream({
            endpointUrl: runtime.address.endpointUrl,
            sessionId: session.sessionId,
            lastEventId
          });

          if (replayResponse.status !== 200) {
            throw new Error(`Expected replay GET to return 200. Received ${replayResponse.status}.`);
          }

          completion.resolve();

          const replayBody = await readTextStreamUntil(
            replayResponse.body,
            `\"id\":\"bench-http-task-replay-result-${iteration}\"`
          );

          if (!replayBody.includes("\"structuredContent\"")) {
            throw new Error(`Expected replayed tasks/result payload. Received: ${replayBody}`);
          }
        } finally {
          completion.resolve();
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    while (pendingCompletions.length > 0) {
      pendingCompletions.pop()?.resolve();
    }
    await runtime.close();
  }
}

async function runHttpTaskSideSamplingSingleTurnScenario(options: BenchCliOptions) {
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    enableJsonResponse: false,
    experimentalTasks: {
      enabled: true,
      defaultTtlMs: 5_000,
      defaultPollIntervalMs: 25
    },
    adapter: createSamplingBenchAdapter()
  });

  try {
    return await measureScenario(
      "http.task_side_sampling.single_turn.text_only",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(runtime, `bench-http-sampling-init-${iteration}`, {
          sampling: {},
          tasks: {
            requests: {
              sampling: {
                createMessage: {}
              }
            }
          }
        });
        const taskResultRequestId = `bench-http-sampling-result-${iteration}`;

        try {
          const { taskResultStream, streamReader } = await startHttpTaskToolCallStream(runtime, session, {
            requestId: `bench-http-sampling-call-${iteration}`,
            taskResultRequestId
          });

          if (taskResultStream.status !== 200) {
            throw new Error(
              `Expected HTTP sampling task stream 200. Received ${taskResultStream.status}.`
            );
          }

          try {
            const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            await resolveRemoteHttpChildTask(session, {
              streamReader,
              initialRequest: samplingRequest,
              childTaskId: `bench-http-sampling-child-${iteration}`,
              finalResult: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                  type: "text",
                  text: "BenchHttpSamplingSingleTurn"
                },
                stopReason: "endTurn"
              }
            });

            const finalTaskResultBody = await streamReader.readUntil(
              `\"id\":\"${taskResultRequestId}\"`
            );

            if (!finalTaskResultBody.includes("\"workspaceName\":\"BenchHttpSamplingSingleTurn\"")) {
              throw new Error(
                `Expected final sampling result to update workspaceName. Received: ${finalTaskResultBody}`
              );
            }
          } finally {
            await streamReader.close();
          }
        } finally {
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    await runtime.close();
  }
}

async function runHttpTaskSideSamplingToolLoopScenario(options: BenchCliOptions) {
  const runtime = await startCoreServerStreamableHttp({
    port: 0,
    enableJsonResponse: false,
    experimentalTasks: {
      enabled: true,
      defaultTtlMs: 5_000,
      defaultPollIntervalMs: 25
    },
    adapter: createSamplingToolLoopBenchAdapter()
  });

  try {
    return await measureScenario(
      "http.task_side_sampling.tool_loop.two_turn",
      options,
      async (iteration) => {
        const session = await initializeHttpSession(
          runtime,
          `bench-http-sampling-tools-init-${iteration}`,
          {
            sampling: {
              tools: {}
            },
            tasks: {
              requests: {
                sampling: {
                  createMessage: {}
                }
              }
            }
          }
        );
        const taskResultRequestId = `bench-http-sampling-tools-result-${iteration}`;

        try {
          const { streamReader, taskResultStream } = await startHttpTaskToolCallStream(runtime, session, {
            requestId: `bench-http-sampling-tools-call-${iteration}`,
            taskResultRequestId
          });

          if (taskResultStream.status !== 200) {
            throw new Error(
              `Expected HTTP sampling tool-loop stream 200. Received ${taskResultStream.status}.`
            );
          }

          try {
            const firstSamplingRequest = await waitForHttpRequest(
              streamReader,
              "sampling/createMessage"
            );
            await resolveRemoteHttpChildTask(session, {
              streamReader,
              initialRequest: firstSamplingRequest,
              childTaskId: `bench-http-sampling-tools-child-1-${iteration}`,
              finalResult: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    name: "workspace_lookup",
                    id: "bench-http-sampling-tool-use-1",
                    input: {
                      hint: "sandbox"
                    }
                  }
                ],
                stopReason: "toolUse"
              }
            });

            const secondSamplingRequest = await waitForHttpRequest(
              streamReader,
              "sampling/createMessage",
              {
                occurrence: 2
              }
            );
            await resolveRemoteHttpChildTask(session, {
              streamReader,
              initialRequest: secondSamplingRequest,
              childTaskId: `bench-http-sampling-tools-child-2-${iteration}`,
              finalResult: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                  type: "text",
                  text: "BenchHttpSamplingToolLoop"
                },
                stopReason: "endTurn"
              },
              getOccurrence: 2,
              resultOccurrence: 2
            });

            const finalTaskResultBody = await streamReader.readUntil(
              `\"id\":\"${taskResultRequestId}\"`
            );

            if (!finalTaskResultBody.includes("\"workspaceName\":\"BenchHttpSamplingToolLoop\"")) {
              throw new Error(
                `Expected final sampling tool-loop result to update workspaceName. Received: ${finalTaskResultBody}`
              );
            }
          } finally {
            await streamReader.close();
          }
        } finally {
          await deleteSession(runtime, session);
        }
      }
    );
  } finally {
    await runtime.close();
  }
}

function createBenchAdapter(): EngineMcpCapabilityAdapter {
  return {
    adapter: "bench-core-server-adapter",
    capabilities: ["editor.state.read"],
    async invoke() {
      return SAMPLE_EDITOR_STATE_OUTPUT;
    }
  };
}

function createSamplingBenchAdapter(): EngineMcpCapabilityAdapter {
  return {
    adapter: "bench-core-server-sampling-adapter",
    capabilities: ["editor.state.read"],
    async invoke(request) {
      const taskContext = request.context;

      if (!taskContext?.sendRequest) {
        throw new Error("Missing task sendRequest helper.");
      }

      const samplingResult = await taskContext.sendRequest(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "Return the workspace name only."
                }
              }
            ],
            maxTokens: 32
          }
        },
        CreateMessageResultSchema
      );

      return {
        ...SAMPLE_EDITOR_STATE_OUTPUT,
        workspaceName:
          samplingResult.content.type === "text" &&
          typeof samplingResult.content.text === "string"
            ? samplingResult.content.text
            : SAMPLE_EDITOR_STATE_OUTPUT.workspaceName
      };
    }
  };
}

function createSamplingToolLoopBenchAdapter(): EngineMcpCapabilityAdapter {
  return {
    adapter: "bench-core-server-sampling-loop-adapter",
    capabilities: ["editor.state.read"],
    async invoke(request) {
      const taskContext = request.context;

      if (!taskContext?.sendRequest) {
        throw new Error("Missing task sendRequest helper.");
      }

      const initialPrompt = "Use the tool if needed, then return the workspace name.";
      const firstSamplingResult = await taskContext.sendRequest(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: initialPrompt
                }
              }
            ],
            maxTokens: 64,
            tools: [
              {
                name: "workspace_lookup",
                description: "Resolves the workspace name",
                inputSchema: {
                  type: "object",
                  properties: {
                    hint: {
                      type: "string"
                    }
                  }
                }
              }
            ],
            toolChoice: {
              mode: "auto"
            }
          }
        },
        CreateMessageResultWithToolsSchema
      );
      const toolUseBlock = firstSamplingResult.content.find(
        (block: any) => block.type === "tool_use" && block.id === "bench-http-sampling-tool-use-1"
      );

      if (!toolUseBlock || toolUseBlock.name !== "workspace_lookup") {
        throw new Error("Expected the first sampling turn to request the workspace tool.");
      }

      const finalSamplingResult = await taskContext.sendRequest(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: initialPrompt
                }
              },
              {
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    name: toolUseBlock.name,
                    id: toolUseBlock.id,
                    input: toolUseBlock.input ?? {}
                  }
                ]
              },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    toolUseId: toolUseBlock.id,
                    content: [
                      {
                        type: "text",
                        text: "BenchHttpSamplingToolLoop"
                      }
                    ]
                  }
                ]
              }
            ],
            maxTokens: 64
          }
        },
        CreateMessageResultSchema
      );

      return {
        ...SAMPLE_EDITOR_STATE_OUTPUT,
        workspaceName:
          finalSamplingResult.content.type === "text" &&
          typeof finalSamplingResult.content.text === "string"
            ? finalSamplingResult.content.text
            : SAMPLE_EDITOR_STATE_OUTPUT.workspaceName
      };
    }
  };
}

function createDeferredTaskBenchAdapter(
  pendingCompletions: Array<Deferred<void>>
): EngineMcpCapabilityAdapter {
  return {
    adapter: "bench-core-server-sse-adapter",
    capabilities: ["editor.state.read"],
    async invoke() {
      const completion = pendingCompletions.shift();

      if (!completion) {
        throw new Error("Missing completion gate for benchmark task invocation.");
      }

      await completion.promise;
      return SAMPLE_EDITOR_STATE_OUTPUT;
    }
  };
}

async function createStdioBenchClient(): Promise<{
  initialize(): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const runtime = await startCoreServerStdio({
    stdin,
    stdout,
    adapter: createBenchAdapter()
  });
  const pendingRequests = new Map<
    string,
    {
      resolve: (message: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  let buffer = "";
  let requestCounter = 0;

  stdout.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();

    while (true) {
      const newlineIndex = buffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      const message = JSON.parse(line) as Record<string, unknown>;

      if (!("id" in message)) {
        continue;
      }

      const requestId = String(message.id);
      const pending = pendingRequests.get(requestId);

      if (!pending) {
        continue;
      }

      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      pending.resolve(message);
    }
  });

  async function send(message: Record<string, unknown>): Promise<void> {
    stdin.write(`${JSON.stringify(message)}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return {
    async initialize(): Promise<void> {
      await this.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "bench-stdio",
          version: "1.0.0"
        }
      });

      await send({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      });
    },
    async request(method: string, params: Record<string, unknown> = {}) {
      const requestId = `bench-stdio-${String(++requestCounter).padStart(4, "0")}`;
      const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`Timed out waiting for stdio response to ${method}.`));
        }, 5_000);

        pendingRequests.set(requestId, {
          resolve,
          reject,
          timeout
        });
      });

      await send({
        jsonrpc: "2.0",
        id: requestId,
        method,
        params
      });

      return responsePromise;
    },
    async close(): Promise<void> {
      for (const [requestId, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Closing stdio bench client before response ${requestId}.`));
        pendingRequests.delete(requestId);
      }

      await runtime.close();
    }
  };
}

async function initializeHttpSession(
  runtime: EngineMcpStreamableHttpServerRuntime,
  requestId: string,
  capabilities: Record<string, unknown> = {}
): Promise<{
  endpointUrl: string;
  headers: Record<string, string>;
  sessionId: string;
}> {
  const origin = "http://localhost:4100";
  const initializeResponse = await postJson(
    runtime.address.endpointUrl,
    {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities,
        clientInfo: {
          name: "bench-http",
          version: "1.0.0"
        }
      }
    },
    {
      origin
    }
  );
  const sessionId = initializeResponse.headers.get("mcp-session-id");

  if (initializeResponse.status !== 200 || !sessionId) {
    throw new Error(
      `Expected initialize to return an MCP session id. Received status ${initializeResponse.status}.`
    );
  }

  await initializeResponse.text();

  return {
    endpointUrl: runtime.address.endpointUrl,
    sessionId,
    headers: {
      origin,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-11-25"
    }
  };
}

async function deleteSession(
  runtime: EngineMcpStreamableHttpServerRuntime,
  session: {
    headers: Record<string, string>;
  }
): Promise<void> {
  const response = await fetch(runtime.address.endpointUrl, {
    method: "DELETE",
    headers: {
      accept: "application/json",
      ...session.headers
    }
  });

  if (response.status !== 200) {
    throw new Error(`Expected session delete to return 200. Received ${response.status}.`);
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function createHttpTaskFromEventStream(
  runtime: EngineMcpStreamableHttpServerRuntime,
  session: {
    endpointUrl: string;
    headers: Record<string, string>;
  },
  options: {
    requestId: string;
  }
): Promise<string> {
  const taskCreatedResponse = await postJson(
    runtime.address.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.requestId,
      method: "tools/call",
      params: {
        name: "editor.state.read",
        arguments: SAMPLE_EDITOR_STATE_INPUT,
        task: {}
      }
    },
    session.headers
  );
  const taskCreatedBody = await taskCreatedResponse.text();
  const taskId = extractTaskId(taskCreatedBody);

  if (taskCreatedResponse.status !== 200 || !taskId) {
    throw new Error(
      `Expected HTTP task creation over SSE to return a taskId. Body: ${taskCreatedBody}`
    );
  }

  return taskId;
}

async function startHttpTaskToolCallStream(
  runtime: EngineMcpStreamableHttpServerRuntime,
  session: {
    endpointUrl: string;
    headers: Record<string, string>;
  },
  options: {
    requestId: string;
    taskResultRequestId: string;
  }
): Promise<{
  taskId: string;
  taskResultStream: Response;
  streamReader: ReturnType<typeof createTextStreamReader>;
}> {
  const taskId = await createHttpTaskFromEventStream(runtime, session, {
    requestId: options.requestId
  });
  const taskResultStream = await postJson(
    runtime.address.endpointUrl,
    {
      jsonrpc: "2.0",
      id: options.taskResultRequestId,
      method: "tasks/result",
      params: {
        taskId
      }
    },
    session.headers
  );

  return {
    taskId,
    taskResultStream,
    streamReader: createTextStreamReader(taskResultStream.body)
  };
}

async function openReplayStream(options: {
  endpointUrl: string;
  sessionId: string;
  lastEventId: string;
  attempts?: number;
}): Promise<Response> {
  const attempts = options.attempts ?? 10;

  for (let index = 0; index < attempts; index += 1) {
    const response = await fetch(options.endpointUrl, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        origin: "http://localhost:4100",
        "mcp-session-id": options.sessionId,
        "mcp-protocol-version": "2025-11-25",
        "last-event-id": options.lastEventId
      }
    });

    if (response.status !== 409) {
      return response;
    }

    await response.text();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error("Replay stream stayed in 409 Conflict after closing the original stream.");
}

async function waitForHttpRequest<TParams = Record<string, unknown>>(
  streamReader: ReturnType<typeof createTextStreamReader>,
  method: string,
  options: {
    timeoutMs?: number;
    occurrence?: number;
  } = {}
): Promise<{
  id: number;
  method: string;
  params?: TParams;
  rawBody: string;
}> {
  const rawBody = await streamReader.readUntil(
    `\"method\":\"${method}\"`,
    options.timeoutMs,
    options.occurrence
  );
  const message = extractSseRequestByMethod<TParams>(rawBody, method);

  return {
    ...message,
    rawBody
  };
}

async function respondToHttpRequest<TResult>(
  session: {
    endpointUrl: string;
    headers: Record<string, string>;
    sessionId: string;
  },
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
    session.headers
  );
}

async function resolveRemoteHttpChildTask<TResult>(
  session: {
    endpointUrl: string;
    headers: Record<string, string>;
    sessionId: string;
  },
  options: {
    streamReader: ReturnType<typeof createTextStreamReader>;
    initialRequest: {
      id: number;
    };
    childTaskId: string;
    finalResult: TResult;
    getOccurrence?: number;
    resultOccurrence?: number;
  }
): Promise<void> {
  const initialAck = await respondToHttpRequest(session, options.initialRequest.id, {
    task: createRemoteTaskDescriptor(options.childTaskId, "working")
  });

  if (initialAck.status !== 202) {
    throw new Error(
      `Expected child-task ack 202 after sampling request. Received ${initialAck.status}.`
    );
  }

  const childTaskGet = await waitForHttpRequest<{ taskId: string }>(
    options.streamReader,
    "tasks/get",
    {
      occurrence: options.getOccurrence
    }
  );
  const getAck = await respondToHttpRequest(
    session,
    childTaskGet.id,
    createRemoteTaskDescriptor(options.childTaskId, "completed")
  );

  if (getAck.status !== 202) {
    throw new Error(`Expected child tasks/get ack 202. Received ${getAck.status}.`);
  }

  const childTaskResult = await waitForHttpRequest<{ taskId: string }>(
    options.streamReader,
    "tasks/result",
    {
      occurrence: options.resultOccurrence
    }
  );
  const resultAck = await respondToHttpRequest(session, childTaskResult.id, options.finalResult);

  if (resultAck.status !== 202) {
    throw new Error(`Expected child tasks/result ack 202. Received ${resultAck.status}.`);
  }
}

function extractSseRequestByMethod<TParams = Record<string, unknown>>(
  sseBody: string,
  method: string
): {
  id: number;
  method: string;
  params?: TParams;
} {
  const events = sseBody.split("\n\n");

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (!event.includes(`\"method\":\"${method}\"`)) {
      continue;
    }

    const dataLine = event
      .split("\n")
      .find((line) => line.startsWith("data: {") && line.includes(`\"method\":\"${method}\"`));

    if (!dataLine) {
      continue;
    }

    const message = JSON.parse(dataLine.slice(6)) as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
    };

    if (typeof message.id !== "number") {
      throw new Error(`Expected SSE request for ${method} to include a numeric id.`);
    }

    if (message.method !== method) {
      continue;
    }

    return {
      id: message.id,
      method,
      params:
        message.params && typeof message.params === "object" && !Array.isArray(message.params)
          ? (message.params as TParams)
          : undefined
    };
  }

  throw new Error(`Unable to find SSE request for ${method}. Body: ${sseBody}`);
}

function createRemoteTaskDescriptor(
  taskId: string,
  status: "working" | "completed",
  pollInterval = 1,
  ttl = 1_500
): {
  taskId: string;
  status: string;
  ttl: number;
  createdAt: string;
  lastUpdatedAt: string;
  pollInterval: number;
} {
  const timestamp = "2026-03-22T00:00:00.000Z";

  return {
    taskId,
    status,
    ttl,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
    pollInterval
  };
}

function createTextStreamReader(stream: ReadableStream<Uint8Array> | null): {
  readUntil(pattern: string, timeoutMs?: number, occurrence?: number): Promise<string>;
  close(): Promise<void>;
} {
  if (!stream) {
    throw new Error("Expected a readable response body.");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let collected = "";

  return {
    async readUntil(pattern: string, timeoutMs = 2_000, occurrence = 1): Promise<string> {
      if (countOccurrences(collected, pattern) >= occurrence) {
        return collected;
      }

      const timeout = setTimeout(() => {
        void reader.cancel("Timed out waiting for SSE payload.");
      }, timeoutMs);

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            throw new Error(
              `Stream ended before receiving "${pattern}". Received: ${collected}`
            );
          }

          collected += decoder.decode(value, { stream: true });

          if (countOccurrences(collected, pattern) >= occurrence) {
            return collected;
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined);
    }
  };
}

async function readTextStreamUntil(
  stream: ReadableStream<Uint8Array> | null,
  pattern: string,
  timeoutMs = 2_000
): Promise<string> {
  if (!stream) {
    throw new Error("Expected a readable response body.");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const timeout = setTimeout(() => {
    void reader.cancel("Timed out waiting for SSE payload.");
  }, timeoutMs);
  let collected = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        throw new Error(`Stream ended before receiving "${pattern}". Received: ${collected}`);
      }

      collected += decoder.decode(value, { stream: true });

      if (collected.includes(pattern)) {
        return collected;
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}

function extractTaskId(body: string): string | null {
  return body.match(/"taskId":"([^"]+)"/)?.[1] ?? null;
}

function extractEventId(body: string): string {
  const eventId = body.match(/id: (event-\d+)/)?.[1];

  if (!eventId) {
    throw new Error(`Expected SSE body to contain an event id. Received: ${body}`);
  }

  return eventId;
}

function countOccurrences(body: string, pattern: string): number {
  if (pattern.length === 0) {
    return 0;
  }

  let count = 0;
  let searchIndex = 0;

  while (true) {
    const nextIndex = body.indexOf(pattern, searchIndex);

    if (nextIndex === -1) {
      return count;
    }

    count += 1;
    searchIndex = nextIndex + pattern.length;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve as (value?: T | PromiseLike<T>) => void;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
