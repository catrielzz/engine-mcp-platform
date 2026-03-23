import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  VALID_SAMPLES,
  createFakeAdapter,
  createRemoteTaskDescriptor
} from "./test-support/fixtures.js";
import {
  cancelRemoteChildTask,
  resolveRemoteChildTask,
  startTaskToolCall,
  waitForStdioRequest
} from "./test-support/stdio-client-requests.js";
import { createHarness, expectResultMessage, type StdioHarness } from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio sampling", () => {
    it("delivers queued sampling requests through tasks/result over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {}
            },
            experimentalTasks: {
                enabled: true,
                defaultTtlMs: 5_000,
                defaultPollIntervalMs: 25
            },
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const taskContext = request.context;
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const samplingResult = await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: samplingResult.content.type === "text" &&
                        typeof samplingResult.content.text === "string"
                        ? samplingResult.content.text
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-sampling"
        });
        await expect(harness.collector.waitFor("task input_required notification for sampling", (message) => "method" in message &&
            message.method === "notifications/tasks/status" &&
            "params" in message &&
            message.params.taskId === taskId &&
            message.params.status === "input_required")).resolves.toMatchObject({
            method: "notifications/tasks/status",
            params: {
                taskId,
                status: "input_required"
            }
        });
        const samplingRequestMessage = await waitForStdioRequest(harness, "queued sampling request", "sampling/createMessage", (message) => message.params._meta?.["io.modelcontextprotocol/related-task"] !== undefined);
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
                    text: "SandboxFromSampling"
                },
                stopReason: "endTurn"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromSampling"
        });
        expect(taskResultResponse.result._meta).toMatchObject({
            "engine-mcp/capability": "editor.state.read",
            "io.modelcontextprotocol/related-task": {
                taskId
            }
        });
    });

    it("uses task-augmented sampling/createMessage when the client advertises tasks.requests.sampling.createMessage over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {},
                tasks: {
                    requests: {
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
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const samplingResult = await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: samplingResult.content.type === "text" &&
                        typeof samplingResult.content.text === "string"
                        ? samplingResult.content.text
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-task-augmented-sampling"
        });
        const samplingRequestMessage = await waitForStdioRequest(harness, "task-augmented sampling request", "sampling/createMessage", (message) => Boolean(message.params.task &&
                message.params._meta?.["io.modelcontextprotocol/related-task"]));
        expect(samplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 32,
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        await resolveRemoteChildTask(harness, {
            initialRequest: samplingRequestMessage,
            childTaskId: "client-sampling-task-stdio",
            getLabel: "child tasks/get request for sampling",
            resultLabel: "child tasks/result request for sampling",
            finalResult: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromAugmentedSampling"
                },
                stopReason: "endTurn"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromAugmentedSampling"
        });
    });

    it("surfaces cancelled task-augmented client requests as tool failures over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {},
                tasks: {
                    requests: {
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
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                throw new Error("The cancelled child task unexpectedly resolved.");
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-task-augmented-cancelled"
        });
        const samplingRequestMessage = await waitForStdioRequest(harness, "task-augmented sampling request that will cancel", "sampling/createMessage");
        await cancelRemoteChildTask(harness, {
            initialRequest: samplingRequestMessage,
            childTaskId: "client-sampling-task-cancelled-stdio",
            getLabel: "child tasks/get request for cancelled sampling task"
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.isError).toBe(true);
        expect(taskResultResponse.result.structuredContent.error.code).toBe("internal_error");
        expect(taskResultResponse.result.structuredContent.error.message).toContain("cancelled");
    });

    it("fails task-side sampling child requests with client_request_timeout over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {},
                tasks: {
                    requests: {
                        sampling: {
                            createMessage: {}
                        }
                    }
                }
            },
            experimentalTasks: {
                enabled: true,
                defaultTtlMs: 5_000,
                defaultPollIntervalMs: 25,
                childRequestTimeoutMs: 50
            },
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const taskContext = request.context;
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                throw new Error("The timed out child task unexpectedly resolved.");
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-task-augmented-timeout"
        });
        const samplingRequestMessage = await waitForStdioRequest(
            harness,
            "task-augmented sampling request that will time out",
            "sampling/createMessage"
        );
        await harness.respond(samplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor("client-sampling-task-timeout-stdio", "working")
            }
        });
        await waitForStdioRequest<{ taskId: string }>(
            harness,
            "child tasks/get request for timed out sampling task",
            "tasks/get",
            (message) => message.params.taskId === "client-sampling-task-timeout-stdio"
        );
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.isError).toBe(true);
        expect(taskResultResponse.result.structuredContent.error).toMatchObject({
            code: "client_request_timeout",
            message: "Client request timed out while waiting for sampling/createMessage.",
            details: {
                method: "sampling/createMessage",
                timeoutMs: 50,
                relatedTaskId: taskId
            }
        });
        const failedTaskResponse = expectResultMessage<{ taskId: string; status: string; statusMessage?: string }>(
            await harness.request("tasks/get", { taskId }, "tasks-get-stdio-task-augmented-timeout")
        );
        expect(failedTaskResponse.result).toMatchObject({
            taskId,
            status: "failed"
        });
    });

    it("surfaces task-side sampling queue overflow as task_message_queue_overflow over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {}
            },
            experimentalTasks: {
                enabled: true,
                defaultTtlMs: 5_000,
                defaultPollIntervalMs: 25,
                maxQueueSize: 1
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
                        data: "prefill queue before sampling overflow"
                    }
                });
                await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                throw new Error("Sampling overflow should have failed before resolution.");
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const taskCreatedResponse = expectResultMessage<{
            task: {
                taskId: string;
            };
        }>(
            await harness.request(
                "tools/call",
                {
                    name: "editor.state.read",
                    arguments: VALID_SAMPLES["editor.state.read"].input,
                    task: {
                        ttl: 1_500
                    }
                },
                "tools-call-stdio-sampling-overflow"
            )
        );
        const taskId = taskCreatedResponse.result.task.taskId;
        const taskResultPromise = harness.request(
            "tasks/result",
            {
                taskId
            },
            "tasks-result-stdio-sampling-overflow"
        );
        await expect(
            harness.collector.waitFor(
                "queued notification before sampling overflow",
                (message) =>
                    "method" in message &&
                    message.method === "notifications/message" &&
                    "params" in message &&
                    message.params.data === "prefill queue before sampling overflow"
            )
        ).resolves.toMatchObject({
            method: "notifications/message",
            params: {
                data: "prefill queue before sampling overflow",
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.isError).toBe(true);
        expect(taskResultResponse.result.structuredContent.error).toMatchObject({
            code: "task_message_queue_overflow",
            message: "Task message queue overflow while queueing sampling/createMessage.",
            details: {
                method: "sampling/createMessage",
                relatedTaskId: taskId,
                queueSize: 1,
                maxQueueSize: 1
            }
        });
    });

    it("uses task-augmented sampling/createMessage without a parent task over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {},
                tasks: {
                    requests: {
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
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const samplingResult = await taskContext.sendRequest({
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
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: samplingResult.content.type === "text" &&
                        typeof samplingResult.content.text === "string"
                        ? samplingResult.content.text
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const toolCallPromise = harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-direct-task-augmented-sampling");
        const samplingRequestMessage = await waitForStdioRequest(harness, "direct task-augmented sampling request", "sampling/createMessage", (message) => Boolean(message.params.task) &&
            message.params._meta?.["io.modelcontextprotocol/related-task"] === undefined);
        expect(samplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 32,
                task: {}
            }
        });
        await resolveRemoteChildTask(harness, {
            initialRequest: samplingRequestMessage,
            childTaskId: "client-direct-sampling-task-stdio",
            getLabel: "direct child tasks/get request for sampling",
            resultLabel: "direct child tasks/result request for sampling",
            finalResult: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromDirectAugmentedSampling"
                },
                stopReason: "endTurn"
            }
        });
        const toolCallResponse = expectResultMessage(await toolCallPromise);
        expect(toolCallResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromDirectAugmentedSampling"
        });
        expect(toolCallResponse.result._meta).toMatchObject({
            "engine-mcp/capability": "editor.state.read",
            "engine-mcp/resultAdapter": "fake-core-server-adapter"
        });
    });
});
