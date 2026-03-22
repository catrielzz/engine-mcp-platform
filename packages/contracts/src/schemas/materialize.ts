import {
  CAPABILITIES_URL,
  COMMON_SCHEMA_URL,
  collectSchemaUrls,
  isJsonRecord,
  isJsonSchemaDocument,
  readJsonFile
} from "../internal/contract-files.js";
import type { CapabilityName, CapabilitySchemas, JsonSchemaDocument } from "../types.js";
import { getCapabilityDescriptor } from "../validation/contracts.js";

function buildCapabilitySchemaIndex(): Map<string, JsonSchemaDocument> {
  return collectSchemaUrls(CAPABILITIES_URL).reduce((index, schemaUrl) => {
    const schema = readJsonFile<unknown>(schemaUrl);

    if (!isJsonSchemaDocument(schema)) {
      throw new Error(`Schema file is missing a string $id: ${schemaUrl.href}`);
    }

    index.set(schema.$id, schema);
    return index;
  }, new Map<string, JsonSchemaDocument>());
}

function rewriteSchemaRef(reference: string, commonSchemaId: string): string {
  const commonDefsPrefix = `${commonSchemaId}#/$defs/`;

  if (reference.startsWith(commonDefsPrefix)) {
    return reference.replace(commonSchemaId, "");
  }

  return reference;
}

function rewriteCommonSchemaRefs(value: unknown, commonSchemaId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteCommonSchemaRefs(entry, commonSchemaId));
  }

  if (!isJsonRecord(value)) {
    return value;
  }

  const rewrittenEntries = Object.entries(value).map(([key, entryValue]) => {
    if (key === "$ref" && typeof entryValue === "string") {
      return [key, rewriteSchemaRef(entryValue, commonSchemaId)] as const;
    }

    return [key, rewriteCommonSchemaRefs(entryValue, commonSchemaId)] as const;
  });

  return Object.fromEntries(rewrittenEntries);
}

function materializeCapabilitySchema(
  schema: JsonSchemaDocument,
  commonSchema: JsonSchemaDocument,
  commonSchemaId: string
): Record<string, unknown> {
  const rewrittenSchema = rewriteCommonSchemaRefs(schema, commonSchemaId);

  if (!isJsonRecord(rewrittenSchema)) {
    throw new Error(`Capability schema ${schema.$id} did not rewrite to an object.`);
  }

  const mergedDefs = {
    ...(isJsonRecord(commonSchema.$defs) ? commonSchema.$defs : {}),
    ...(isJsonRecord(rewrittenSchema.$defs) ? rewrittenSchema.$defs : {})
  };

  return {
    ...rewrittenSchema,
    ...(Object.keys(mergedDefs).length > 0 ? { $defs: mergedDefs } : {})
  };
}

const rawCommonSchema = readJsonFile<unknown>(COMMON_SCHEMA_URL);

if (!isJsonSchemaDocument(rawCommonSchema)) {
  throw new Error(`Schema file is missing a string $id: ${COMMON_SCHEMA_URL.href}`);
}

const commonSchema: JsonSchemaDocument = rawCommonSchema;
const commonSchemaId = commonSchema.$id;
const capabilitySchemaIndex = buildCapabilitySchemaIndex();
const materializedSchemaCache = new Map<string, Record<string, unknown>>();

function getMaterializedSchema(schemaId: string): Record<string, unknown> {
  const cachedSchema = materializedSchemaCache.get(schemaId);

  if (cachedSchema) {
    return cachedSchema;
  }

  const schema = capabilitySchemaIndex.get(schemaId);

  if (!schema) {
    throw new Error(`Capability schema not found for ${schemaId}.`);
  }

  const materializedSchema = materializeCapabilitySchema(schema, commonSchema, commonSchemaId);
  materializedSchemaCache.set(schemaId, materializedSchema);

  return materializedSchema;
}

export function getCapabilitySchemas(capability: CapabilityName): CapabilitySchemas {
  const descriptor = getCapabilityDescriptor(capability);

  return {
    inputSchema: getMaterializedSchema(descriptor.inputSchema),
    outputSchema: getMaterializedSchema(descriptor.outputSchema)
  };
}
