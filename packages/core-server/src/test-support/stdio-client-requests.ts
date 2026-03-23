import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { createRemoteTaskDescriptor } from "./fixtures.js";
import { expectResultMessage, type StdioHarness } from "./stdio.js";

export interface StdioRequestMessage<TParams = any> {
  id: string | number;
  method: string;
  params: TParams;
}

export async function startTaskToolCall(
  harness: StdioHarness,
  options: {
    name?: string;
    arguments?: Record<string, unknown>;
    ttl?: number;
    requestId?: string;
  }
): Promise<{
  taskId: string;
  taskCreatedResponse: {
    result: {
      task: {
        taskId: string;
      };
    };
  };
  taskResultPromise: Promise<JSONRPCMessage>;
}> {
  const taskCreatedResponse = expectResultMessage<{
    task: {
      taskId: string;
    };
  }>(
    await harness.request(
      "tools/call",
      {
        name: options.name ?? "editor.state.read",
        arguments: options.arguments ?? {},
        task: {
          ttl: options.ttl ?? 1_500
        }
      },
      options.requestId
    )
  );
  const taskId = taskCreatedResponse.result.task.taskId;
  const taskResultPromise = harness.request(
    "tasks/result",
    {
      taskId
    },
    `tasks-result-${taskId}`
  );

  return {
    taskId,
    taskCreatedResponse,
    taskResultPromise
  };
}

export async function waitForStdioRequest<TParams = any>(
  harness: StdioHarness,
  label: string,
  method: string,
  predicate?: (message: StdioRequestMessage<TParams>) => boolean
): Promise<StdioRequestMessage<TParams>> {
  const message = await harness.collector.waitFor<StdioRequestMessage<TParams>>(
    label,
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "method" in candidate &&
      candidate.method === method &&
      "id" in candidate &&
      candidate.id !== undefined &&
      "params" in candidate &&
      (predicate ? predicate(candidate as StdioRequestMessage<TParams>) : true)
  );

  if (message.id === undefined) {
    throw new Error(`Expected ${label} to include an id.`);
  }

  return message;
}

export async function resolveRemoteChildTask<TResult>(
  harness: StdioHarness,
  options: {
    initialRequest: StdioRequestMessage;
    childTaskId: string;
    finalResult: TResult;
    getLabel: string;
    resultLabel: string;
  }
): Promise<void> {
  await harness.respond(options.initialRequest.id, {
    result: {
      task: createRemoteTaskDescriptor(options.childTaskId, "working")
    }
  });

  const childTaskGetMessage = await waitForStdioRequest<{ taskId: string }>(
    harness,
    options.getLabel,
    "tasks/get",
    (message) => message.params.taskId === options.childTaskId
  );
  await harness.respond(childTaskGetMessage.id, {
    result: createRemoteTaskDescriptor(options.childTaskId, "completed")
  });

  const childTaskResultMessage = await waitForStdioRequest<{ taskId: string }>(
    harness,
    options.resultLabel,
    "tasks/result",
    (message) => message.params.taskId === options.childTaskId
  );
  await harness.respond(childTaskResultMessage.id, {
    result: options.finalResult
  });
}

export async function cancelRemoteChildTask(
  harness: StdioHarness,
  options: {
    initialRequest: StdioRequestMessage;
    childTaskId: string;
    getLabel: string;
  }
): Promise<void> {
  await harness.respond(options.initialRequest.id, {
    result: {
      task: createRemoteTaskDescriptor(options.childTaskId, "working")
    }
  });

  const childTaskGetMessage = await waitForStdioRequest<{ taskId: string }>(
    harness,
    options.getLabel,
    "tasks/get",
    (message) => message.params.taskId === options.childTaskId
  );
  await harness.respond(childTaskGetMessage.id, {
    result: createRemoteTaskDescriptor(options.childTaskId, "cancelled")
  });
}
