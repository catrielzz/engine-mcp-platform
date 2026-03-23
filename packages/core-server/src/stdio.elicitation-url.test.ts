import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultWithToolsSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { VALID_SAMPLES, createFakeAdapter, createRemoteTaskDescriptor } from "./test-support/fixtures.js";
import { createHarness, expectErrorMessage, expectResultMessage, type StdioHarness } from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio elicitation URL", () => {
    it("supports task-augmented URL-mode elicitation completion notifications over stdio", async () => {
        const elicitationId = "task-url-elicitation-stdio-001";
        const harness = await createHarness({
            clientCapabilities: {
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
            },
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
                        ? "SandboxFromTaskUrlElicitation"
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
        }, "tasks-result-stdio-task-augmented-url-elicitation");
        const elicitationRequestMessage = await harness.collector.waitFor("task-augmented url elicitation request", (message) => "method" in message &&
            message.method === "elicitation/create" &&
            "params" in message &&
            message.params.mode === "url" &&
            Boolean(message.params.task &&
                message.params._meta?.["io.modelcontextprotocol/related-task"]));
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                mode: "url",
                elicitationId,
                url: "https://mcp.example.com/ui/authorize",
                task: {},
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        if (!("id" in elicitationRequestMessage) || elicitationRequestMessage.id === undefined) {
            throw new Error("Expected the task-augmented URL elicitation request to include an id.");
        }
        const childTaskId = "client-task-url-elicitation-stdio";
        await harness.respond(elicitationRequestMessage.id, {
            result: {
                task: createRemoteTaskDescriptor(childTaskId, "working")
            }
        });
        const childTaskGetMessage = await harness.collector.waitFor("child tasks/get request for url elicitation", (message) => "method" in message &&
            message.method === "tasks/get" &&
            "params" in message &&
            message.params.taskId === childTaskId);
        if (!("id" in childTaskGetMessage) || childTaskGetMessage.id === undefined) {
            throw new Error("Expected the child tasks/get request to include an id.");
        }
        await harness.respond(childTaskGetMessage.id, {
            result: createRemoteTaskDescriptor(childTaskId, "completed")
        });
        const childTaskResultMessage = await harness.collector.waitFor("child tasks/result request for url elicitation", (message) => "method" in message &&
            message.method === "tasks/result" &&
            "params" in message &&
            message.params.taskId === childTaskId);
        if (!("id" in childTaskResultMessage) || childTaskResultMessage.id === undefined) {
            throw new Error("Expected the child tasks/result request to include an id.");
        }
        await harness.respond(childTaskResultMessage.id, {
            result: {
                action: "accept"
            }
        });
        await expect(harness.collector.waitFor("task-related elicitation completion notification", (message) => "method" in message &&
            message.method === "notifications/elicitation/complete" &&
            "params" in message &&
            message.params
                .elicitationId === elicitationId &&
            message.params._meta?.["io.modelcontextprotocol/related-task"] !== undefined)).resolves.toMatchObject({
            method: "notifications/elicitation/complete",
            params: {
                elicitationId,
                _meta: {
                    "io.modelcontextprotocol/related-task": {
                        taskId
                    }
                }
            }
        });
        const taskResultResponse = expectResultMessage(await taskResultPromise);
        expect(taskResultResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "SandboxFromTaskUrlElicitation"
        });
    });

    it("supports URL-mode elicitation completion notifications over stdio", async () => {
        const elicitationId = "url-elicitation-stdio-001";
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {
                    url: {}
                }
            },
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
        openHarnesses.push(harness);
        await harness.initialize();
        const toolCallPromise = harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-url-mode");
        const elicitationRequestMessage = await harness.collector.waitFor("url-mode elicitation request", (message) => "method" in message &&
            message.method === "elicitation/create" &&
            "params" in message &&
            message.params.mode === "url");
        expect(elicitationRequestMessage).toMatchObject({
            method: "elicitation/create",
            params: {
                mode: "url",
                elicitationId,
                url: "https://mcp.example.com/ui/authorize",
                message: "Open the authorization page to continue."
            }
        });
        if (!("id" in elicitationRequestMessage) || elicitationRequestMessage.id === undefined) {
            throw new Error("Expected the URL-mode elicitation request to include an id.");
        }
        await harness.respond(elicitationRequestMessage.id, {
            result: {
                action: "accept"
            }
        });
        await expect(harness.collector.waitFor("elicitation completion notification", (message) => "method" in message &&
            message.method === "notifications/elicitation/complete" &&
            "params" in message &&
            message.params.elicitationId === elicitationId)).resolves.toMatchObject({
            method: "notifications/elicitation/complete",
            params: {
                elicitationId
            }
        });
        const toolCallResponse = expectResultMessage(await toolCallPromise);
        expect(toolCallResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "UrlModeCompleted"
        });
    });

    it("surfaces UrlElicitationRequiredError as a JSON-RPC error over stdio", async () => {
        const elicitationId = "url-required-stdio-001";
        const harness = await createHarness({
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
        openHarnesses.push(harness);
        await harness.initialize();
        const response = expectErrorMessage(await harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }));
        expect(response).toMatchObject({
            jsonrpc: "2.0",
            id: "req-0001",
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
        expect(response.error?.message).toContain("This request requires more information.");
    });

    it("supports client-driven retry after UrlElicitationRequiredError over stdio", async () => {
        const elicitationId = "url-required-stdio-retry-001";
        let retryUnlocked = false;
        let notifyCompletion: (() => Promise<void>) | undefined;
        const harness = await createHarness({
            clientCapabilities: {
                elicitation: {
                    url: {}
                }
            },
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
        openHarnesses.push(harness);
        await harness.initialize();
        const firstResponse = expectErrorMessage(await harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-url-retry-1"));
        expect(firstResponse).toMatchObject({
            jsonrpc: "2.0",
            id: "tools-call-stdio-url-retry-1",
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
        expect(firstResponse.error?.message).toContain("This request requires more information.");
        expect(notifyCompletion).toBeTypeOf("function");
        const completionNotificationPromise = harness.collector.waitFor("post-error elicitation completion notification", (message) => "method" in message &&
            message.method === "notifications/elicitation/complete" &&
            "params" in message &&
            message.params.elicitationId === elicitationId);
        retryUnlocked = true;
        await notifyCompletion?.();
        await expect(completionNotificationPromise).resolves.toMatchObject({
            method: "notifications/elicitation/complete",
            params: {
                elicitationId
            }
        });
        const secondResponse = expectResultMessage(await harness.request("tools/call", {
            name: "editor.state.read",
            arguments: VALID_SAMPLES["editor.state.read"].input
        }, "tools-call-stdio-url-retry-2"));
        expect(secondResponse.result.structuredContent).toMatchObject({
            ...VALID_SAMPLES["editor.state.read"].output,
            workspaceName: "UrlModeRetried"
        });
    });
});
