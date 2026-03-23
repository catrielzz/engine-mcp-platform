import { createRequire } from "node:module";

import type { ValidateFunction } from "ajv";

import {
  CAPABILITIES_URL,
  CAPABILITY_CATALOG_SCHEMA_ID,
  COMMON_SCHEMAS_URL,
  collectSchemaUrls,
  isJsonSchemaDocument,
  readJsonFile
} from "../internal/contract-files.js";
import type {
  AjvErrorObject,
  AjvLike,
  ContractValidationIssue,
  ContractValidationResult
} from "../types.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020") as new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => AjvLike;

function normalizeAjvErrors(
  errors: AjvErrorObject[] | null | undefined
): ContractValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "validation error",
    schemaPath: error.schemaPath
  }));
}

export function buildAjv(): AjvLike {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  for (const schemaUrl of [
    ...collectSchemaUrls(COMMON_SCHEMAS_URL),
    ...collectSchemaUrls(CAPABILITIES_URL)
  ]) {
    const schema = readJsonFile<unknown>(schemaUrl);
    if (!isJsonSchemaDocument(schema)) {
      throw new Error(`Schema file is missing a string $id: ${schemaUrl.href}`);
    }

    ajv.addSchema(schema);
  }

  return ajv;
}

export function getRequiredValidator(ajv: AjvLike, schemaId: string): ValidateFunction {
  const validator = ajv.getSchema(schemaId);

  if (!validator) {
    throw new Error(`Validator not found for schema: ${schemaId}`);
  }

  return validator;
}

export function runValidation(
  validator: ValidateFunction,
  value: unknown
): ContractValidationResult {
  const valid = validator(value);

  return {
    valid,
    errors: valid ? [] : normalizeAjvErrors(validator.errors)
  };
}

export const ajv = buildAjv();
export const capabilityCatalogValidator = getRequiredValidator(ajv, CAPABILITY_CATALOG_SCHEMA_ID);
