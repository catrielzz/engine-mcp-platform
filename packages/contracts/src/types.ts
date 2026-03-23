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

export type OperationClass =
  | "read"
  | "write_safe"
  | "write_project"
  | "destructive"
  | "external";

export type ContractStatus = "bootstrap" | "active" | "deprecated";

export interface CapabilityDescriptor {
  capability: CapabilityName;
  operationClass: OperationClass;
  status: ContractStatus;
  summary: string;
  inputSchema: string;
  outputSchema: string;
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
