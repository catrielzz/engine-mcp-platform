import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createUnityLocalBridgeSessionBootstrap,
  getDefaultUnityPluginSessionBootstrapPath,
  writeUnityPluginSessionBootstrap
} from "../index.js";

interface ManagedSessionLike {
  stop(): Promise<void>;
}

export interface UnityBridgeBootstrapHarness {
  createTempDirectory(prefix?: string): Promise<string>;
  registerManagedSession<T extends ManagedSessionLike>(session: T): T;
  writePluginBootstrap(options: {
    tempDirectory: string;
    endpointUrl: string;
    sessionToken: string;
    createdAt?: string;
    ownerProcessId?: number;
  }): Promise<string>;
  cleanup(): Promise<void>;
}

export function createUnityBridgeBootstrapHarness(): UnityBridgeBootstrapHarness {
  const directories: string[] = [];
  const managedSessions: ManagedSessionLike[] = [];

  return {
    async createTempDirectory(prefix = "engine-mcp-plugin-proxy-") {
      const directory = await mkdtemp(join(tmpdir(), prefix));
      directories.push(directory);
      return directory;
    },
    registerManagedSession<T extends ManagedSessionLike>(session: T): T {
      managedSessions.push(session);
      return session;
    },
    async writePluginBootstrap(options) {
      const bootstrapFilePath = getDefaultUnityPluginSessionBootstrapPath(options.tempDirectory);

      await writeUnityPluginSessionBootstrap(
        createUnityLocalBridgeSessionBootstrap(
          options.endpointUrl,
          options.sessionToken,
          options.createdAt,
          options.ownerProcessId
        ),
        bootstrapFilePath
      );

      return bootstrapFilePath;
    },
    async cleanup() {
      while (managedSessions.length > 0) {
        await managedSessions.pop()!.stop();
      }

      while (directories.length > 0) {
        await rm(directories.pop()!, {
          force: true,
          recursive: true
        });
      }
    }
  };
}
