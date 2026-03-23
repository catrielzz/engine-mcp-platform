import { afterEach, describe, expect, it } from "vitest";

import {
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { VALID_SAMPLES, createDeferred, createFakeAdapter } from "./test-support/fixtures.js";
import {
  callHttpJsonRpc,
  cancelHttpTask,
  createHttpJsonTask,
  getHttpTask,
  initializeHttpClientSession,
  listHttpTasks
} from "./test-support/http-client-requests.js";
import { readJson } from "./test-support/http.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP task lifecycle", () => {
  it("supports task-augmented tools/call, tasks/get, and tasks/result over Streamable HTTP sessions", async () => {
    const completion = createDeferred<void>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        await request.context?.sendProgress({
          progress: 1,
          total: 2,
          message: "Task queued over HTTP"
        });
        await completion.promise;
        return VALID_SAMPLES["editor.state.read"].output;
      })
    });
    openServers.push(runtime);

    const { session, initializeBody } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-json",
      capabilities: {}
    });
    expect(
      JSON.parse(initializeBody) as {
        result: {
          capabilities: {
            tasks: {
              list: Record<string, never>;
              cancel: Record<string, never>;
              requests: {
                tools: {
                  call: Record<string, never>;
                };
              };
            };
          };
        };
      }
    ).toMatchObject({
      result: {
        capabilities: {
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
      }
    });

    const taskCreated = await createHttpJsonTask<{
      taskId: string;
      status: string;
      ttl: number;
      pollInterval: number;
    }>(session, {
      requestId: "tools-call-http-task-json",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });
    const taskId = taskCreated.taskId;

    expect(taskCreated.response.status).toBe(200);
    expect(taskCreated.json.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working",
      ttl: 1_500,
      pollInterval: 25
    });

    const workingTask = await getHttpTask<{
      taskId: string;
      status: string;
      pollInterval: number;
    }>(session, {
      taskId,
      requestId: "tasks-get-http-task-json-working"
    });
    expect(workingTask.json).toMatchObject({
      result: {
        taskId,
        status: "working",
        pollInterval: 25
      }
    });

    const taskResultResponsePromise = callHttpJsonRpc(session, {
      requestId: "tasks-result-http-task-json",
      method: "tasks/result",
      params: {
        taskId
      }
    });

    completion.resolve();

    const taskResultResponse = await taskResultResponsePromise;
    expect(taskResultResponse.status).toBe(200);
    await expect(
      readJson<{
        result: {
          structuredContent: Record<string, unknown>;
          _meta: Record<string, unknown>;
        };
      }>(taskResultResponse)
    ).resolves.toMatchObject({
      result: {
        structuredContent: VALID_SAMPLES["editor.state.read"].output,
        _meta: {
          "engine-mcp/capability": "editor.state.read",
          "engine-mcp/resultAdapter": "fake-core-server-adapter"
        }
      }
    });

    const completedTask = await getHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-get-http-task-json-completed"
    });
    expect(completedTask.json).toMatchObject({
      result: {
        taskId,
        status: "completed"
      }
    });
  });

  it("adds io.modelcontextprotocol/model-immediate-response to CreateTaskResult over Streamable HTTP when configured", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      experimentalTasks: {
        enabled: true,
        defaultPollIntervalMs: 25,
        modelImmediateResponse: ({ capability, taskId }) =>
          `Task ${taskId} for ${capability} is running in the background.`
      },
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-immediate-response",
      capabilities: {}
    });

    const taskCreatedResponse = await callHttpJsonRpc(session, {
      requestId: "tools-call-http-task-immediate-response",
      method: "tools/call",
      params: {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {}
      }
    });
    const taskCreatedJson = await readJson<{
      result: {
        task: {
          taskId: string;
          status: string;
        };
        _meta: {
          "io.modelcontextprotocol/model-immediate-response": string;
        };
      };
    }>(taskCreatedResponse);
    const taskId = taskCreatedJson.result.task.taskId;

    expect(taskCreatedResponse.status).toBe(200);
    expect(taskCreatedJson.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working"
    });
    expect(taskCreatedJson.result._meta).toMatchObject({
      "io.modelcontextprotocol/model-immediate-response": `Task ${taskId} for editor.state.read is running in the background.`
    });
  });

  it("lists tasks and preserves cancelled tasks as terminal over Streamable HTTP sessions", async () => {
    const completion = createDeferred<void>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async () => {
        await completion.promise;
        return VALID_SAMPLES["editor.state.read"].output;
      })
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-cancel",
      capabilities: {}
    });

    const taskCreated = await createHttpJsonTask<{
      taskId: string;
      status: string;
    }>(session, {
      requestId: "tools-call-http-task-cancel",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });
    const taskId = taskCreated.taskId;

    expect(taskCreated.json.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working"
    });

    const listedWorkingTasks = await listHttpTasks<{
      taskId: string;
      status: string;
    }>(session, {
      requestId: "tasks-list-http-task-working"
    });
    expect(listedWorkingTasks.json).toMatchObject({
      result: {
        tasks: expect.arrayContaining([
          expect.objectContaining({
            taskId,
            status: "working"
          })
        ])
      }
    });

    const cancelledTask = await cancelHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-cancel-http-task"
    });
    expect(cancelledTask.json).toMatchObject({
      result: {
        taskId,
        status: "cancelled"
      }
    });

    const cancelledTaskStatus = await getHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-get-http-task-cancelled"
    });
    expect(cancelledTaskStatus.json).toMatchObject({
      result: {
        taskId,
        status: "cancelled"
      }
    });

    const listedCancelledTasks = await listHttpTasks<{
      taskId: string;
      status: string;
    }>(session, {
      requestId: "tasks-list-http-task-cancelled"
    });
    expect(listedCancelledTasks.json).toMatchObject({
      result: {
        tasks: expect.arrayContaining([
          expect.objectContaining({
            taskId,
            status: "cancelled"
          })
        ])
      }
    });

    completion.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const cancelledTaskAfterCompletion = await getHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-get-http-task-cancelled-after-completion"
    });
    expect(cancelledTaskAfterCompletion.json).toMatchObject({
      result: {
        taskId,
        status: "cancelled"
      }
    });

    const repeatedCancelResponse = await callHttpJsonRpc(session, {
      requestId: "tasks-cancel-http-task-terminal",
      method: "tasks/cancel",
      params: {
        taskId
      }
    });
    await expect(
      readJson<{
        error: {
          code: number;
        };
      }>(repeatedCancelResponse)
    ).resolves.toMatchObject({
      error: {
        code: -32602
      }
    });
  });

  it("propagates cooperative cancellation signals to task adapters over Streamable HTTP", async () => {
    const cancellationObserved = createDeferred<unknown>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        const cancellationSignal = request.context?.cancellationSignal;

        if (!cancellationSignal) {
          throw new Error("Missing cancellation signal.");
        }

        cancellationSignal.throwIfAborted();

        await new Promise((_, reject) => {
          cancellationSignal.addEventListener(
            "abort",
            () => {
              cancellationObserved.resolve(cancellationSignal.reason);
              reject(
                cancellationSignal.reason instanceof Error
                  ? cancellationSignal.reason
                  : new Error("Task cancelled.")
              );
            },
            { once: true }
          );
        });
      })
    });
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-cooperative-cancel",
      capabilities: {}
    });

    const taskCreated = await createHttpJsonTask<{
      taskId: string;
      status: string;
    }>(session, {
      requestId: "tools-call-http-task-cooperative-cancel",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });
    const taskId = taskCreated.taskId;

    expect(taskCreated.json.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working"
    });

    const cancelledTask = await cancelHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-cancel-http-task-cooperative-cancel"
    });
    expect(cancelledTask.json).toMatchObject({
      result: {
        taskId,
        status: "cancelled"
      }
    });

    await expect(cancellationObserved.promise).resolves.toBeTruthy();

    const cancelledTaskStatus = await getHttpTask<{
      taskId: string;
      status: string;
    }>(session, {
      taskId,
      requestId: "tasks-get-http-task-cooperative-cancel"
    });
    expect(cancelledTaskStatus.json).toMatchObject({
      result: {
        taskId,
        status: "cancelled"
      }
    });
  });
});
