import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  UNITY_LOCAL_SESSION_BOOTSTRAP_DIRECTORY,
  UNITY_LOCAL_SESSION_BOOTSTRAP_FILE_NAME,
  createUnityLocalBridgeSessionBootstrap,
  parseUnityLocalBridgeSessionBootstrap,
  type UnityLocalBridgeSessionBootstrap
} from "../contracts/plugin-contract.js";
import { writeJsonFileDurably } from "./bootstrap-file.js";

export function getDefaultUnityBridgeSessionBootstrapPath(baseDirectory: string = tmpdir()): string {
  return join(
    baseDirectory,
    ...UNITY_LOCAL_SESSION_BOOTSTRAP_DIRECTORY.split("/"),
    UNITY_LOCAL_SESSION_BOOTSTRAP_FILE_NAME
  );
}

export async function writeUnityBridgeSessionBootstrap(
  bootstrap: UnityLocalBridgeSessionBootstrap,
  filePath: string = getDefaultUnityBridgeSessionBootstrapPath()
): Promise<string> {
  return writeJsonFileDurably(resolve(filePath), bootstrap);
}

export async function readUnityBridgeSessionBootstrap(
  filePath: string = getDefaultUnityBridgeSessionBootstrapPath()
): Promise<UnityLocalBridgeSessionBootstrap> {
  const contents = await readFile(resolve(filePath), "utf8");

  return parseUnityLocalBridgeSessionBootstrap(contents);
}

export async function deleteUnityBridgeSessionBootstrap(
  filePath: string = getDefaultUnityBridgeSessionBootstrapPath()
): Promise<void> {
  await rm(resolve(filePath), {
    force: true
  });
}

export async function writeUnityBridgeSessionBootstrapForLocalHttp(
  endpointUrl: string,
  sessionToken: string,
  filePath?: string
): Promise<{
  bootstrap: UnityLocalBridgeSessionBootstrap;
  filePath: string;
}> {
  const bootstrap = createUnityLocalBridgeSessionBootstrap(endpointUrl, sessionToken);
  const resolvedPath = await writeUnityBridgeSessionBootstrap(bootstrap, filePath);

  return {
    bootstrap,
    filePath: resolvedPath
  };
}
