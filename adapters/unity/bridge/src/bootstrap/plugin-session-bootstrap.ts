import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_DIRECTORY,
  UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_FILE_NAME,
  createUnityLocalBridgeSessionBootstrap,
  parseUnityLocalBridgeSessionBootstrap,
  type UnityLocalBridgeSessionBootstrap
} from "../contracts/plugin-contract.js";
import { writeJsonFileDurably } from "./bootstrap-file.js";

export function getDefaultUnityPluginSessionBootstrapPath(baseDirectory: string = tmpdir()): string {
  return join(
    baseDirectory,
    ...UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_DIRECTORY.split("/"),
    UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_FILE_NAME
  );
}

export async function writeUnityPluginSessionBootstrap(
  bootstrap: UnityLocalBridgeSessionBootstrap,
  filePath: string = getDefaultUnityPluginSessionBootstrapPath()
): Promise<string> {
  return writeJsonFileDurably(resolve(filePath), bootstrap);
}

export async function readUnityPluginSessionBootstrap(
  filePath: string = getDefaultUnityPluginSessionBootstrapPath()
): Promise<UnityLocalBridgeSessionBootstrap> {
  const resolvedPath = resolve(filePath);
  const contents = await readFile(resolvedPath, "utf8");
  const bootstrap = parseUnityLocalBridgeSessionBootstrap(contents);

  if (!isProcessAlive(bootstrap.ownerProcessId)) {
    await deleteUnityPluginSessionBootstrap(resolvedPath);
    throw new Error(
      `Stale Unity plugin session bootstrap. Owner process ${bootstrap.ownerProcessId} is not running.`
    );
  }

  return bootstrap;
}

export async function deleteUnityPluginSessionBootstrap(
  filePath: string = getDefaultUnityPluginSessionBootstrapPath()
): Promise<void> {
  await rm(resolve(filePath), {
    force: true
  });
}

export async function writeUnityPluginSessionBootstrapForLocalHttp(
  endpointUrl: string,
  sessionToken: string,
  filePath?: string
): Promise<{
  bootstrap: UnityLocalBridgeSessionBootstrap;
  filePath: string;
}> {
  const bootstrap = createUnityLocalBridgeSessionBootstrap(endpointUrl, sessionToken);
  const resolvedPath = await writeUnityPluginSessionBootstrap(bootstrap, filePath);

  return {
    bootstrap,
    filePath: resolvedPath
  };
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code === "EPERM") {
      return true;
    }

    return false;
  }
}
