import {
  CreateMessageResultSchema,
  ElicitResultSchema,
  ListRootsResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  VALID_SAMPLES,
  createDeferred,
  createFakeAdapter,
  createRemoteTaskDescriptor
} from "./test-support/fixtures.js";
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

describe("@engine-mcp/core-server stdio mixed flows", () => {
  it("preserves mixed queued message ordering across notification, roots/list, sampling, and final result over stdio", async () => {
    const harness = await createHarness({
      clientCapabilities: {
        roots: {},
        sampling: {}
      },
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        const taskContext = request.context;
        if (!taskContext?.sendNotification || !taskContext.sendRequest) {
          throw new Error("Missing task messaging helpers.");
        }

        await taskContext.sendNotification({
          method: "notifications/message",
          params: {
            level: "info",
            data: "Preparing workspace context."
          }
        });

        const rootsResult = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };
        const samplingResult = (await taskContext.sendRequest(
          {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: "Return the final workspace name."
                  }
                }
              ],
              maxTokens: 32
            }
          },
          CreateMessageResultSchema
        )) as {
          content: {
            type: string;
            text?: string;
          };
        };

        return {
          ...VALID_SAMPLES["editor.state.read"].output,
          workspaceName:
            samplingResult.content.type === "text" &&
            typeof samplingResult.content.text === "string"
              ? `${rootsResult.roots[0]?.name ?? "Unknown"}:${samplingResult.content.text}`
              : VALID_SAMPLES["editor.state.read"].output.workspaceName
        };
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
    const taskResultPromise = harness.request(
      "tasks/result",
      {
        taskId
      },
      "tasks-result-stdio-mixed-queue-order"
    );

    const notificationMessage = await harness.collector.waitFor(
      "mixed queue notification",
      (message: any) =>
        message.method === "notifications/message" &&
        message.params?.data === "Preparing workspace context."
    );
    expect(notificationMessage).toMatchObject({
      method: "notifications/message",
      params: {
        data: "Preparing workspace context.",
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });

    const rootsRequestMessage = await harness.collector.waitFor(
      "mixed queue roots request",
      (message: any) => message.method === "roots/list"
    );
    expect(rootsRequestMessage).toMatchObject({
      method: "roots/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });
    if (!("id" in rootsRequestMessage) || rootsRequestMessage.id === undefined) {
      throw new Error("Expected the queued roots request to include an id.");
    }

    await harness.respond(rootsRequestMessage.id, {
      result: {
        roots: [
          {
            uri: "file:///workspace/sandbox",
            name: "SandboxRoot"
          }
        ]
      }
    });

    const samplingRequestMessage = await harness.collector.waitFor(
      "mixed queue sampling request",
      (message: any) => message.method === "sampling/createMessage"
    );
    expect(samplingRequestMessage).toMatchObject({
      method: "sampling/createMessage",
      params: {
        maxTokens: 32,
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });
    if (!("id" in samplingRequestMessage) || samplingRequestMessage.id === undefined) {
      throw new Error("Expected the queued sampling request to include an id.");
    }

    await harness.respond(samplingRequestMessage.id, {
      result: {
        model: "gpt-5.4-mini",
        role: "assistant",
        content: {
          type: "text",
          text: "SampledWorkspace"
        },
        stopReason: "endTurn"
      }
    });

    const taskResultResponse = expectResultMessage(await taskResultPromise);
    const notificationIndex = harness.collector.messages.findIndex(
      (message: any) =>
        message.method === "notifications/message" &&
        message.params?.data === "Preparing workspace context."
    );
    const rootsIndex = harness.collector.messages.findIndex(
      (message: any) => message.method === "roots/list"
    );
    const samplingIndex = harness.collector.messages.findIndex(
      (message: any) => message.method === "sampling/createMessage"
    );

    expect(notificationIndex).toBeGreaterThanOrEqual(0);
    expect(rootsIndex).toBeGreaterThan(notificationIndex);
    expect(samplingIndex).toBeGreaterThan(rootsIndex);
    expect(taskResultResponse.result.structuredContent).toMatchObject({
      ...VALID_SAMPLES["editor.state.read"].output,
      workspaceName: "SandboxRoot:SampledWorkspace"
    });
    expect(taskResultResponse.result._meta).toMatchObject({
      "engine-mcp/capability": "editor.state.read",
      "io.modelcontextprotocol/related-task": {
        taskId
      }
    });
  });

  it("cancels mixed queued notification, URL-mode elicitation, roots/list, and pending sampling over stdio", async () => {
    const elicitationId = "mixed-task-url-elicitation-stdio-001";
    const cancellationObserved = createDeferred<unknown>();
    const harness = await createHarness({
      clientCapabilities: {
        elicitation: {
          url: {}
        },
        roots: {},
        sampling: {},
        tasks: {
          requests: {
            elicitation: {
              create: {}
            },
            sampling: {
              createMessage: {}
            }
          }
        }
      },
      experimentalTasks: {
        enabled: true,
        defaultTtlMs: 5_000,
        defaultPollIntervalMs: 25
      },
      adapter: createFakeAdapter(["editor.state.read"], async (request) => {
        const taskContext = request.context;
        if (
          !taskContext?.cancellationSignal ||
          !taskContext.sendNotification ||
          !taskContext.sendRequest ||
          !taskContext.createElicitationCompletionNotifier
        ) {
          throw new Error("Missing mixed task-side helpers.");
        }

        taskContext.cancellationSignal.addEventListener(
          "abort",
          () => {
            cancellationObserved.resolve(taskContext.cancellationSignal?.reason);
          },
          { once: true }
        );

        await taskContext.sendNotification({
          method: "notifications/message",
          params: {
            level: "info",
            data: "Preparing mixed cancellation chain."
          }
        });

        const notifyCompletion = taskContext.createElicitationCompletionNotifier(elicitationId);
        const elicitationResult = (await taskContext.sendRequest(
          {
            method: "elicitation/create",
            params: {
              mode: "url",
              elicitationId,
              url: "https://mcp.example.com/ui/confirm",
              message: "Complete the out-of-band confirmation flow."
            }
          },
          ElicitResultSchema
        )) as {
          action: string;
        };
        if (elicitationResult.action === "accept") {
          await notifyCompletion();
        }

        await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        );
        await taskContext.sendRequest(
          {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: "Return the final workspace name."
                  }
                }
              ],
              maxTokens: 32
            }
          },
          CreateMessageResultSchema
        );

        throw new Error("Expected parent task cancellation before sampling resolved.");
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
    const taskResultPromise = harness.request(
      "tasks/result",
      {
        taskId
      },
      "tasks-result-stdio-mixed-cancel-chain"
    );
    void taskResultPromise.catch(() => undefined);

    await expect(
      harness.collector.waitFor(
        "mixed cancellation notification",
        (message: any) =>
          message.method === "notifications/message" &&
          message.params?.data === "Preparing mixed cancellation chain."
      )
    ).resolves.toMatchObject({
      method: "notifications/message",
      params: {
        data: "Preparing mixed cancellation chain.",
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });

    const elicitationRequestMessage = await harness.collector.waitFor(
      "mixed cancellation url elicitation request",
      (message: any) =>
        message.method === "elicitation/create" &&
        message.params?.mode === "url"
    );
    expect(elicitationRequestMessage).toMatchObject({
      method: "elicitation/create",
      params: {
        mode: "url",
        elicitationId,
        task: {},
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });
    if (!("id" in elicitationRequestMessage) || elicitationRequestMessage.id === undefined) {
      throw new Error("Expected the mixed URL elicitation request to include an id.");
    }

    const childElicitationTaskId = "client-mixed-url-elicitation-stdio";
    await harness.respond(elicitationRequestMessage.id, {
      result: {
        task: createRemoteTaskDescriptor(childElicitationTaskId, "working")
      }
    });

    const childTaskGetMessage = await harness.collector.waitFor(
      "mixed cancellation child tasks/get request",
      (message: any) =>
        message.method === "tasks/get" &&
        message.params?.taskId === childElicitationTaskId
    );
    if (!("id" in childTaskGetMessage) || childTaskGetMessage.id === undefined) {
      throw new Error("Expected the mixed child tasks/get request to include an id.");
    }

    await harness.respond(childTaskGetMessage.id, {
      result: createRemoteTaskDescriptor(childElicitationTaskId, "completed")
    });

    const childTaskResultMessage = await harness.collector.waitFor(
      "mixed cancellation child tasks/result request",
      (message: any) =>
        message.method === "tasks/result" &&
        message.params?.taskId === childElicitationTaskId
    );
    if (!("id" in childTaskResultMessage) || childTaskResultMessage.id === undefined) {
      throw new Error("Expected the mixed child tasks/result request to include an id.");
    }

    await harness.respond(childTaskResultMessage.id, {
      result: {
        action: "accept"
      }
    });

    await expect(
      harness.collector.waitFor(
        "mixed cancellation completion notification",
        (message: any) =>
          message.method === "notifications/elicitation/complete" &&
          message.params?.elicitationId === elicitationId
      )
    ).resolves.toMatchObject({
      method: "notifications/elicitation/complete",
      params: {
        elicitationId,
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });

    const rootsRequestMessage = await harness.collector.waitFor(
      "mixed cancellation roots request",
      (message: any) => message.method === "roots/list"
    );
    expect(rootsRequestMessage).toMatchObject({
      method: "roots/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });
    if (!("id" in rootsRequestMessage) || rootsRequestMessage.id === undefined) {
      throw new Error("Expected the mixed roots request to include an id.");
    }

    await harness.respond(rootsRequestMessage.id, {
      result: {
        roots: [
          {
            uri: "file:///workspace/sandbox",
            name: "SandboxRoot"
          }
        ]
      }
    });

    const samplingRequestMessage = await harness.collector.waitFor(
      "mixed cancellation sampling request",
      (message: any) => message.method === "sampling/createMessage"
    );
    expect(samplingRequestMessage).toMatchObject({
      method: "sampling/createMessage",
      params: {
        task: {},
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      }
    });

    const cancelledTaskResponse = expectResultMessage(
      await harness.request(
        "tasks/cancel",
        {
          taskId
        },
        "tasks-cancel-stdio-mixed-cancel-chain"
      )
    );
    expect(cancelledTaskResponse.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    await expect(cancellationObserved.promise).resolves.toBeTruthy();

    const cancelledTaskStatus = expectResultMessage(
      await harness.request(
        "tasks/get",
        {
          taskId
        },
        "tasks-get-stdio-mixed-cancel-chain"
      )
    );
    expect(cancelledTaskStatus.result).toMatchObject({
      taskId,
      status: "cancelled"
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      harness.collector.messages.filter((message: any) => message.method === "tasks/get")
    ).toHaveLength(1);
    expect(
      harness.collector.messages.filter((message: any) => message.method === "tasks/result")
    ).toHaveLength(1);
  });
});
