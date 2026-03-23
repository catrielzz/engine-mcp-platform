import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { startCoreServerStreamableHttp, type EngineMcpStreamableHttpServerRuntime } from "./index.js";
import { VALID_SAMPLES, createFakeAdapter } from "./test-support/fixtures.js";
import { createTextStreamReader, postJson, readJson } from "./test-support/http.js";
import {
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

describe("@engine-mcp/core-server Streamable HTTP elicitation URL", () => {
    it("supports task-augmented URL-mode elicitation completion notifications over Streamable HTTP", async () => {
        const elicitationId = "task-url-elicitation-http-001";
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
                if (!taskContext?.sendRequest || !taskContext.createElicitationCompletionNotifier) {
                    throw new Error("Missing URL-mode task helpers.");
                }
                const notifyCompletion = taskContext.createElicitationCompletionNotifier(elicitationId);
                const elicitationResult = await taskContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "url",
                        elicitationId,
                        url: "https://mcp.example.com/ui/authorize",
                        message: "Open the authorization page to continue."
                    }
                }, ElicitResultSchema);
                if (elicitationResult.action === "accept") {
                    await notifyCompletion();
                }
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: elicitationResult.action === "accept"
                        ? "SandboxFromHttpTaskUrlElicitation"
                        : VALID_SAMPLES["editor.state.read"].output.workspaceName
                };
            })
        });
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-task-augmented-url-elicitation",
            capabilities: {
                elicitation: {
                    url: {}
                },
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
            requestId: "tools-call-http-task-augmented-url-elicitation",
            taskResultRequestId: "tasks-result-http-task-augmented-url-elicitation",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(taskId).toBeTruthy();
        expect(taskResultStream.status).toBe(200);
        expect(taskResultStream.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            expect(elicitationRequest.params).toMatchObject({
                mode: "url",
                elicitationId,
                url: "https://mcp.example.com/ui/authorize",
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            });
            const childTaskId = "client-http-task-url-elicitation";
            await resolveRemoteHttpChildTask(session, {
                streamReader,
                initialRequest: elicitationRequest,
                childTaskId,
                finalResult: {
                    action: "accept"
                }
            });
            const completionBody = await streamReader.readUntil("\"method\":\"notifications/elicitation/complete\"");
            expect(completionBody).toContain(`\"elicitationId\":\"${elicitationId}\"`);
            expect(completionBody).toContain(`\"taskId\":\"${taskId}\"`);
            const { body: finalTaskResultBody } = await readFinalHttpTaskResult(session, {
                taskId,
                requestId: "tasks-result-http-task-augmented-url-elicitation-final"
            });
            expect(finalTaskResultBody).toContain("\"workspaceName\":\"SandboxFromHttpTaskUrlElicitation\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("supports URL-mode elicitation completion notifications over Streamable HTTP", async () => {
        const elicitationId = "url-elicitation-http-001";
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                const requestContext = request.context;
                if (!requestContext?.sendRequest || !requestContext.createElicitationCompletionNotifier) {
                    throw new Error("Missing URL elicitation helpers.");
                }
                const notifyCompletion = requestContext.createElicitationCompletionNotifier(elicitationId);
                const elicitationResult = await requestContext.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "url",
                        elicitationId,
                        url: "https://mcp.example.com/ui/authorize",
                        message: "Open the authorization page to continue."
                    }
                }, ElicitResultSchema);
                if (elicitationResult.action !== "accept") {
                    return VALID_SAMPLES["editor.state.read"].output;
                }
                await notifyCompletion();
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: "UrlModeCompleted"
                };
            })
        });
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-url-mode",
            capabilities: {
                elicitation: {
                    url: {}
                }
            }
        });
        const { toolCallResponse, streamReader } = await openHttpToolCallStream(session, {
            requestId: "tools-call-http-url-mode",
            arguments: VALID_SAMPLES["editor.state.read"].input
        });
        expect(toolCallResponse.status).toBe(200);
        expect(toolCallResponse.headers.get("content-type")).toContain("text/event-stream");
        try {
            const elicitationRequest = await waitForHttpRequest(streamReader, "elicitation/create");
            expect(elicitationRequest.params).toMatchObject({
                mode: "url",
                elicitationId,
                url: "https://mcp.example.com/ui/authorize",
                message: "Open the authorization page to continue."
            });
            await respondToHttpRequest(session, elicitationRequest.id, {
                action: "accept"
            });
            const completionBody = await streamReader.readUntil("\"method\":\"notifications/elicitation/complete\"");
            expect(completionBody).toContain(`\"elicitationId\":\"${elicitationId}\"`);
            const finalToolCallBody = await streamReader.readUntil("\"structuredContent\"");
            expect(finalToolCallBody).toContain("\"workspaceName\":\"UrlModeCompleted\"");
            expect(finalToolCallBody).toContain("\"id\":\"tools-call-http-url-mode\"");
        }
        finally {
            await streamReader.close();
        }
    });

    it("surfaces UrlElicitationRequiredError as a JSON-RPC error over Streamable HTTP", async () => {
        const elicitationId = "url-required-http-001";
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            adapter: createFakeAdapter(["editor.state.read"], async () => {
                throw new UrlElicitationRequiredError([
                    {
                        mode: "url",
                        elicitationId,
                        url: "https://mcp.example.com/ui/connect",
                        message: "Authorization is required to continue."
                    }
                ], "This request requires more information.");
            })
        });
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-url-required",
            capabilities: {
                elicitation: {
                    url: {}
                }
            }
        });
        const toolCallResponse = await postJson(session.endpointUrl, {
            jsonrpc: "2.0",
            id: "tools-call-http-url-required",
            method: "tools/call",
            params: {
                name: "editor.state.read",
                arguments: VALID_SAMPLES["editor.state.read"].input
            }
        }, session.requestHeaders);
        const toolCallBody = await readJson<any>(toolCallResponse);
        expect(toolCallBody).toMatchObject({
            error: {
                code: -32042,
                data: {
                    elicitations: [
                        {
                            mode: "url",
                            elicitationId,
                            url: "https://mcp.example.com/ui/connect",
                            message: "Authorization is required to continue."
                        }
                    ]
                }
            }
        });
        expect(toolCallBody.error?.message).toContain("This request requires more information.");
    });

    it("supports client-driven retry after UrlElicitationRequiredError over Streamable HTTP", async () => {
        const elicitationId = "url-required-http-retry-001";
        let retryUnlocked = false;
        let notifyCompletion: (() => Promise<void>) | undefined;
        const runtime = await startCoreServerStreamableHttp({
            port: 0,
            enableJsonResponse: false,
            adapter: createFakeAdapter(["editor.state.read"], async (request) => {
                if (!retryUnlocked) {
                    notifyCompletion ??=
                        request.context?.createElicitationCompletionNotifier(elicitationId);
                    throw new UrlElicitationRequiredError([
                        {
                            mode: "url",
                            elicitationId,
                            url: "https://mcp.example.com/ui/connect",
                            message: "Authorization is required to continue."
                        }
                    ], "This request requires more information.");
                }
                return {
                    ...VALID_SAMPLES["editor.state.read"].output,
                    workspaceName: "UrlModeRetried"
                };
            })
        });
        openServers.push(runtime);
        const { session } = await initializeHttpClientSession(runtime, {
            requestId: "init-http-url-retry",
            capabilities: {
                elicitation: {
                    url: {}
                }
            }
        });
        const notificationStreamResponse = await fetch(session.endpointUrl, {
            method: "GET",
            headers: {
                accept: "text/event-stream",
                ...session.requestHeaders
            }
        });
        expect(notificationStreamResponse.status).toBe(200);
        expect(notificationStreamResponse.headers.get("content-type")).toContain("text/event-stream");
        const notificationStreamReader = createTextStreamReader(notificationStreamResponse.body);
        try {
            const firstToolCallResponse = await postJson(session.endpointUrl, {
                jsonrpc: "2.0",
                id: "tools-call-http-url-retry-1",
                method: "tools/call",
                params: {
                    name: "editor.state.read",
                    arguments: VALID_SAMPLES["editor.state.read"].input
                }
            }, session.requestHeaders);
            const firstToolCallBody = await firstToolCallResponse.text();
            expect(firstToolCallResponse.status).toBe(200);
            expect(firstToolCallResponse.headers.get("content-type")).toContain("text/event-stream");
            expect(firstToolCallBody).toContain("\"id\":\"tools-call-http-url-retry-1\"");
            expect(firstToolCallBody).toContain("\"code\":-32042");
            expect(firstToolCallBody).toContain(`\"elicitationId\":\"${elicitationId}\"`);
            expect(firstToolCallBody).toContain("This request requires more information.");
            expect(notifyCompletion).toBeTypeOf("function");
            const completionNotificationPromise = notificationStreamReader.readUntil("\"method\":\"notifications/elicitation/complete\"");
            retryUnlocked = true;
            await notifyCompletion?.();
            const completionBody = await completionNotificationPromise;
            expect(completionBody).toContain(`\"elicitationId\":\"${elicitationId}\"`);
            const secondToolCallResponse = await postJson(session.endpointUrl, {
                jsonrpc: "2.0",
                id: "tools-call-http-url-retry-2",
                method: "tools/call",
                params: {
                    name: "editor.state.read",
                    arguments: VALID_SAMPLES["editor.state.read"].input
                }
            }, session.requestHeaders);
            const secondToolCallBody = await secondToolCallResponse.text();
            expect(secondToolCallResponse.status).toBe(200);
            expect(secondToolCallResponse.headers.get("content-type")).toContain("text/event-stream");
            expect(secondToolCallBody).toContain("\"id\":\"tools-call-http-url-retry-2\"");
            expect(secondToolCallBody).toContain("\"structuredContent\"");
            expect(secondToolCallBody).toContain("\"workspaceName\":\"UrlModeRetried\"");
        }
        finally {
            await notificationStreamReader.close();
        }
    });
});
