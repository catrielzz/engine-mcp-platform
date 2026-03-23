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

describe("@engine-mcp/core-server Streamable HTTP sampling loops", () => {
    it("delivers task-augmented multi-turn sampling tool_use/tool_result loops over Streamable HTTP", async () => {
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
                if (!taskContext?.sendRequest) {
                    throw new Error("Missing task sendRequest helper.");
                }
                const initialPrompt = "Use the tool if needed, then return the workspace name.";
                const toolName = "workspace_lookup";
                const toolUseId = "tool-use-http-augmented-1";
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
                                                text: "SandboxFromHttpAugmentedSamplingTools"
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-sampling-tools",
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
            requestId: "tools-call-http-task-augmented-sampling-tools",
            taskResultRequestId: "tasks-result-http-task-augmented-sampling-tools",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const firstSamplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            expect(firstSamplingRequest.params).toMatchObject({
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
            });
            const firstChildTaskId = "client-http-sampling-tools-task-1";
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
                            id: "tool-use-http-augmented-1",
                            input: {
                                hint: "sandbox"
                            }
                        }
                    ],
                    stopReason: "toolUse"
                }
            });
            const secondSamplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage", {
                occurrence: 2
            });
            expect(secondSamplingRequest.params).toMatchObject({
                maxTokens: 64,
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const secondChildTaskId = "client-http-sampling-tools-task-2";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: secondSamplingRequest,
                childTaskId: secondChildTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "SandboxFromHttpAugmentedSamplingTools"
                    },
                    stopReason: "endTurn"
                },
                getOccurrence: 2,
                resultOccurrence: 2
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-sampling-tools-final"
            });
            expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpAugmentedSamplingTools\"");
        }
        finally {
            await streamReader.close();
        }
    });
});
