import {
  getCapabilityDescriptor,
  getCapabilitySchemas,
  type CapabilityName,
  type ContractValidationIssue
} from "@engine-mcp/contracts";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";

import { isJsonRecord, readErrorMessage } from "./json.js";
import type { EngineMcpToolError } from "../shared.js";

export function createToolDefinition(
  capability: CapabilityName,
  adapterId: string,
  taskSupport: "forbidden" | "optional"
): Record<string, unknown> {
  const descriptor = getCapabilityDescriptor(capability);
  const schemas = getCapabilitySchemas(capability);

  return {
    name: descriptor.capability,
    title: descriptor.capability,
    description: descriptor.summary,
    inputSchema: schemas.inputSchema,
    outputSchema: schemas.outputSchema,
    annotations: {
      readOnlyHint: descriptor.operationClass === "read",
      destructiveHint: descriptor.operationClass === "destructive",
      idempotentHint: descriptor.operationClass === "read",
      openWorldHint: false
    },
    execution: {
      taskSupport
    },
    _meta: {
      "engine-mcp/adapter": adapterId,
      "engine-mcp/capability": descriptor.capability,
      "engine-mcp/operationClass": descriptor.operationClass,
      "engine-mcp/contractStatus": descriptor.status
    }
  };
}

export function createToolSuccessResult(
  capability: CapabilityName,
  adapterId: string,
  structuredContent: Record<string, unknown>
): {
  _meta: Record<string, unknown>;
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    _meta: {
      "engine-mcp/capability": capability,
      "engine-mcp/resultAdapter": adapterId
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

export function createToolErrorResult(
  capabilityOrToolName: string,
  error: EngineMcpToolError
): {
  _meta: Record<string, unknown>;
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: Record<string, unknown>;
  isError: true;
} {
  return {
    _meta: {
      "engine-mcp/capability": capabilityOrToolName,
      "engine-mcp/errorCode": error.code
    },
    content: [
      {
        type: "text",
        text: `${capabilityOrToolName} failed: ${error.message}`
      }
    ],
    structuredContent: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    },
    isError: true
  };
}

export function normalizeToolError(error: unknown): EngineMcpToolError {
  if (isJsonRecord(error) && Array.isArray(error.issues)) {
    return {
      code: "validation_error",
      message: readErrorMessage(error, "Validation failure."),
      details: {
        issues: error.issues as readonly ContractValidationIssue[]
      }
    };
  }

  if (isJsonRecord(error) && isJsonRecord(error.decision)) {
    const decisionReason =
      typeof error.decision.reason === "string" ? error.decision.reason : undefined;

    return {
      code: typeof error.decision.code === "string" ? error.decision.code : "policy_denied",
      message: decisionReason ?? readErrorMessage(error, "Policy denied the request."),
      ...(error.decision.details !== undefined ? { details: error.decision.details } : {})
    };
  }

  if (isJsonRecord(error) && typeof error.code === "string") {
    return {
      code: error.code,
      message: readErrorMessage(error, "Tool execution failed."),
      ...(error.details !== undefined ? { details: error.details } : {})
    };
  }

  if (error instanceof UrlElicitationRequiredError) {
    return {
      code: "url_elicitation_required",
      message: error.message,
      details: {
        elicitations: error.elicitations
      }
    };
  }

  if (isJsonRecord(error) && typeof error.bootstrapFilePath === "string") {
    return {
      code: "bridge_bootstrap_unavailable",
      message: readErrorMessage(error, "Unity bridge bootstrap is unavailable."),
      details: {
        bootstrapFilePath: error.bootstrapFilePath
      }
    };
  }

  if (error instanceof Error) {
    return {
      code: "internal_error",
      message: error.message
    };
  }

  if (typeof error === "string") {
    return {
      code: "internal_error",
      message: error
    };
  }

  return {
    code: "internal_error",
    message: "Unhandled tool execution failure."
  };
}

export function uniqueCapabilities(capabilities: readonly CapabilityName[]): CapabilityName[] {
  return [...new Set(capabilities)];
}
