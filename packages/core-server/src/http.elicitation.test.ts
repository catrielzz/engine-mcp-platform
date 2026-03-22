import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { startCoreServerStreamableHttp, type EngineMcpStreamableHttpServerRuntime } from "./index.js";
import { VALID_SAMPLES, createDeferred, createFakeAdapter, createRemoteTaskDescriptor } from "./test-support/fixtures.js";
import { postJson, readJson, readTextStreamUntil } from "./test-support/http.js";
import {
    cancelRemoteHttpChildTask,
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

describe("@engine-mcp/core-server Streamable HTTP elicitation", () => {
    it("cleans up queued task request resolvers when a task is cancelled over Streamable HTTP", async () => {
        const pendingTaskRequestRejected = createDeferred();
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
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
                try {
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
                }
                catch (error) {
                    pendingTaskRequestRejected.resolve(
                        error instanceof Error
                            ? error.message
                            : typeof error === "object" &&
                                error !== null &&
                                "message" in error &&
                                typeof error.message === "string"
                                ? error.message
                                : String(error)
                    );
                    throw error;
                }
                throw new Error("Queued task request unexpectedly resolved.");
            })
        });
        openServers.push(runtime);
        const initializeResponse = await postJson(runtime.address.endpointUrl, {
            jsonrpc: "2.0",
            id: "init-http-task-input-required",
            method: "initialize",
            params: {
                protocolVersion: "2025-11-25",
                capabilities: {
                    elicitation: {}
                },
                clientInfo: {
                    name: "vitest-http",
                    version: "1.0.0"
                }
            }
        }, {
            origin: "http://localhost:4100"
        });
        const sessionId = initializeResponse.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();
        await initializeResponse.text();
        const taskCreatedResponse = await postJson(runtime.address.endpointUrl, {
            jsonrpc: "2.0",
            id: "tools-call-http-task-input-required",
            method: "tools/call",
            params: {
                name: "editor.state.read",
                arguments: VALID_SAMPLES["editor.state.read"].input,
                task: {
                    ttl: 1_500
                }
            }
        }, {
            origin: "http://localhost:4100",
            "mcp-session-id": sessionId ?? "",
            "mcp-protocol-version": "2025-11-25"
        });
        const taskCreatedJson = await readJson<any>(taskCreatedResponse);
        const taskId = taskCreatedJson.result.task.taskId;
        expect(taskCreatedJson.result.task).toMatchObject({
            taskId: expect.any(String),
            status: "input_required"
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const cancelledTaskResponse = await postJson(runtime.address.endpointUrl, {
            jsonrpc: "2.0",
            id: "tasks-cancel-http-task-input-required",
            method: "tasks/cancel",
            params: {
                taskId
            }
        }, {
            origin: "http://localhost:4100",
            "mcp-session-id": sessionId ?? "",
            "mcp-protocol-version": "2025-11-25"
        });
        await expect(cancelledTaskResponse.text()).resolves.toContain("\"status\":\"cancelled\"");
        await expect(pendingTaskRequestRejected.promise).resolves.toMatch(/Task cancelled or completed|Client cancelled task execution/i);
        const cancelledTaskStatus = await postJson(runtime.address.endpointUrl, {
            jsonrpc: "2.0",
            id: "tasks-get-http-task-input-required-cancelled",
            method: "tasks/get",
            params: {
                taskId
            }
        }, {
            origin: "http://localhost:4100",
            "mcp-session-id": sessionId ?? "",
            "mcp-protocol-version": "2025-11-25"
        });
        await expect(cancelledTaskStatus.json()).resolves.toMatchObject({
            result: {
                taskId,
                status: "cancelled"
            }
        });
    });

    it("uses task-augmented elicitation/create when the client advertises tasks.requests.elicitation.create over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-elicitation",
            capabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
                        }
                    }
                }
            }
        });
        const { taskId, taskResultStream, streamReader } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-augmented-elicitation",
            taskResultRequestId: "tasks-result-http-task-augmented-elicitation",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            expect(elicitationRequest.params).toMatchObject({
                mode: "form",
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const childTaskId = "client-http-elicitation-task";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: elicitationRequest,
                childTaskId,
                finalResult: {
                    action: "accept",
                    content: {
                        workspaceName: "SandboxFromHttpAugmentedElicitation"
                    }
                }
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-elicitation-final"
            });
            expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpAugmentedElicitation\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("surfaces cancelled task-augmented client requests as tool failures over Streamable HTTP", async () => {
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
                throw new Error("The cancelled child task unexpectedly resolved.");
            })
        });
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-cancelled",
            capabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
                        }
                    }
                }
            }
        });
        const { taskId, taskResultStream, streamReader } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-augmented-cancelled",
            taskResultRequestId: "tasks-result-http-task-augmented-cancelled",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            const childTaskId = "client-http-elicitation-task-cancelled";
            await cancelRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: elicitationRequest,
                childTaskId
            });
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-cancelled-final"
            });
            expect(finalTaskResultBody).toContain("\"code\":\"internal_error\"");
            expect(finalTaskResultBody).toContain("cancelled");
        }
        finally {
            await streamReader.close();
        }
    });

    it("fails task-side elicitation child requests with client_request_timeout over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-elicitation-timeout",
            capabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
                        }
                    }
                }
            }
        });
        const { taskId, streamReader } = await startHttpTaskToolCall(session, {
            requestId: "tools-call-http-task-augmented-elicitation-timeout",
            taskResultRequestId: "tasks-result-http-task-augmented-elicitation-timeout",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            await respondToHttpRequest(session, elicitationRequest.id, {
                task: createRemoteTaskDescriptor("client-http-elicitation-timeout-task", "working")
            });
            await waitForHttpRequest<{ taskId: string }>(streamReader, "tasks/get");
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-elicitation-timeout-final"
            });
            expect(finalTaskResultBody).toContain("\"code\":\"client_request_timeout\"");
            expect(finalTaskResultBody).toContain(
                "\"message\":\"Client request timed out while waiting for elicitation/create.\""
            );
            expect(finalTaskResultBody).toContain("\"timeoutMs\":50");
        }
        finally {
            await streamReader.close();
        }
    });

    it("surfaces task-side elicitation queue overflow as task_message_queue_overflow over Streamable HTTP", async () => {
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
                        data: "prefill queue before http elicitation overflow"
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-elicitation-overflow",
            capabilities: {
                elicitation: {}
            }
        });
        const taskCreatedResponse = await callHttpJsonRpc(session, {
            requestId: "tools-call-http-task-elicitation-overflow",
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
            requestId: "tasks-result-http-task-elicitation-overflow-final"
        });
        expect(finalTaskResultBody).toContain("prefill queue before http elicitation overflow");
        expect(finalTaskResultBody).toContain("\"code\":\"task_message_queue_overflow\"");
        expect(finalTaskResultBody).toContain(
            "\"message\":\"Task message queue overflow while queueing elicitation/create.\""
        );
        expect(finalTaskResultBody).toContain("\"maxQueueSize\":1");
    });

    it("uses task-augmented elicitation/create without a parent task and preserves decline over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-direct-task-augmented-elicitation-decline",
            capabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
                        }
                    }
                }
            }
        });
        const { toolCallResponse, streamReader } = await openHttpToolCallStream(session, {
            requestId: "tools-call-http-direct-task-augmented-elicitation-decline",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(toolCallResponse.status).toBe(200);
        expect(toolCallResponse.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            expect(elicitationRequest.params).toMatchObject({
                mode: "form",
                task: {}
            });
            expect(elicitationRequest.params?._meta?.["io.modelcontextprotocol/related-task"]).toBeUndefined();
            const childTaskId = "client-http-direct-elicitation-decline-task";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: elicitationRequest,
                childTaskId,
                finalResult: {
                    action: "decline"
                }
            });
            const finalToolCallBody = await streamReader.readUntil("\"structuredContent\"");
            expect(finalToolCallBody).toContain("\"workspaceName\":\"DeclinedByClient\"");
            expect(finalToolCallBody).toContain("\"id\":\"tools-call-http-direct-task-augmented-elicitation-decline\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("uses task-augmented elicitation/create without a parent task and preserves cancel over Streamable HTTP", async () => {
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
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-direct-task-augmented-elicitation-cancel",
            capabilities: {
                elicitation: {},
                tasks: {
                    requests: {
                        elicitation: {
                            create: {}
                        }
                    }
                }
            }
        });
        const { toolCallResponse, streamReader } = await openHttpToolCallStream(session, {
            requestId: "tools-call-http-direct-task-augmented-elicitation-cancel",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(toolCallResponse.status).toBe(200);
        expect(toolCallResponse.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            expect(elicitationRequest.params).toMatchObject({
                mode: "form",
                task: {}
            });
            expect(elicitationRequest.params?._meta?.["io.modelcontextprotocol/related-task"]).toBeUndefined();
            const childTaskId = "client-http-direct-elicitation-cancel-task";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: elicitationRequest,
                childTaskId,
                finalResult: {
                    action: "cancel"
                }
            });
            const finalToolCallBody = await streamReader.readUntil("\"structuredContent\"");
            expect(finalToolCallBody).toContain("\"workspaceName\":\"CancelledByClient\"");
            expect(finalToolCallBody).toContain("\"id\":\"tools-call-http-direct-task-augmented-elicitation-cancel\"");
        }
        finally {
            await streamReader.close();
        }
    });
});
