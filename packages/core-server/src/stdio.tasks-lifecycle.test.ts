import { afterEach, describe, expect, it } from "vitest";

import { VALID_SAMPLES, createDeferred, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createHarness,
  expectResultMessage,
  type StdioHarness
} from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio task lifecycle", () => {
  it("supports task-augmented tools/call and exposes task state/result with progress notifications", async () => {
    const completion = createDeferred<void>();
    const harness = await createHarness({
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        await request.context?.sendProgress({
          progress: 1,
          total: 2,
          message: "Task queued"
        });
        await completion.promise;
        return VALID_SAMPLES["editor.state.read"].output;
      })
    });
    openHarnesses.push(harness);

    const initializeResponse = await harness.initialize();
    expect(initializeResponse).toMatchObject({
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

    const progressNotificationPromise = harness.collector.waitFor(
      "task progress notification",
      (message: any) =>
        message.method === "notifications/progress" &&
        message.params?.progressToken === "task-progress-1"
    );

    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
        status: string;
        ttl: number;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        _meta: {
          progressToken: "task-progress-1"
        },
        task: {
          ttl: 1_500
        }
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;

    expect(taskCreatedResponse.result.task).toMatchObject({
      status: "working",
      ttl: 1_500
    });
    await expect(progressNotificationPromise).resolves.toMatchObject({
      method: "notifications/progress",
      params: {
        progressToken: "task-progress-1",
        progress: 1,
        total: 2,
        message: "Task queued"
      }
    });

    const workingTaskResponse = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/get", { taskId }));
    expect(workingTaskResponse.result).toMatchObject({
      taskId,
      status: "working"
    });

    const completedNotificationPromise = harness.collector.waitFor(
      "task completed notification",
      (message: any) =>
        message.method === "notifications/tasks/status" &&
        message.params?.taskId === taskId &&
        message.params?.status === "completed"
    );

    completion.resolve();

    await expect(completedNotificationPromise).resolves.toMatchObject({
      method: "notifications/tasks/status",
      params: {
        taskId,
        status: "completed"
      }
    });

    const taskResultResponse = expectResultMessage<{
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>(await harness.request("tasks/result", { taskId }));

    expect(taskResultResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["editor.state.read"].output
    );
    expect(taskResultResponse.result._meta).toMatchObject({
      "engine-mcp/capability": "editor.state.read",
      "engine-mcp/resultAdapter": "fake-core-server-adapter"
    });
  });

  it("adds io.modelcontextprotocol/model-immediate-response to CreateTaskResult over stdio when configured", async () => {
    const harness = await createHarness({
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
    openHarnesses.push(harness);

    await harness.initialize();

    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
        status: string;
      };
      _meta: {
        "io.modelcontextprotocol/model-immediate-response": string;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {}
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;

    expect(taskCreatedResponse.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working"
    });
    expect(taskCreatedResponse.result._meta).toMatchObject({
      "io.modelcontextprotocol/model-immediate-response": `Task ${taskId} for editor.state.read is running in the background.`
    });
  });

  it("lists tasks and preserves cancelled tasks as terminal over stdio", async () => {
    const completion = createDeferred<void>();
    const harness = await createHarness({
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
    openHarnesses.push(harness);

    await harness.initialize();

    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {
          ttl: 1_500
        }
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;

    const listedWorkingTasks = expectResultMessage<{
      tasks: Array<{
        taskId: string;
        status: string;
      }>;
      nextCursor?: string;
    }>(await harness.request("tasks/list", {}));
    expect(listedWorkingTasks.result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId,
          status: "working"
        })
      ])
    );
    expect(listedWorkingTasks.result.nextCursor).toBeUndefined();

    const cancelledTaskResponse = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/cancel", { taskId }));
    expect(cancelledTaskResponse.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    const cancelledTaskStatus = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/get", { taskId }));
    expect(cancelledTaskStatus.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    const listedCancelledTasks = expectResultMessage<{
      tasks: Array<{
        taskId: string;
        status: string;
      }>;
    }>(await harness.request("tasks/list", {}));
    expect(listedCancelledTasks.result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId,
          status: "cancelled"
        })
      ])
    );

    completion.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const cancelledTaskAfterCompletion = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/get", { taskId }));
    expect(cancelledTaskAfterCompletion.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    const repeatedCancelResponse = await harness.request("tasks/cancel", { taskId });
    expect(repeatedCancelResponse).toMatchObject({
      error: {
        code: -32602
      }
    });
  });

  it("propagates cooperative cancellation signals to task adapters over stdio", async () => {
    const cancellationObserved = createDeferred<unknown>();
    const harness = await createHarness({
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
    openHarnesses.push(harness);

    await harness.initialize();

    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
        status: string;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {
          ttl: 1_500
        }
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;

    expect(taskCreatedResponse.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working"
    });

    const cancelledTaskResponse = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/cancel", { taskId }));
    expect(cancelledTaskResponse.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    await expect(cancellationObserved.promise).resolves.toBeTruthy();

    const cancelledTaskStatus = expectResultMessage<{
      taskId: string;
      status: string;
    }>(await harness.request("tasks/get", { taskId }));
    expect(cancelledTaskStatus.result).toMatchObject({
      taskId,
      status: "cancelled"
    });
  });
});
