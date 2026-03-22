import { ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { VALID_SAMPLES, createDeferred, createFakeAdapter } from "./test-support/fixtures.js";
import {
  createHarness,
  expectResultMessage,
  type StdioHarness
} from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio roots", () => {
  it("reuses cached roots/list results within a task until the client reports a roots change over stdio", async () => {
    const continueAfterFirstRoots = createDeferred<void>();
    const harness = await createHarness({
      clientCapabilities: {
        roots: {
          listChanged: true
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

        const firstRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };
        await continueAfterFirstRoots.promise;
        const secondRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };

        return {
          ...VALID_SAMPLES["editor.state.read"].output,
          workspaceName: `${firstRoots.roots[0]?.name ?? "missing"}|${secondRoots.roots[0]?.name ?? "missing"}`
        };
      })
    });
    openHarnesses.push(harness);

    await harness.initialize();
    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {
          ttl: 1_500
        }
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;
    const taskResultPromise = harness.request(
      "tasks/result",
      {
        taskId
      },
      "tasks-result-stdio-roots-cached"
    );

    const firstRootsRequestMessage = await harness.collector.waitFor(
      "queued roots request",
      (message: any) => message.method === "roots/list"
    );
    if (!("id" in firstRootsRequestMessage) || firstRootsRequestMessage.id === undefined) {
      throw new Error("Expected the queued roots request to include an id.");
    }

    await harness.respond(firstRootsRequestMessage.id, {
      result: {
        roots: [
          {
            uri: "file:///sandbox-root",
            name: "InitialRoot"
          }
        ]
      }
    });

    continueAfterFirstRoots.resolve();

    const taskResultResponse = expectResultMessage(await taskResultPromise);
    expect(taskResultResponse.result.structuredContent).toMatchObject({
      ...VALID_SAMPLES["editor.state.read"].output,
      workspaceName: "InitialRoot|InitialRoot"
    });

    const rootsListMessages = harness.collector.messages.filter(
      (message: any) => message.method === "roots/list"
    );
    expect(rootsListMessages).toHaveLength(1);
  });

  it("invalidates cached roots/list results when the client emits roots/list_changed over stdio", async () => {
    const continueAfterInvalidation = createDeferred<void>();
    const harness = await createHarness({
      clientCapabilities: {
        roots: {
          listChanged: true
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

        const firstRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };
        await continueAfterInvalidation.promise;
        const secondRoots = (await taskContext.sendRequest(
          {
            method: "roots/list"
          },
          ListRootsResultSchema
        )) as {
          roots: Array<{
            uri: string;
            name: string;
          }>;
        };

        return {
          ...VALID_SAMPLES["editor.state.read"].output,
          workspaceName: `${firstRoots.roots[0]?.name ?? "missing"}|${secondRoots.roots[0]?.name ?? "missing"}`
        };
      })
    });
    openHarnesses.push(harness);

    await harness.initialize();
    const taskCreatedResponse = expectResultMessage<{
      task: {
        taskId: string;
      };
    }>(
      await harness.request("tools/call", {
        name: "editor.state.read",
        arguments: VALID_SAMPLES["editor.state.read"].input,
        task: {
          ttl: 1_500
        }
      })
    );
    const taskId = taskCreatedResponse.result.task.taskId;
    const taskResultPromise = harness.request(
      "tasks/result",
      {
        taskId
      },
      "tasks-result-stdio-roots-invalidated"
    );

    const firstRootsRequestMessage = await harness.collector.waitFor(
      "first queued roots request",
      (message: any) => message.method === "roots/list"
    );
    if (!("id" in firstRootsRequestMessage) || firstRootsRequestMessage.id === undefined) {
      throw new Error("Expected the first queued roots request to include an id.");
    }

    await harness.respond(firstRootsRequestMessage.id, {
      result: {
        roots: [
          {
            uri: "file:///sandbox-root",
            name: "InitialRoot"
          }
        ]
      }
    });

    await harness.notify("notifications/roots/list_changed");
    continueAfterInvalidation.resolve();

    const secondRootsRequestMessage = await harness.collector.waitFor(
      "second queued roots request after invalidation",
      (message: any) =>
        message.method === "roots/list" &&
        "id" in message &&
        message.id !== firstRootsRequestMessage.id
    );
    if (!("id" in secondRootsRequestMessage) || secondRootsRequestMessage.id === undefined) {
      throw new Error("Expected the second queued roots request to include an id.");
    }

    await harness.respond(secondRootsRequestMessage.id, {
      result: {
        roots: [
          {
            uri: "file:///sandbox-root-updated",
            name: "UpdatedRoot"
          }
        ]
      }
    });

    const taskResultResponse = expectResultMessage(await taskResultPromise);
    expect(taskResultResponse.result.structuredContent).toMatchObject({
      ...VALID_SAMPLES["editor.state.read"].output,
      workspaceName: "InitialRoot|UpdatedRoot"
    });
  });
});
