import type { ErrorObject, ValidateFunction } from "ajv";

export type CapabilityName =
  | "editor.state.read"
  | "scene.hierarchy.read"
  | "scene.object.create"
  | "scene.object.update"
  | "scene.object.delete"
  | "asset.search"
  | "script.validate"
  | "console.read"
  | "test.run"
  | "test.job.read"
  | "snapshot.restore";

export type OperationRiskClass =
  | "read"
  | "write_safe"
  | "write_project"
  | "destructive"
  | "external";

export type OperationClass = OperationRiskClass;

export type ContractStatus = "bootstrap" | "active" | "deprecated";

export interface CapabilityDescriptor {
  capability: CapabilityName;
  operationClass: OperationClass;
  status: ContractStatus;
  summary: string;
  inputSchema: string;
  outputSchema: string;
}

export interface PromptArgumentDescriptor {
  name: string;
  description?: string;
  required?: boolean;
  completion?: PromptArgumentCompletion;
}

export type PromptArgumentCompletionProvider =
  | "static.values"
  | "scene.logical_name"
  | "asset.script_path"
  | "engine.snapshot_id"
  | "engine.test_name";

export interface PromptArgumentCompletion {
  provider: PromptArgumentCompletionProvider;
  values?: readonly string[];
}

export interface PromptTextContentTemplate {
  type: "text";
  text: string;
}

export interface PromptMessageTemplate {
  role: "user" | "assistant";
  content: PromptTextContentTemplate;
}

export interface PromptDefinition {
  name: string;
  title?: string;
  description?: string;
  requiredCapabilities?: readonly CapabilityName[];
  arguments?: readonly PromptArgumentDescriptor[];
  messages: readonly PromptMessageTemplate[];
}

export interface PromptRenderResult {
  description?: string;
  messages: readonly PromptMessageTemplate[];
}

export interface CapabilityCatalog {
  slice: string;
  version: string;
  capabilities: readonly CapabilityDescriptor[];
}

export interface ContractValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
  schemaPath: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: readonly ContractValidationIssue[];
}

export interface CapabilitySchemas {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface CapabilityDescriptorRecord {
  capability: string;
  operationClass: string;
  status: string;
  summary: string;
  inputSchema: string;
  outputSchema: string;
}

export interface CapabilityCatalogRecord {
  slice: string;
  version: string;
  capabilities: CapabilityDescriptorRecord[];
}

export interface PromptDefinitionRecord {
  name: string;
  title?: string;
  description?: string;
  requiredCapabilities?: CapabilityName[];
  arguments?: PromptArgumentDescriptor[];
  messages: PromptMessageTemplate[];
}

export interface JsonSchemaDocument {
  $id: string;
  $defs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CapabilityContract {
  descriptor: CapabilityDescriptor;
  input: ValidateFunction;
  output: ValidateFunction;
}

export interface AjvLike {
  addSchema(schema: unknown): AjvLike;
  getSchema(schemaId: string): ValidateFunction | undefined;
}

export type AjvErrorObject = ErrorObject;
