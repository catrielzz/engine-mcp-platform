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

describe("@engine-mcp/core-server stdio elicitation", () => {
    it("delivers queued task messages through tasks/result and marks the task input_required over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {}
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
                        data: "Awaiting workspace name."
                    }
                });
                const elicitationResult = await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name",
                                    description: "Displayed in editor.state.read."
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: elicitationResult.action === "accept" &&
                        typeof elicitationResult.content?.workspaceName === "string"
                        ? elicitationResult.content.workspaceName
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-input-required"
        });
        await expect(harness.collector.waitFor("task input_required notification", (message) => "method" in message &&
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
        await expect(harness.collector.waitFor("queued task notification", (message) => "method" in message &&
            message.method === "notifications/message" &&
            "params" in message &&
            message.params._meta?.["io.modelcontextprotocol/related-task"] !== undefined)).resolves.toMatchObject({
            method: "notifications/message",
            params: {
                level: "info",
                data: "Awaiting workspace name.",
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        const elicitationRequestMessage = await waitForStdioRequest(harness, "queued elicitation request", "elicitation/create", (message) => message.params._meta?.["io.modelcontextprotocol/related-task"] !== undefined);
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                message: "Provide the workspace name to report back to Codex.",
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        const inputRequiredTaskResponse = expectResultMessage(await harness.request("tasks/get", {
            taskId
        }));
        expect(inputRequiredTaskResponse.result).toMatchObject({
            taskId,
            status: "input_required"
        });
        if (!("id" in elicitationRequestMessage) || elicitationRequestMessage.id === undefined) {
            throw new Error("Expected the queued elicitation request to include an id.");
        }
        await harness.respond(elicitationRequestMessage.id, {
            result: {
                action: "accept",
                content: {
                    workspaceName: "SandboxViaTaskMessage"
                }
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxViaTaskMessage"
        });
        expect(taskResultResponse.result._meta).toMatchObject({
            "engine-mcp/capability": "editor.state.read",
            "io.modelcontextprotocol/related-task": {
                taskId
            }
        });
    });

    it("uses task-augmented elicitation/create when the client advertises tasks.requests.elicitation.create over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
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
                const elicitationResult = await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name"
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: elicitationResult.action === "accept" &&
                        typeof elicitationResult.content?.workspaceName === "string"
                        ? elicitationResult.content.workspaceName
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-task-augmented-elicitation"
        });
        const elicitationRequestMessage = await waitForStdioRequest(harness, "task-augmented elicitation request", "elicitation/create", (message) => Boolean(message.params.task &&
                message.params._meta?.["io.modelcontextprotocol/related-task"]));
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                mode: "form",
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        await resolveRemoteChildTask(harness, {
            initialRequest: elicitationRequestMessage,
            childTaskId: "client-elicitation-task-stdio",
            getLabel: "child tasks/get request for elicitation",
            resultLabel: "child tasks/result request for elicitation",
            finalResult: {
                action: "accept",
                content: {
                    workspaceName: "SandboxFromAugmentedElicitation"
                }
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromAugmentedElicitation"
        });
    });

    it("fails task-side elicitation child requests with client_request_timeout over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
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
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name"
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                throw new Error("The timed out child task unexpectedly resolved.");
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const { taskId, taskResultPromise } = await startTaskToolCall(harness, {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            requestId: "tools-call-stdio-task-augmented-elicitation-timeout"
        });
        const elicitationRequestMessage = await waitForStdioRequest(
            harness,
            "task-augmented elicitation request that will time out",
            "elicitation/create"
        );
        await harness.respond(elicitationRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor("client-elicitation-task-timeout-stdio", "working")
            }
        });
        await waitForStdioRequest<{ taskId: string }>(
            harness,
            "child tasks/get request for timed out elicitation task",
            "tasks/get",
            (message) => message.params.taskId === "client-elicitation-task-timeout-stdio"
        );
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.isError).toBe(true);
        expect(taskResultResponse.result.structuredContent.error).toMatchObject({
            code: "client_request_timeout",
            message: "Client request timed out while waiting for elicitation/create.",
            details: {
                method: "elicitation/create",
                timeoutMs: 50,
                relatedTaskId: taskId
            }
        });
        const failedTaskResponse = expectResultMessage<{ taskId: string; status: string; statusMessage?: string }>(
            await harness.request(
                "tasks/get",
                { taskId },
                "tasks-get-stdio-task-augmented-elicitation-timeout"
            )
        );
        expect(failedTaskResponse.result).toMatchObject({
            taskId,
            status: "failed"
        });
    });

    it("surfaces task-side elicitation queue overflow as task_message_queue_overflow over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {}
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
                        data: "prefill queue before elicitation overflow"
                    }
                });
                await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name"
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                throw new Error("Elicitation overflow should have failed before resolution.");
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
                "tools-call-stdio-elicitation-overflow"
            )
        );
        const taskId = taskCreatedResponse.result.task.taskId;
        const taskResultPromise = harness.request(
            "tasks/result",
            {
                taskId
            },
            "tasks-result-stdio-elicitation-overflow"
        );
        await expect(
            harness.collector.waitFor(
                "queued notification before elicitation overflow",
                (message) =>
                    "method" in message &&
                    message.method === "notifications/message" &&
                    "params" in message &&
                    message.params.data === "prefill queue before elicitation overflow"
            )
        ).resolves.toMatchObject({
            method: "notifications/message",
            params: {
                data: "prefill queue before elicitation overflow",
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
            message: "Task message queue overflow while queueing elicitation/create.",
            details: {
                method: "elicitation/create",
                relatedTaskId: taskId,
                queueSize: 1,
                maxQueueSize: 1
            }
        });
    });

    it("uses task-augmented elicitation/create without a parent task and preserves decline over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
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
                const elicitationResult = await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name"
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: elicitationResult.action === "accept"
                        ? (elicitationResult.content?.workspaceName ??
                            VALID_SAMPLES["editor.state.read"].output.workspaceName)
                        : elicitationResult.action === "decline"
                            ? "DeclinedByClient"
                            : elicitationResult.action === "cancel"
                                ? "CancelledByClient"
                                : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const toolCallPromise = harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-direct-task-augmented-elicitation-decline");
        const elicitationRequestMessage = await waitForStdioRequest(harness, "direct task-augmented elicitation request for decline", "elicitation/create", (message) => Boolean(message.params.task) &&
            message.params._meta?.["io.modelcontextprotocol/related-task"] === undefined);
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                mode: "form",
                task: {}
            }
        });
        await resolveRemoteChildTask(harness, {
            initialRequest: elicitationRequestMessage,
            childTaskId: "client-direct-elicitation-decline-task-stdio",
            getLabel: "direct child tasks/get request for declined elicitation",
            resultLabel: "direct child tasks/result request for declined elicitation",
            finalResult: {
                action: "decline"
            }
        });
        const toolCallResponse = expectResultMessage(await toolCallPromise);
        expect(toolCallResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "DeclinedByClient"
        });
    });

    it("uses task-augmented elicitation/create without a parent task and preserves cancel over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
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
                const elicitationResult = await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: "Provide the workspace name to report back to Codex.",
                        requestedSchema: {
                            type: "object",
                            properties: {
                                workspaceName: {
                                    type: "string",
                                    title: "Workspace name"
                                }
                            },
                            required: ["workspaceName"]
                        }
                    }
                }, ElicitResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: elicitationResult.action === "accept"
                        ? (elicitationResult.content?.workspaceName ??
                            VALID_SAMPLES["editor.state.read"].output.workspaceName)
                        : elicitationResult.action === "decline"
                            ? "DeclinedByClient"
                            : elicitationResult.action === "cancel"
                                ? "CancelledByClient"
                                : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const toolCallPromise = harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-direct-task-augmented-elicitation-cancel");
        const elicitationRequestMessage = await waitForStdioRequest(harness, "direct task-augmented elicitation request for cancel", "elicitation/create", (message) => Boolean(message.params.task) &&
            message.params._meta?.["io.modelcontextprotocol/related-task"] === undefined);
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                mode: "form",
                task: {}
            }
        });
        await resolveRemoteChildTask(harness, {
            initialRequest: elicitationRequestMessage,
            childTaskId: "client-direct-elicitation-cancel-task-stdio",
            getLabel: "direct child tasks/get request for cancelled elicitation",
            resultLabel: "direct child tasks/result request for cancelled elicitation",
            finalResult: {
                action: "cancel"
            }
        });
        const toolCallResponse = expectResultMessage(await toolCallPromise);
        expect(toolCallResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "CancelledByClient"
        });
    });
});
