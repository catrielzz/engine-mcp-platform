import {
  EXPERIMENTAL_CATALOG_URL,
  P0_CATALOG_URL,
  readJsonFile
} from "../internal/contract-files.js";
import { capabilityCatalogValidator, runValidation } from "../validation/ajv.js";
import type {
  CapabilityCatalog,
  CapabilityCatalogRecord,
  CapabilityDescriptor,
  CapabilityName,
  ContractStatus,
  OperationClass
} from "../types.js";

export const PLATFORM_NAMESPACE = "engine-mcp-platform";

export const FIRST_CAPABILITY_SLICE = [
  "editor.state.read",
  "scene.hierarchy.read",
  "scene.object.create",
  "scene.object.update",
  "scene.object.delete",
  "asset.search",
  "script.validate",
  "console.read",
  "test.run",
  "test.job.read"
] as const satisfies readonly CapabilityName[];

export const EXPERIMENTAL_CAPABILITY_SLICE = ["snapshot.restore"] as const satisfies readonly CapabilityName[];

export const ALL_CAPABILITY_NAMES = [
  ...FIRST_CAPABILITY_SLICE,
  ...EXPERIMENTAL_CAPABILITY_SLICE
] as const satisfies readonly CapabilityName[];

function normalizeCapabilityCatalog(
  record: CapabilityCatalogRecord,
  expectedCapabilities: readonly CapabilityName[],
  label: string
): CapabilityCatalog {
  if (record.capabilities.length !== expectedCapabilities.length) {
    throw new Error(
      `${label} catalog length mismatch. Expected ${expectedCapabilities.length}, received ${record.capabilities.length}.`
    );
  }

  const capabilities = record.capabilities.map((descriptor, index) => {
    const expectedCapability = expectedCapabilities[index];

    if (descriptor.capability !== expectedCapability) {
      throw new Error(
        `${label} catalog ordering mismatch at index ${index}. Expected ${expectedCapability}, received ${descriptor.capability}.`
      );
    }

    return Object.freeze({
      capability: expectedCapability,
      operationClass: descriptor.operationClass as OperationClass,
      status: descriptor.status as ContractStatus,
      summary: descriptor.summary,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema
    }) as CapabilityDescriptor;
  });

  return Object.freeze({
    slice: record.slice,
    version: record.version,
    capabilities: Object.freeze(capabilities)
  });
}

const rawP0CapabilityCatalog = readJsonFile<CapabilityCatalogRecord>(P0_CATALOG_URL);
const rawExperimentalCapabilityCatalog = readJsonFile<CapabilityCatalogRecord>(
  EXPERIMENTAL_CATALOG_URL
);
const capabilityCatalogValidation = runValidation(capabilityCatalogValidator, rawP0CapabilityCatalog);
const experimentalCapabilityCatalogValidation = runValidation(
  capabilityCatalogValidator,
  rawExperimentalCapabilityCatalog
);

if (!capabilityCatalogValidation.valid) {
  throw new Error(
    `Invalid P0 capability catalog: ${capabilityCatalogValidation.errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")}`
  );
}

if (!experimentalCapabilityCatalogValidation.valid) {
  throw new Error(
    `Invalid experimental capability catalog: ${experimentalCapabilityCatalogValidation.errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")}`
  );
}

export const P0_CAPABILITY_CATALOG = normalizeCapabilityCatalog(
  rawP0CapabilityCatalog,
  FIRST_CAPABILITY_SLICE,
  "P0"
);

export const EXPERIMENTAL_CAPABILITY_CATALOG = normalizeCapabilityCatalog(
  rawExperimentalCapabilityCatalog,
  EXPERIMENTAL_CAPABILITY_SLICE,
  "Experimental"
);

export const P0_CAPABILITY_DESCRIPTORS = P0_CAPABILITY_CATALOG.capabilities;
export const EXPERIMENTAL_CAPABILITY_DESCRIPTORS = EXPERIMENTAL_CAPABILITY_CATALOG.capabilities;
export const ALL_CAPABILITY_DESCRIPTORS = Object.freeze([
  ...P0_CAPABILITY_DESCRIPTORS,
  ...EXPERIMENTAL_CAPABILITY_DESCRIPTORS
]);
