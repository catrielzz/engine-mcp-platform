import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { startCoreServerStreamableHttp, type EngineMcpStreamableHttpServerRuntime } from "./index.js";
import {
    VALID_SAMPLES,
    createFakeAdapter,
    createRemoteTaskDescriptor
} from "./test-support/fixtures.js";
import {
    callHttpJsonRpc,
    initializeHttpClientSession,
    openHttpToolCallStream,
    readFinalHttpTaskResult,
    resolveRemoteHttpChildTask,
    respondToHttpRequest,
    startHttpTaskToolCall,
    waitForHttpRequest
} from "./test-support/http-client-requests.js";

const openServers: EngineMcpStreamableHttpServerRuntime[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()?.close();
  }
});

describe("@engine-mcp/core-server Streamable HTTP sampling", () => {
    it("delivers queued sampling requests through tasks/result over Streamable HTTP SSE", async () => {
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
        openServers.push(runtime);
        const { session, initializeBody } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-sampling",
            capabilities: {
                sampling: {}
            }
        });
        const sessionId = session.sessionId;
        expect(sessionId).toBeTruthy();
        expect(initializeBody).toContain("\"id\":\"init-http-task-sampling\"");
        const {
            taskId,
            taskCreatedBody,
            taskCreatedResponse,
            taskResultStream,
            streamReader
        } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-sampling",
            taskResultRequestId: "tasks-result-http-task-sampling",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskCreatedResponse.status).toBe(200);
        expect(taskCreatedResponse.headers.get("content-type")).toContain("text/event-stream");
        expect(taskId).toBeTruthy();
        expect(taskCreatedBody).toContain("\"status\":\"input_required\"");
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            expect(samplingRequest.rawBody).toContain(`\"taskId\":\"${taskId}\"`);
            expect(samplingRequest.rawBody).toContain("\"maxTokens\":32");
            const samplingResponseAck = await respondToHttpRequest(session, samplingRequest.id, {
                model: "gpt-5.4-mini",
                role: "assistant",
                content: {
                    type: "text",
                    text: "SandboxFromHttpSampling"
                },
                stopReason: "endTurn"
            });
        expect(samplingResponseAck.status).toBe(202);
            const { response: finalTaskResultResponse, body: finalTaskResultBody } =
                await readFinalHttpTaskResult(session, {
                    taskId,
                    requestId: "tasks-result-http-task-sampling-final"
                });
        expect(finalTaskResultResponse.status).toBe(200);
        expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpSampling\"");
        expect(finalTaskResultBody).toContain("\"id\":\"tasks-result-http-task-sampling-final\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("uses task-augmented sampling/createMessage when the client advertises tasks.requests.sampling.createMessage over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-sampling",
            capabilities: {
                sampling: {},
                tasks: {
                    requests: {
                        sampling: {
                            createMessage: {}
                        }
                    }
                }
            }
        });
        const {
            taskId,
            streamReader,
            taskResultStream
        } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-augmented-sampling",
            taskResultRequestId: "tasks-result-http-task-augmented-sampling",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            expect(samplingRequest.params).toMatchObject({
                maxTokens: 32,
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const childTaskId = "client-http-sampling-task";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: samplingRequest,
                childTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "SandboxFromHttpAugmentedSampling"
                    },
                    stopReason: "endTurn"
                }
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-sampling-final"
            });
            expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpAugmentedSampling\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("fails task-side sampling child requests with client_request_timeout over Streamable HTTP", async () => {
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-sampling-timeout",
            capabilities: {
                sampling: {},
                tasks: {
                    requests: {
                        sampling: {
                            createMessage: {}
                        }
                    }
                }
            }
        });
        const {
            taskId,
            streamReader
        } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-augmented-sampling-timeout",
            taskResultRequestId: "tasks-result-http-task-augmented-sampling-timeout",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        try {
            const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            await respondToHttpRequest(session, samplingRequest.id, {
                task: createRemoteTaskDescriptor("client-http-sampling-timeout-task", "working")
            });
            await waitForHttpRequest<{ taskId: string }>(streamReader, "tasks/get");
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-sampling-timeout-final"
            });
            expect(finalTaskResultBody).toContain("\"code\":\"client_request_timeout\"");
            expect(finalTaskResultBody).toContain(
                "\"message\":\"Client request timed out while waiting for sampling/createMessage.\""
            );
            expect(finalTaskResultBody).toContain("\"timeoutMs\":50");
        }
        finally {
            await streamReader.close();
        }
    });

    it("surfaces task-side sampling queue overflow as task_message_queue_overflow over Streamable HTTP", async () => {
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
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
                        data: "prefill queue before http sampling overflow"
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-sampling-overflow",
            capabilities: {
                sampling: {}
            }
        });
        const taskCreatedResponse = await callHttpJsonRpc(session, {
            requestId: "tools-call-http-task-sampling-overflow",
            method: "tools/call",
            params: {
                name: "editor.state.read",
                arguments: VALID_SAMPLES["editor.state.read"].input,
                task: {
                    ttl: 1_500
                }
            }
        });
        const taskCreatedBody = await taskCreatedResponse.text();
        const taskId = taskCreatedBody.match(/"taskId":"([^"]+)"/)?.[1];
        expect(taskId).toBeTruthy();
        const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
            taskId: taskId ?? "",
            requestId: "tasks-result-http-task-sampling-overflow-final"
        });
        expect(finalTaskResultBody).toContain("prefill queue before http sampling overflow");
        expect(finalTaskResultBody).toContain("\"code\":\"task_message_queue_overflow\"");
        expect(finalTaskResultBody).toContain(
            "\"message\":\"Task message queue overflow while queueing sampling/createMessage.\""
        );
        expect(finalTaskResultBody).toContain("\"maxQueueSize\":1");
    });

    it("uses task-augmented sampling/createMessage without a parent task over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-direct-task-augmented-sampling",
            capabilities: {
                sampling: {},
                tasks: {
                    requests: {
                        sampling: {
                            createMessage: {}
                        }
                    }
                }
            }
        });
        const { toolCallResponse, streamReader } = await openHttpToolCallStream(session, {
            requestId: "tools-call-http-direct-task-augmented-sampling",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(toolCallResponse.status).toBe(200);
        expect(toolCallResponse.headers.get("content-type")).toContain("text/event-stream");
        try {
            const samplingRequest = await waitForHttpRequest(streamReader, "sampling/createMessage");
            expect(samplingRequest.params).toMatchObject({
                maxTokens: 32,
                task: {}
            });
            expect(samplingRequest.params?._meta?.["io.modelcontextprotocol/related-task"]).toBeUndefined();
            const childTaskId = "client-http-direct-sampling-task";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: samplingRequest,
                childTaskId,
                finalResult: {
                    model: "gpt-5.4-mini",
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "SandboxFromHttpDirectAugmentedSampling"
                    },
                    stopReason: "endTurn"
                }
            });
            const finalToolCallBody = await streamReader.readUntil("\"structuredContent\"");
            expect(finalToolCallBody).toContain("\"workspaceName\":\"SandboxFromHttpDirectAugmentedSampling\"");
            expect(finalToolCallBody).toContain("\"id\":\"tools-call-http-direct-task-augmented-sampling\"");
        }
        finally {
            await streamReader.close();
        }
    });
});
