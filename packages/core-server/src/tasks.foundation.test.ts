import type {
  QueuedMessage,
  TaskMessageQueue,
  TaskStore
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EXPERIMENTAL_TASK_TTL_MS,
  DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS,
  DEFAULT_IN_MEMORY_TASK_MESSAGE_RETENTION_MS,
  createInMemoryTaskMessageQueue
} from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createHarness,
  expectResultMessage,
  type StdioHarness
} from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  vi.useRealTimers();

  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server task defaults and in-memory queue", () => {
  it("applies the default experimental task TTL when the caller does not override it", async () => {
    const harness = await createHarness({
      experimentalTasks: {
        enabled: true
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
        ttl: number;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {}
      })
    );

    expect(taskCreatedResponse.result.task).toMatchObject({
      taskId: expect.any(String),
      status: "working",
      ttl: DEFAULT_EXPERIMENTAL_TASK_TTL_MS
    });
  });

  it("passes the configured default TTL through to a custom taskStore and requires a bounded ttl in the returned task", async () => {
    const createTask = vi.fn<TaskStore["createTask"]>(async (taskParams) => ({
      taskId: "custom-task-1",
      status: "working",
      ttl: taskParams.ttl ?? null,
      createdAt: "2026-03-22T00:00:00.000Z",
      lastUpdatedAt: "2026-03-22T00:00:00.000Z",
      pollInterval: taskParams.pollInterval ?? 1_000
    }));
    const customTaskStore: TaskStore = {
      createTask,
      getTask: async () => null,
      storeTaskResult: async () => undefined,
      getTaskResult: async () => {
        throw new Error("not implemented");
      },
      updateTaskStatus: async () => undefined,
      listTasks: async () => ({
        tasks: []
      })
    };
    const harness = await createHarness({
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 12_345,
        taskStore: customTaskStore,
        taskMessageQueue: createInMemoryTaskMessageQueue()
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
        ttl: number;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {}
      })
    );

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ttl: 12_345
      }),
      expect.anything(),
      expect.anything(),
      undefined
    );
    expect(taskCreatedResponse.result.task).toMatchObject({
      taskId: "custom-task-1",
      ttl: 12_345
    });
  });

  it("fails task creation when a custom taskStore drops a bounded ttl request", async () => {
    const customTaskStore: TaskStore = {
      createTask: async (taskParams) => ({
        taskId: "custom-task-unbounded",
        status: "working",
        ttl: taskParams.ttl === null ? null : null,
        createdAt: "2026-03-22T00:00:00.000Z",
        lastUpdatedAt: "2026-03-22T00:00:00.000Z",
        pollInterval: taskParams.pollInterval ?? 1_000
      }),
      getTask: async () => null,
      storeTaskResult: async () => undefined,
      getTaskResult: async () => {
        throw new Error("not implemented");
      },
      updateTaskStatus: async () => undefined,
      listTasks: async () => ({
        tasks: []
      })
    };
    const harness = await createHarness({
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        taskStore: customTaskStore,
        taskMessageQueue: createInMemoryTaskMessageQueue()
      },
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });
    openHarnesses.push(harness);

    await harness.initialize();

    const taskCreatedResponse = await harness.request("tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input,
      task: {}
    });

    expect(taskCreatedResponse).toMatchObject({
      error: {
        code: -32603
      }
    });
    expect(
      "error" in taskCreatedResponse ? taskCreatedResponse.error.message : ""
    ).toContain("Task store contract violation: bounded tasks must report a bounded ttl.");
  });

  it("calls custom taskStore and taskMessageQueue cleanup hooks on runtime close when they are provided", async () => {
    const taskStoreCleanup = vi.fn();
    const taskMessageQueueCleanup = vi.fn();
    const customTaskStore: TaskStore & { cleanup(): void } = {
      createTask: async () => ({
        taskId: "cleanup-task",
        status: "working",
        ttl: 1_000,
        createdAt: "2026-03-22T00:00:00.000Z",
        lastUpdatedAt: "2026-03-22T00:00:00.000Z",
        pollInterval: 25
      }),
      getTask: async () => null,
      storeTaskResult: async () => undefined,
      getTaskResult: async () => {
        throw new Error("not implemented");
      },
      updateTaskStatus: async () => undefined,
      listTasks: async () => ({
        tasks: []
      }),
      cleanup: taskStoreCleanup
    };
    const customTaskMessageQueue: TaskMessageQueue & { cleanup(): void } = {
      enqueue: async () => undefined,
      dequeue: async () => undefined,
      dequeueAll: async () => [],
      cleanup: taskMessageQueueCleanup
    };
    const harness = await createHarness({
      experimentalTasks: {
        enabled: true,
        taskStore: customTaskStore,
        taskMessageQueue: customTaskMessageQueue
      },
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });

    await harness.close();

    expect(taskStoreCleanup).toHaveBeenCalledTimes(1);
    expect(taskMessageQueueCleanup).toHaveBeenCalledTimes(1);
  });

  it("periodically prunes expired queued task-side messages and clears retained state on cleanup", async () => {
    let now = 0;
    vi.useFakeTimers();

    expect(DEFAULT_IN_MEMORY_TASK_MESSAGE_RETENTION_MS).toBeGreaterThan(0);
    expect(DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS).toBeGreaterThan(0);

    const queue = createInMemoryTaskMessageQueue({
      maxMessageAgeMs: 100,
      pruneIntervalMs: 10,
      now: () => now
    });
    const taskId = "task-retention";
    const firstMessage = {
      type: "notification",
      timestamp: 0,
      message: {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          text: "first"
        }
      }
    } satisfies QueuedMessage;
    const secondMessage = {
      type: "notification",
      timestamp: 50,
      message: {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          text: "second"
        }
      }
    } satisfies QueuedMessage;
    const thirdMessage = {
      type: "notification",
      timestamp: 130,
      message: {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          text: "third"
        }
      }
    } satisfies QueuedMessage;

    await queue.enqueue(taskId, firstMessage);

    now = 50;
    await queue.enqueue(taskId, secondMessage);

    now = 120;
    await vi.advanceTimersByTimeAsync(120);

    await expect(queue.dequeue(taskId)).resolves.toEqual(secondMessage);
    await expect(queue.dequeue(taskId)).resolves.toBeUndefined();

    now = 130;
    await queue.enqueue(taskId, thirdMessage);

    queue.cleanup();

    await expect(queue.dequeueAll(taskId)).resolves.toEqual([]);
  });
});
