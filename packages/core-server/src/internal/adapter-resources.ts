import { McpError } from "@modelcontextprotocol/sdk/types.js";

import type {
  EngineMcpAdapterResourceDefinition,
  EngineMcpAdapterStateResource,
  EngineMcpCapabilityAdapter,
  EngineMcpJournalService,
  EngineMcpSnapshotMetadataStore
} from "../shared.js";
import { listCoreRuntimeResources, readCoreRuntimeResource } from "./runtime-resources.js";

export const MCP_RESOURCE_NOT_FOUND_ERROR_CODE = -32002;

export function createResourceNotFoundError(uri: string): McpError {
  return new McpError(MCP_RESOURCE_NOT_FOUND_ERROR_CODE, "Resource not found", {
    uri
  });
}

export async function listRegisteredResources(
  adapter: EngineMcpCapabilityAdapter
): Promise<readonly EngineMcpAdapterResourceDefinition[]> {
  const resourcesByUri = new Map<string, EngineMcpAdapterResourceDefinition>();

  for (const resource of listCoreRuntimeResources()) {
    resourcesByUri.set(resource.uri, resource);
  }

  for (const resource of (await adapter.listResources?.()) ?? []) {
    resourcesByUri.set(resource.uri, resource);
  }

  return Object.freeze([...resourcesByUri.values()]);
}

export async function readRegisteredResource(options: {
  uri: string;
  adapter: EngineMcpCapabilityAdapter;
  getAdapterStateResource: () => EngineMcpAdapterStateResource;
  journalService: EngineMcpJournalService;
  snapshotMetadataStore: EngineMcpSnapshotMetadataStore;
}): Promise<{
  contents: Array<{
    uri: string;
    mimeType?: string;
    text: string;
  }>;
}> {
  const runtimeContent = await readCoreRuntimeResource({
    uri: options.uri,
    getAdapterStateResource: options.getAdapterStateResource,
    journalService: options.journalService,
    snapshotMetadataStore: options.snapshotMetadataStore
  });

  if (runtimeContent) {
    return {
      contents: [
        {
          uri: runtimeContent.uri,
          ...(runtimeContent.mimeType ? { mimeType: runtimeContent.mimeType } : {}),
          text: runtimeContent.text
        }
      ]
    };
  }

  const content = await options.adapter.readResource?.(options.uri);

  if (!content) {
    throw createResourceNotFoundError(options.uri);
  }

  return {
    contents: [
      {
        uri: content.uri,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        text: content.text
      }
    ]
  };
}

export async function isKnownResourceUri(
  adapter: EngineMcpCapabilityAdapter,
  uri: string
): Promise<boolean> {
  const resources = await listRegisteredResources(adapter);
  return resources.some((resource) => resource.uri === uri);
}
