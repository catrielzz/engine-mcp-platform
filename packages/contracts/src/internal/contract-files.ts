import { readdirSync, readFileSync } from "node:fs";

import type { JsonSchemaDocument } from "../types.js";

export const CONTRACTS_ROOT_URL = new URL("../../../../contracts/", import.meta.url);
export const COMMON_SCHEMAS_URL = new URL("schemas/", CONTRACTS_ROOT_URL);
export const CAPABILITIES_URL = new URL("capabilities/", CONTRACTS_ROOT_URL);
export const COMMON_SCHEMA_URL = new URL("schemas/common.schema.json", CONTRACTS_ROOT_URL);
export const P0_CATALOG_URL = new URL("capabilities/p0.catalog.json", CONTRACTS_ROOT_URL);
export const EXPERIMENTAL_CATALOG_URL = new URL(
  "capabilities/experimental.catalog.json",
  CONTRACTS_ROOT_URL
);
export const CAPABILITY_CATALOG_SCHEMA_ID =
  "https://engine-mcp-platform.local/contracts/schemas/capability-catalog.schema.json";

export function readJsonFile<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

export function isJsonSchemaDocument(value: unknown): value is JsonSchemaDocument {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "$id" in value &&
      typeof value.$id === "string"
  );
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function collectSchemaUrls(directoryUrl: URL): URL[] {
  const schemaUrls: URL[] = [];

  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      schemaUrls.push(...collectSchemaUrls(new URL(`${entry.name}/`, directoryUrl)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      schemaUrls.push(new URL(entry.name, directoryUrl));
    }
  }

  return schemaUrls.sort((left, right) => left.href.localeCompare(right.href));
}
