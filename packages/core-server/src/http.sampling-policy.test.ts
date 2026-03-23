import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { startCoreServerStreamableHttp, type EngineMcpStreamableHttpServerRuntime } from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import {
    initializeHttpClientSession,
    readFinalHttpTaskResult,
    resolveRemoteHttpChildTask,
    startHttpTaskToolCall,
    waitForHttpRequest
} from "./test-support/http-client-requests.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP sampling policy", () => {
    it("forces toolChoice none on the final configured sampling turn over Streamable HTTP", async () => {
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
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
                        messages: [],
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
                                                text: "SandboxFromHttpSamplingPolicy"
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-sampling-policy",
            capabilities: {
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
            }
        });
        const { taskId, taskResultStream, streamReader } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-sampling-policy",
            taskResultRequestId: "tasks-result-http-task-sampling-policy",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const firstSamplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            expect(firstSamplingRequest.params).toMatchObject({
                toolChoice: {
                    mode: "auto"
                },
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const firstChildTaskId = "client-http-sampling-policy-task-1";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: firstSamplingRequest,
                childTaskId: firstChildTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            name: "workspace_lookup",
                            id: "tool-use-http-policy-1",
                            input: {}
                        }
                    ],
                    stopReason: "toolUse"
                }
            });
            const secondSamplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage", {
                occurrence: 2
            });
            expect(secondSamplingRequest.params).toMatchObject({
                toolChoice: {
                    mode: "none"
                },
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const secondChildTaskId = "client-http-sampling-policy-task-2";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: secondSamplingRequest,
                childTaskId: secondChildTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "SandboxFromHttpSamplingPolicy"
                    },
                    stopReason: "endTurn"
                },
                getOccurrence: 2,
                resultOccurrence: 2
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-sampling-policy-final"
            });
            expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpSamplingPolicy\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("fails task-side sampling when the configured iteration limit is exceeded over Streamable HTTP", async () => {
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-sampling-policy-limit",
            capabilities: {
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
            }
        });
        const { taskId, taskResultStream, streamReader } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-sampling-policy-limit",
            taskResultRequestId: "tasks-result-http-task-sampling-policy-limit",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const firstSamplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            const firstChildTaskId = "client-http-sampling-policy-limit-task-1";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: firstSamplingRequest,
                childTaskId: firstChildTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            name: "workspace_lookup",
                            id: "tool-use-http-policy-limit-1",
                            input: {}
                        }
                    ],
                    stopReason: "toolUse"
                }
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-sampling-policy-limit-final"
            });
            expect(finalTaskResultBody).toContain("\"isError\":true");
            expect(finalTaskResultBody).toContain("\"code\":\"sampling_iteration_limit_exceeded\"");
            expect(finalTaskResultBody).toContain("\"maxTurns\":1");
            expect(finalTaskResultBody).toContain("\"attemptedTurn\":2");
        }
        finally {
            await streamReader.close();
        }
    });
});
