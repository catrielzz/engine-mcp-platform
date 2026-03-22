import {
  CreateMessageResultSchema,
  ElicitResultSchema,
  ListRootsResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  startCoreServerStreamableHttp,
  type EngineMcpStreamableHttpServerRuntime
} from "./index.js";
import { VALID_SAMPLES, createDeferred, createFakeAdapter } from "./test-support/fixtures.js";
import {
  callHttpJsonRpc,
  initializeHttpClientSession,
  openReplayHttpEventStream,
  resolveRemoteHttpChildTask,
  respondToHttpRequest,
  startHttpTaskToolCall,
  waitForHttpRequest
} from "./test-support/http-client-requests.js";
import { countOccurrences, createTextStreamReader } from "./test-support/http.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP mixed flows", () => {
  it("preserves mixed queued message ordering and resumes the correct tasks/result stream over Streamable HTTP", async () => {
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
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
    openServers.push(runtime);

    const { session, initializeBody } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-mixed-order",
      capabilities: {
        roots: {},
        sampling: {}
      }
    });
    const primingEventIdMatch = initializeBody.match(/id: (event-\d+)/);
    expect(primingEventIdMatch?.[1]).toBeTruthy();

    const { taskId, taskCreatedBody, taskCreatedResponse, streamReader, taskResultStream } =
      await startHttpTaskToolCall(session, {
        requestId: "tools-call-http-task-mixed-order",
        taskResultRequestId: "tasks-result-http-task-mixed-order",
        arguments: VALID_SAMPLES["editor.state.read"].input
      });
    expect(taskCreatedResponse.status).toBe(200);
    expect(taskCreatedResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(taskCreatedBody).toContain(`"taskId":"${taskId}"`);
    expect(taskResultStream.status).toBe(200);
    expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");

    let originalStreamClosed = false;

    try {
      const notificationBody = await streamReader.readUntil("\"method\":\"notifications/message\"");
      expect(notificationBody).toContain("\"data\":\"Preparing workspace context.\"");

      const rootsRequest = await waitForHttpRequest(streamReader, "roots/list");
      expect(
        rootsRequest.rawBody.indexOf("\"method\":\"notifications/message\"")
      ).toBeLessThan(rootsRequest.rawBody.indexOf("\"method\":\"roots/list\""));
      const rootsEventId = [...rootsRequest.rawBody.matchAll(/id: (event-\d+)/g)].at(-1)?.[1];
      expect(rootsEventId).toBeTruthy();

      await streamReader.close();
      originalStreamClosed = true;

      const replayResponse = await openReplayHttpEventStream(session, {
        lastEventId: rootsEventId ?? ""
      });
      expect(replayResponse.status).toBe(200);
      expect(replayResponse.headers.get("content-type")).toContain("text/event-stream");

      const replayReader = createTextStreamReader(replayResponse.body);
      await respondToHttpRequest(session, rootsRequest.id, {
        roots: [
          {
            uri: "file:///workspace/sandbox",
            name: "SandboxRoot"
          }
        ]
      });

      try {
        const samplingRequest = await waitForHttpRequest(replayReader, "sampling/createMessage");
        expect(samplingRequest.rawBody).not.toContain("\"data\":\"Preparing workspace context.\"");
        expect(samplingRequest.rawBody).not.toContain("\"method\":\"roots/list\"");

        await respondToHttpRequest(session, samplingRequest.id, {
          model: "gpt-5.4-mini",
          role: "assistant",
          content: {
            type: "text",
            text: "SampledWorkspace"
          },
          stopReason: "endTurn"
        });

        const finalReplayBody = await replayReader.readUntil("\"structuredContent\"");
        expect(
          finalReplayBody.indexOf("\"method\":\"sampling/createMessage\"")
        ).toBeLessThan(finalReplayBody.indexOf("\"structuredContent\""));
        expect(finalReplayBody).toContain("\"workspaceName\":\"SandboxRoot:SampledWorkspace\"");
        expect(finalReplayBody).toContain("\"id\":\"tasks-result-http-task-mixed-order\"");
      } finally {
        await replayReader.close();
      }
    } finally {
      if (!originalStreamClosed) {
        await streamReader.close();
      }
    }
  });

  it("cancels mixed queued notification, URL-mode elicitation, roots/list, and pending sampling over Streamable HTTP", async () => {
    const elicitationId = "mixed-task-url-elicitation-http-001";
    const cancellationObserved = createDeferred<unknown>();
    const runtime = await startCoreServerStreamableHttp({
      port: 0,
      enableJsonResponse: false,
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
    openServers.push(runtime);

    const { session } = await initializeHttpClientSession(runtime, {
      requestId: "init-http-task-mixed-cancel",
      capabilities: {
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
      }
    });

    const { taskId, streamReader, taskResultStream } = await startHttpTaskToolCall(session, {
      requestId: "tools-call-http-task-mixed-cancel",
      taskResultRequestId: "tasks-result-http-task-mixed-cancel",
      arguments: VALID_SAMPLES["editor.state.read"].input
    });
    expect(taskId).toBeTruthy();
    expect(taskResultStream.status).toBe(200);
    expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");

    try {
      const notificationBody = await streamReader.readUntil("\"method\":\"notifications/message\"");
      expect(notificationBody).toContain("\"data\":\"Preparing mixed cancellation chain.\"");
      expect(notificationBody).toContain(`\"taskId\":\"${taskId}\"`);

      const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
      expect(elicitationRequest.params).toMatchObject({
        mode: "url",
        elicitationId,
        task: {},
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      });

      await resolveRemoteHttpChildTask(session, {
        streamReader,
        initialRequest: elicitationRequest,
        childTaskId: "client-http-mixed-url-elicitation",
        finalResult: {
          action: "accept"
        }
      });

      const completionBody = await streamReader.readUntil(
        "\"method\":\"notifications/elicitation/complete\""
      );
      expect(completionBody).toContain(`\"elicitationId\":\"${elicitationId}\"`);
      expect(completionBody).toContain(`\"taskId\":\"${taskId}\"`);

      const rootsRequest = await waitForHttpRequest(streamReader, "roots/list");
      expect(rootsRequest.params).toMatchObject({
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      });
      await respondToHttpRequest(session, rootsRequest.id, {
        roots: [
          {
            uri: "file:///workspace/sandbox",
            name: "SandboxRoot"
          }
        ]
      });

      const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
      expect(samplingRequest.params).toMatchObject({
        task: {},
        _meta: {
          "io.modelcontextprotocol/related-task": {
            taskId
          }
        }
      });

      const cancelledTask = await callHttpJsonRpc(session, {
        requestId: "tasks-cancel-http-task-mixed-cancel",
        method: "tasks/cancel",
        params: {
          taskId
        }
      });
      await expect(cancelledTask.text()).resolves.toContain("\"status\":\"cancelled\"");
      await expect(cancellationObserved.promise).resolves.toBeTruthy();

      const cancelledTaskStatus = await callHttpJsonRpc(session, {
        requestId: "tasks-get-http-task-mixed-cancel",
        method: "tasks/get",
        params: {
          taskId
        }
      });
      await expect(cancelledTaskStatus.text()).resolves.toContain("\"status\":\"cancelled\"");

      const finalBody = await streamReader.readUntil("\"id\":\"tasks-result-http-task-mixed-cancel\"");
      expect(countOccurrences(finalBody, "\"method\":\"tasks/get\"")).toBe(1);
      expect(finalBody).toContain("has no result stored");
    } finally {
      await streamReader.close();
    }
  });
});
