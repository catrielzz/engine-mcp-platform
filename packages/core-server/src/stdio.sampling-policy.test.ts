import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { VALID_SAMPLES, createFakeAdapter, createRemoteTaskDescriptor } from "./test-support/fixtures.js";
import { createHarness, expectResultMessage, type StdioHarness } from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio sampling policy", () => {
    it("forces toolChoice none on the final configured sampling turn over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
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
            },
            experimentalTasks: {
                enabled: true,
                defaultTtlMs: 5_000,
                defaultPollIntervalMs: 25,
                samplingPolicy: {
                    maxTurns: 2,
                    forceToolChoiceNoneOnFinalTurn: true
                }
            },
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const taskContext = request.context;
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const toolName = "workspace_lookup";
                const firstResult = await taskContext.sendRequest({
                    method: "sampling/createMessage",
                    params: {
                        messages: [
                            {
                                role: "user",
                                content: {
                                    type: "text",
                                    text: "Use the tool and then answer."
                                }
                            }
                        ],
                        maxTokens: 64,
                        tools: [
                            {
                                name: toolName,
                                description: "Resolves the workspace name",
                                inputSchema: {
                                    type: "object"
                                }
                            }
                        ],
                        toolChoice: {
                            mode: "auto"
                        }
                    }
                }, CreateMessageResultWithToolsSchema);
                const toolUseBlock = firstResult.content.find((block: any) => block.type === "tool_use" && block.name === toolName);
                if (!toolUseBlock?.id) {
                    throw new Error("Expected first sampling turn to request a tool.");
                }
                const secondResult = await taskContext.sendRequest({
                    method: "sampling/createMessage",
                    params: {
                        messages: [
                            {
                                role: "assistant",
                                content: [
                                    {
                                        type: "tool_use",
                                        name: toolName,
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
                                                text: "SandboxFromSamplingPolicy"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ],
                        maxTokens: 64,
                        tools: [
                            {
                                name: toolName,
                                description: "Resolves the workspace name",
                                inputSchema: {
                                    type: "object"
                                }
                            }
                        ],
                        toolChoice: {
                            mode: "auto"
                        }
                    }
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: secondResult.content.type === "text" && typeof secondResult.content.text === "string"
                        ? secondResult.content.text
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const taskCreatedResponse = expectResultMessage(await harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            task: {
                ttl: 1_500
            }
        }));
        const taskId = taskCreatedResponse.result.task.taskId;
        const taskResultPromise = harness.request("tasks/result", { taskId }, "tasks-result-stdio-sampling-policy-final-tool-choice");
        const firstSamplingRequestMessage = await harness.collector.waitFor("first sampling request with policy", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.tools));
        expect(firstSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                toolChoice: {
                    mode: "auto"
                },
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        if (!("id" in firstSamplingRequestMessage) || firstSamplingRequestMessage.id === undefined) {
            throw new Error("Expected first sampling request to include an id.");
        }
        const firstChildTaskId = "client-sampling-policy-task-stdio-1";
        await harness.respond(firstSamplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(firstChildTaskId, "working")
            }
        });
        const firstChildGetMessage = await harness.collector.waitFor("first child tasks/get request for policy sampling", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildGetMessage) || firstChildGetMessage.id === undefined) {
            throw new Error("Expected first child tasks/get to include an id.");
        }
        await harness.respond(firstChildGetMessage.id, {
            result: createRemoteTaskDescriptor(firstChildTaskId, "completed")
        });
        const firstChildResultMessage = await harness.collector.waitFor("first child tasks/result request for policy sampling", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildResultMessage) || firstChildResultMessage.id === undefined) {
            throw new Error("Expected first child tasks/result to include an id.");
        }
        await harness.respond(firstChildResultMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "workspace_lookup",
                        id: "tool-use-policy-stdio-1",
                        input: {}
                    }
                ],
                stopReason: "toolUse"
            }
        });
        const secondSamplingRequestMessage = await harness.collector.waitFor("second sampling request with final-turn policy", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.tools) &&
            message.params.toolChoice?.mode === "none");
        expect(secondSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                toolChoice: {
                    mode: "none"
                },
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        if (!("id" in secondSamplingRequestMessage) || secondSamplingRequestMessage.id === undefined) {
            throw new Error("Expected second sampling request to include an id.");
        }
        const secondChildTaskId = "client-sampling-policy-task-stdio-2";
        await harness.respond(secondSamplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(secondChildTaskId, "working")
            }
        });
        const secondChildGetMessage = await harness.collector.waitFor("second child tasks/get request for policy sampling", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === secondChildTaskId);
        if (!("id" in secondChildGetMessage) || secondChildGetMessage.id === undefined) {
            throw new Error("Expected second child tasks/get to include an id.");
        }
        await harness.respond(secondChildGetMessage.id, {
            result: createRemoteTaskDescriptor(secondChildTaskId, "completed")
        });
        const secondChildResultMessage = await harness.collector.waitFor("second child tasks/result request for policy sampling", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === secondChildTaskId);
        if (!("id" in secondChildResultMessage) || secondChildResultMessage.id === undefined) {
            throw new Error("Expected second child tasks/result to include an id.");
        }
        await harness.respond(secondChildResultMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromSamplingPolicy"
                },
                stopReason: "endTurn"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromSamplingPolicy"
        });
    });

    it("fails task-side sampling when the configured iteration limit is exceeded over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
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
            },
            experimentalTasks: {
                enabled: true,
                defaultTtlMs: 5_000,
                defaultPollIntervalMs: 25,
                samplingPolicy: {
                    maxTurns: 1
                }
            },
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const taskContext = request.context;
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const firstResult = await taskContext.sendRequest({
                    method: "sampling/createMessage",
                    params: {
                        messages: [],
                        maxTokens: 64,
                        tools: [
                            {
                                name: "workspace_lookup",
                                description: "Resolves the workspace name",
                                inputSchema: {
                                    type: "object"
                                }
                            }
                        ]
                    }
                }, CreateMessageResultWithToolsSchema);
                const toolUseBlock = firstResult.content.find((block: any) => block.type === "tool_use");
                if (!toolUseBlock?.id) {
                    throw new Error("Expected first sampling turn to request a tool.");
                }
                await taskContext.sendRequest({
                    method: "sampling/createMessage",
                    params: {
                        messages: [
                            {
                                role: "assistant",
                                content: [
                                    {
                                        type: "tool_use",
                                        name: "workspace_lookup",
                                        id: toolUseBlock.id,
                                        input: {}
                                    }
                                ]
                            }
                        ],
                        maxTokens: 64,
                        tools: [
                            {
                                name: "workspace_lookup",
                                description: "Resolves the workspace name",
                                inputSchema: {
                                    type: "object"
                                }
                            }
                        ]
                    }
                }, CreateMessageResultSchema);
                throw new Error("Expected sampling iteration limit to fail before a second remote turn.");
            })
        });
        openHarnesses.push(harness);
        await harness.initialize();
        const taskCreatedResponse = expectResultMessage(await harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input,
            task: {
                ttl: 1_500
            }
        }));
        const taskId = taskCreatedResponse.result.task.taskId;
        const taskResultPromise = harness.request("tasks/result", { taskId }, "tasks-result-stdio-sampling-policy-limit");
        const firstSamplingRequestMessage = await harness.collector.waitFor("first sampling request before iteration limit", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.tools));
        if (!("id" in firstSamplingRequestMessage) || firstSamplingRequestMessage.id === undefined) {
            throw new Error("Expected first sampling request to include an id.");
        }
        const firstChildTaskId = "client-sampling-policy-limit-stdio-1";
        await harness.respond(firstSamplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(firstChildTaskId, "working")
            }
        });
        const firstChildGetMessage = await harness.collector.waitFor("first child tasks/get request before iteration limit", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildGetMessage) || firstChildGetMessage.id === undefined) {
            throw new Error("Expected first child tasks/get to include an id.");
        }
        await harness.respond(firstChildGetMessage.id, {
            result: createRemoteTaskDescriptor(firstChildTaskId, "completed")
        });
        const firstChildResultMessage = await harness.collector.waitFor("first child tasks/result request before iteration limit", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildResultMessage) || firstChildResultMessage.id === undefined) {
            throw new Error("Expected first child tasks/result to include an id.");
        }
        await harness.respond(firstChildResultMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "workspace_lookup",
                        id: "tool-use-policy-limit-stdio-1",
                        input: {}
                    }
                ],
                stopReason: "toolUse"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        const samplingMessages = harness.collector.messages.filter((message) => "method" in message && message.method === "sampling/createMessage");
        expect(samplingMessages).toHaveLength(1);
        expect(taskResultResponse.result.isError).toBe(true);
        expect(taskResultResponse.result.structuredContent.error).toMatchObject({
            code: "sampling_iteration_limit_exceeded",
            details: {
                maxTurns: 1,
                attemptedTurn: 2
            }
        });
    });
});
