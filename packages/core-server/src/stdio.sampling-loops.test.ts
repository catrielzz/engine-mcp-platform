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

describe("@engine-mcp/core-server stdio sampling loops", () => {
    it("delivers task-augmented multi-turn sampling tool_use/tool_result loops over stdio", async () => {
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
                defaultPollIntervalMs: 25
            },
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const taskContext = request.context;
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const initialPrompt = "Use the tool if needed, then return the workspace name.";
                const toolName = "workspace_lookup";
                const toolUseId = "tool-use-augmented-1";
                const firstSamplingResult = await taskContext.sendRequest({
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
                                name: toolName,
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
                }, CreateMessageResultWithToolsSchema);
                const toolUseBlock = firstSamplingResult.content.find((block: any) => block.type === "tool_use" && block.id === toolUseId);
                if (!toolUseBlock || toolUseBlock.name !== toolName) {
                    throw new Error("Expected the first sampling turn to request the workspace tool.");
                }
                const finalSamplingResult = await taskContext.sendRequest({
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
                                                text: "SandboxFromAugmentedSamplingTools"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ],
                        maxTokens: 64
                    }
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: finalSamplingResult.content.type === "text" &&
                        typeof finalSamplingResult.content.text === "string"
                        ? finalSamplingResult.content.text
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
        const taskResultPromise = harness.request("tasks/result", {
            taskId
        }, "tasks-result-stdio-task-augmented-sampling-tools");
        const firstSamplingRequestMessage = await harness.collector.waitFor("first task-augmented sampling-with-tools request", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.tools) &&
            Boolean(message.params.task));
        expect(firstSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 64,
                task: {},
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
        if (!("id" in firstSamplingRequestMessage) ||
            firstSamplingRequestMessage.id === undefined) {
            throw new Error("Expected the first task-augmented sampling-with-tools request to include an id.");
        }
        const firstChildTaskId = "client-sampling-tools-task-stdio-1";
        await harness.respond(firstSamplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(firstChildTaskId, "working")
            }
        });
        const firstChildGetMessage = await harness.collector.waitFor("first child tasks/get request for sampling tools", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildGetMessage) || firstChildGetMessage.id === undefined) {
            throw new Error("Expected the first child tasks/get request to include an id.");
        }
        await harness.respond(firstChildGetMessage.id, {
            result: createRemoteTaskDescriptor(firstChildTaskId, "completed")
        });
        const firstChildResultMessage = await harness.collector.waitFor("first child tasks/result request for sampling tools", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === firstChildTaskId);
        if (!("id" in firstChildResultMessage) || firstChildResultMessage.id === undefined) {
            throw new Error("Expected the first child tasks/result request to include an id.");
        }
        await harness.respond(firstChildResultMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "workspace_lookup",
                        id: "tool-use-augmented-1",
                        input: {
                            hint: "sandbox"
                        }
                    }
                ],
                stopReason: "toolUse"
            }
        });
        const secondSamplingRequestMessage = await harness.collector.waitFor("second task-augmented sampling follow-up request", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.messages) &&
            !Array.isArray(message.params.tools) &&
            Boolean(message.params.task));
        expect(secondSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 64,
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        if (!("id" in secondSamplingRequestMessage) ||
            secondSamplingRequestMessage.id === undefined) {
            throw new Error("Expected the follow-up task-augmented sampling request to include an id.");
        }
        const secondChildTaskId = "client-sampling-tools-task-stdio-2";
        await harness.respond(secondSamplingRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(secondChildTaskId, "working")
            }
        });
        const secondChildGetMessage = await harness.collector.waitFor("second child tasks/get request for sampling tools", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === secondChildTaskId);
        if (!("id" in secondChildGetMessage) || secondChildGetMessage.id === undefined) {
            throw new Error("Expected the second child tasks/get request to include an id.");
        }
        await harness.respond(secondChildGetMessage.id, {
            result: createRemoteTaskDescriptor(secondChildTaskId, "completed")
        });
        const secondChildResultMessage = await harness.collector.waitFor("second child tasks/result request for sampling tools", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === secondChildTaskId);
        if (!("id" in secondChildResultMessage) || secondChildResultMessage.id === undefined) {
            throw new Error("Expected the second child tasks/result request to include an id.");
        }
        await harness.respond(secondChildResultMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromAugmentedSamplingTools"
                },
                stopReason: "endTurn"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromAugmentedSamplingTools"
        });
        expect(taskResultResponse.result._meta).toMatchObject({
            "engine-mcp/capability": "editor.state.read",
            "io.modelcontextprotocol/related-task": {
                taskId
            }
        });
    });

    it("delivers multi-turn sampling tool_use/tool_result loops through tasks/result over stdio", async () => {
        const harness = await createHarness({
            clientCapabilities: {
                sampling: {
                    tools: {}
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
                const initialPrompt = "Use the tool if needed, then return the workspace name.";
                const toolName = "workspace_lookup";
                const toolUseId = "tool-use-1";
                const firstSamplingResult = await taskContext.sendRequest({
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
                }, CreateMessageResultWithToolsSchema);
                const toolUseBlock = firstSamplingResult.content.find((block: any) => block.type === "tool_use" && block.id === toolUseId);
                if (!toolUseBlock || toolUseBlock.name !== toolName) {
                    throw new Error("Expected the first sampling turn to request the workspace tool.");
                }
                const finalSamplingResult = await taskContext.sendRequest({
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
                                                text: "SandboxFromSamplingTools"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ],
                        maxTokens: 64
                    }
                }, CreateMessageResultSchema);
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: finalSamplingResult.content.type === "text" &&
                        typeof finalSamplingResult.content.text === "string"
                        ? finalSamplingResult.content.text
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
        const taskResultPromise = harness.request("tasks/result", {
            taskId
        }, "tasks-result-stdio-sampling-tools");
        const firstSamplingRequestMessage = await harness.collector.waitFor("queued multi-turn sampling request", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.tools));
        expect(firstSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 64,
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
        if (!("id" in firstSamplingRequestMessage) ||
            firstSamplingRequestMessage.id === undefined) {
            throw new Error("Expected the first queued sampling-with-tools request to include an id.");
        }
        await harness.respond(firstSamplingRequestMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "workspace_lookup",
                        id: "tool-use-1",
                        input: {
                            hint: "sandbox"
                        }
                    }
                ],
                stopReason: "toolUse"
            }
        });
        const secondSamplingRequestMessage = await harness.collector.waitFor("queued follow-up sampling request", (message) => "method" in message &&
            message.method === "sampling/createMessage" &&
            "params" in message &&
            Array.isArray(message.params.messages) &&
            !Array.isArray(message.params.tools));
        expect(secondSamplingRequestMessage).toMatchObject({
            method: "sampling/createMessage",
            params: {
                maxTokens: 64,
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        if (!("id" in secondSamplingRequestMessage) ||
            secondSamplingRequestMessage.id === undefined) {
            throw new Error("Expected the follow-up sampling request to include an id.");
        }
        await harness.respond(secondSamplingRequestMessage.id, {
            result: {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromSamplingTools"
                },
                stopReason: "endTurn"
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromSamplingTools"
        });
        expect(taskResultResponse.result._meta).toMatchObject({
            "engine-mcp/capability": "editor.state.read",
            "io.modelcontextprotocol/related-task": {
                taskId
            }
        });
    });
});
