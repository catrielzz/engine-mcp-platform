import {
  ALL_PROMPT_DEFINITIONS,
  filterPromptDefinitions,
  getPromptDefinitionFromSet,
  listPromptDefinitionNames,
  renderPromptDefinition,
  validateCapabilityOutput
} from "@engine-mcp/contracts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError, type CompleteRequest, type Prompt, type PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  PromptDefinition
} from "@engine-mcp/contracts";

import { createInvocationContext } from "./invocation-context.js";
import type { EngineMcpCapabilityAdapter, EngineMcpCoreRequestExtra } from "../shared.js";

const MAX_COMPLETION_VALUES = 100;

export function listRegisteredPrompts(adapter: EngineMcpCapabilityAdapter): Prompt[] {
  return getRegisteredPromptDefinitions(adapter).map((promptDefinition) => ({
    name: promptDefinition.name,
    ...(promptDefinition.title ? { title: promptDefinition.title } : {}),
    ...(promptDefinition.description
      ? { description: promptDefinition.description }
      : {}),
    ...(promptDefinition.arguments
      ? { arguments: [...promptDefinition.arguments] }
      : {})
  }));
}

export function getRenderedPrompt(
  promptName: string,
  promptArguments: Record<string, string> | undefined,
  adapter: EngineMcpCapabilityAdapter
): {
  description?: string;
  messages: PromptMessage[];
} {
  const promptDefinition = getPromptDefinitionFromSet(
    getRegisteredPromptDefinitions(adapter),
    promptName,
    adapter.capabilities
  );

  if (!promptDefinition) {
    throw new McpError(ErrorCode.InvalidParams, `Prompt ${promptName} not found.`);
  }

  try {
    const renderedPrompt = renderPromptDefinition(promptDefinition, promptArguments ?? {});

    return {
      ...(renderedPrompt.description ? { description: renderedPrompt.description } : {}),
      messages: renderedPrompt.messages.map((message) => ({
        role: message.role,
        content: {
          type: "text",
          text: message.content.text
        }
      }))
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for prompt ${promptName}: ${getErrorMessage(error)}`
    );
  }
}

export function getVisiblePromptNames(
  adapter: EngineMcpCapabilityAdapter
): readonly string[] {
  return listPromptDefinitionNames(getRegisteredPromptDefinitions(adapter), adapter.capabilities);
}

export async function completePromptArgument(
  server: Server,
  extra: EngineMcpCoreRequestExtra,
  adapter: EngineMcpCapabilityAdapter,
  params: CompleteRequest["params"]
): Promise<{
  completion: {
    values: string[];
    total: number;
    hasMore?: boolean;
  };
}> {
  if (params.ref.type !== "ref/prompt") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported completion reference type: ${params.ref.type}.`
    );
  }

  const promptDefinition = getPromptDefinitionFromSet(
    getRegisteredPromptDefinitions(adapter),
    params.ref.name,
    adapter.capabilities
  );

  if (!promptDefinition) {
    throw new McpError(ErrorCode.InvalidParams, `Prompt ${params.ref.name} not found.`);
  }

  const argumentDescriptor = promptDefinition.arguments?.find(
    ({ name }) => name === params.argument.name
  );

  if (!argumentDescriptor) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Prompt ${params.ref.name} does not define argument ${params.argument.name}.`
    );
  }

  const completionMetadata = argumentDescriptor.completion;

  if (!completionMetadata) {
    return {
      completion: {
        values: [],
        total: 0
      }
    };
  }

  const values = await resolvePromptCompletionValues(
    server,
    extra,
    adapter,
    promptDefinition,
    params.argument.name,
    completionMetadata,
    params.argument.value
  );
  const filteredValues = rankAndFilterCompletionValues(values, params.argument.value);
  const limitedValues = filteredValues.slice(0, MAX_COMPLETION_VALUES);

  return {
    completion: {
      values: limitedValues,
      total: filteredValues.length,
      ...(filteredValues.length > limitedValues.length ? { hasMore: true } : {})
    }
  };
}

function getRegisteredPromptDefinitions(
  adapter: EngineMcpCapabilityAdapter
): readonly PromptDefinition[] {
  return filterPromptDefinitions(
    mergePromptDefinitions(ALL_PROMPT_DEFINITIONS, adapter.prompts ?? []),
    adapter.capabilities
  );
}

function mergePromptDefinitions(
  basePromptDefinitions: readonly PromptDefinition[],
  adapterPromptDefinitions: readonly PromptDefinition[]
): readonly PromptDefinition[] {
  const promptDefinitionsByName = new Map<string, PromptDefinition>();

  for (const promptDefinition of basePromptDefinitions) {
    promptDefinitionsByName.set(promptDefinition.name, promptDefinition);
  }

  for (const promptDefinition of adapterPromptDefinitions) {
    promptDefinitionsByName.set(promptDefinition.name, promptDefinition);
  }

  return Object.freeze([...promptDefinitionsByName.values()]);
}

async function resolvePromptCompletionValues(
  server: Server,
  extra: EngineMcpCoreRequestExtra,
  adapter: EngineMcpCapabilityAdapter,
  promptDefinition: PromptDefinition,
  argumentName: string,
  completionMetadata: NonNullable<
    NonNullable<PromptDefinition["arguments"]>[number]["completion"]
  >,
  partialValue: string
): Promise<string[]> {
  switch (completionMetadata.provider) {
    case "static.values":
      return completionMetadata.values ? [...completionMetadata.values] : [];
    case "scene.logical_name":
      return completeSceneLogicalNames(server, extra, adapter);
    case "asset.script_path":
      return completeScriptAssetPaths(server, extra, adapter, partialValue);
    case "engine.snapshot_id":
    case "engine.test_name":
      return completeAdapterBackedPromptValues(
        adapter,
        promptDefinition.name,
        argumentName,
        completionMetadata.provider,
        partialValue
      );
    default:
      return [];
  }
}

async function completeAdapterBackedPromptValues(
  adapter: EngineMcpCapabilityAdapter,
  promptName: string,
  argumentName: string,
  provider: "engine.snapshot_id" | "engine.test_name",
  partialValue: string
): Promise<string[]> {
  const values = await adapter.completePromptArgument?.({
    promptName,
    argumentName,
    provider,
    value: partialValue
  });

  return values ? [...values] : [];
}

async function completeSceneLogicalNames(
  server: Server,
  extra: EngineMcpCoreRequestExtra,
  adapter: EngineMcpCapabilityAdapter
): Promise<string[]> {
  if (!adapter.capabilities.includes("scene.hierarchy.read")) {
    return [];
  }

  const output = await adapter.invoke({
    capability: "scene.hierarchy.read",
    input: {},
    context: createInvocationContext(server, extra)
  });
  const validation = validateCapabilityOutput("scene.hierarchy.read", output);

  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InternalError,
      "Adapter returned an invalid scene.hierarchy.read payload while resolving prompt completions."
    );
  }

  if (!isJsonRecord(output) || !Array.isArray(output.roots)) {
    return [];
  }

  return uniqueCompletionValues(collectLogicalNames(output.roots));
}

async function completeScriptAssetPaths(
  server: Server,
  extra: EngineMcpCoreRequestExtra,
  adapter: EngineMcpCapabilityAdapter,
  partialValue: string
): Promise<string[]> {
  if (!adapter.capabilities.includes("asset.search")) {
    return [];
  }

  const output = await adapter.invoke({
    capability: "asset.search",
    input: {
      query: partialValue,
      kinds: ["script"],
      limit: 50
    },
    context: createInvocationContext(server, extra)
  });
  const validation = validateCapabilityOutput("asset.search", output);

  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InternalError,
      "Adapter returned an invalid asset.search payload while resolving prompt completions."
    );
  }

  if (!isJsonRecord(output) || !Array.isArray(output.results)) {
    return [];
  }

  return uniqueCompletionValues(
    output.results.flatMap((result) =>
      isJsonRecord(result) && typeof result.assetPath === "string" ? [result.assetPath] : []
    )
  );
}

function collectLogicalNames(nodes: unknown[]): string[] {
  const names: string[] = [];

  for (const node of nodes) {
    if (!isJsonRecord(node)) {
      continue;
    }

    const objectRecord = isJsonRecord(node.object) ? node.object : undefined;

    if (objectRecord && typeof objectRecord.logicalName === "string") {
      names.push(objectRecord.logicalName);
    }

    if (Array.isArray(node.children)) {
      names.push(...collectLogicalNames(node.children));
    }
  }

  return names;
}

function rankAndFilterCompletionValues(
  values: readonly string[],
  partialValue: string
): string[] {
  const query = partialValue.trim().toLowerCase();

  const filteredValues =
    query.length === 0
      ? [...values]
      : values.filter((value) => value.toLowerCase().includes(query));

  return filteredValues.sort((left, right) => {
    const leftLower = left.toLowerCase();
    const rightLower = right.toLowerCase();
    const leftStartsWith = query.length > 0 && leftLower.startsWith(query);
    const rightStartsWith = query.length > 0 && rightLower.startsWith(query);

    if (leftStartsWith !== rightStartsWith) {
      return leftStartsWith ? -1 : 1;
    }

    return left.localeCompare(right);
  });
}

function uniqueCompletionValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
