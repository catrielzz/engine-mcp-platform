import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import type {
  EngineMcpAdapterResourceDefinition,
  EngineMcpAdapterStateResource,
  EngineMcpCapabilityAdapter
} from "../shared.js";
import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI
} from "../shared.js";

export async function listRegisteredResources(
  adapter: EngineMcpCapabilityAdapter
): Promise<readonly EngineMcpAdapterResourceDefinition[]> {
  const resourcesByUri = new Map<string, EngineMcpAdapterResourceDefinition>();

  resourcesByUri.set(CORE_SERVER_ADAPTER_STATE_RESOURCE_URI, {
    uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
    name: "adapter-state",
    title: "Adapter State",
    description:
      "Current adapter selection, health, and conformance snapshot for the Engine MCP core server.",
    mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE
  });

  for (const resource of (await adapter.listResources?.()) ?? []) {
    resourcesByUri.set(resource.uri, resource);
  }

  return Object.freeze([...resourcesByUri.values()]);
}

export async function readRegisteredResource(options: {
  uri: string;
  adapter: EngineMcpCapabilityAdapter;
  getAdapterStateResource: () => EngineMcpAdapterStateResource;
}): Promise<{
  contents: Array<{
    uri: string;
    mimeType?: string;
    text: string;
  }>;
}> {
  if (options.uri === CORE_SERVER_ADAPTER_STATE_RESOURCE_URI) {
    return {
      contents: [
        {
          uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
          mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
          text: JSON.stringify(options.getAdapterStateResource(), null, 2)
        }
      ]
    };
  }

  const content = await options.adapter.readResource?.(options.uri);

  if (!content) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${options.uri}`);
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
