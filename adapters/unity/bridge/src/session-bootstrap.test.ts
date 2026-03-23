import { readdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedUnityBridgeLocalHttpSession,
  createUnityLocalBridgeRequest,
  createUnityBridgeSandboxAdapter,
  createUnityBridgeSessionToken,
  getDefaultUnityBridgeSessionBootstrapPath,
  readUnityBridgeSessionBootstrap,
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  writeUnityBridgeSessionBootstrapForLocalHttp
} from "./index.js";
import { createUnityBridgeBootstrapHarness } from "./test-support/bootstrap.js";

describe("@engine-mcp/unity-bridge session bootstrap", () => {
  const bootstrapHarness = createUnityBridgeBootstrapHarness();

  afterEach(async () => {
    await bootstrapHarness.cleanup();
  });

  async function waitForCondition(
    condition: () => Promise<boolean>,
    timeoutMs: number = 500
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await delay(10);
    }

    throw new Error(`Timed out waiting for test condition after ${timeoutMs}ms.`);
  }

  it("writes and reads a local HTTP bootstrap manifest", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory("engine-mcp-bootstrap-");
    const filePath = getDefaultUnityBridgeSessionBootstrapPath(tempDirectory);
    const sessionToken = createUnityBridgeSessionToken();

    const written = await writeUnityBridgeSessionBootstrapForLocalHttp(
      "http://127.0.0.1:38123/bridge/call",
      sessionToken,
      filePath
    );
    const loaded = await readUnityBridgeSessionBootstrap(filePath);

    expect(written.filePath).toBe(filePath);
    expect(loaded.transport).toBe("local_http");
    expect(loaded.endpointUrl).toBe("http://127.0.0.1:38123/bridge/call");
    expect(loaded.sessionToken).toBe(sessionToken);
    expect(loaded.ownerProcessId).toBe(process.pid);

    const siblingEntries = await readdir(dirname(filePath));
    expect(
      siblingEntries.filter(
        (entry) => entry.startsWith(`${basename(filePath)}.`) && entry.endsWith(".tmp")
      )
    ).toEqual([]);
  });

  it("writes a bootstrap manifest for a managed local HTTP session and removes it on stop", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory("engine-mcp-bootstrap-");
    const bootstrapFilePath = getDefaultUnityBridgeSessionBootstrapPath(tempDirectory);
    const session = bootstrapHarness.registerManagedSession(createManagedUnityBridgeLocalHttpSession({
      adapter: createUnityBridgeSandboxAdapter(),
      port: 0,
      bootstrapFilePath
    }));

    const started = await session.start();
    const loaded = await readUnityBridgeSessionBootstrap(bootstrapFilePath);

    expect(started.bootstrapFilePath).toBe(bootstrapFilePath);
    expect(loaded.endpointUrl).toBe(started.address.url);
    expect(loaded.sessionToken).toBe(started.sessionToken);
    expect(loaded.ownerProcessId).toBe(process.pid);

    await session.stop();

    await expect(readUnityBridgeSessionBootstrap(bootstrapFilePath)).rejects.toThrow();
  });

  it("removes the bootstrap manifest when a managed local HTTP session expires from idle inactivity", async () => {
    const tempDirectory = await bootstrapHarness.createTempDirectory("engine-mcp-bootstrap-");
    const bootstrapFilePath = getDefaultUnityBridgeSessionBootstrapPath(tempDirectory);
    const session = bootstrapHarness.registerManagedSession(
      createManagedUnityBridgeLocalHttpSession({
        adapter: createUnityBridgeSandboxAdapter(),
        port: 0,
        bootstrapFilePath,
        sessionIdleTtlMs: 40,
        sessionSweepIntervalMs: 10
      })
    );

    const started = await session.start();
    expect(await readUnityBridgeSessionBootstrap(bootstrapFilePath)).toEqual(started.bootstrap);

    await waitForCondition(async () => {
      try {
        await readUnityBridgeSessionBootstrap(bootstrapFilePath);
        return false;
      } catch {
        return true;
      }
    });

    const response = await fetch(started.address.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: started.sessionToken
      },
      body: JSON.stringify(
        createUnityLocalBridgeRequest({
          requestId: "req-after-idle-expiry",
          capability: "editor.state.read",
          sessionScope: "inspect",
          payload: {}
        })
      )
    });

    expect(response.status).toBe(401);
    await expect(readUnityBridgeSessionBootstrap(bootstrapFilePath)).rejects.toThrow();
  });
});
