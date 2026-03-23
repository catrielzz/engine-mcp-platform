import type { ValidateFunction } from "ajv";

import {
  ALL_CAPABILITY_DESCRIPTORS,
  ALL_CAPABILITY_NAMES,
  EXPERIMENTAL_CAPABILITY_CATALOG,
  P0_CAPABILITY_CATALOG
} from "../registry/catalogs.js";
import type {
  CapabilityCatalog,
  CapabilityContract,
  CapabilityDescriptor,
  CapabilityName,
  ContractValidationResult
} from "../types.js";
import { ajv, capabilityCatalogValidator, getRequiredValidator, runValidation } from "./ajv.js";

function buildCapabilityContracts(
  catalogs: readonly CapabilityCatalog[]
): Record<CapabilityName, CapabilityContract> {
  const contracts = {} as Record<CapabilityName, CapabilityContract>;

  for (const catalog of catalogs) {
    for (const descriptor of catalog.capabilities) {
      contracts[descriptor.capability] = {
        descriptor,
        input: getRequiredValidator(ajv, descriptor.inputSchema),
        output: getRequiredValidator(ajv, descriptor.outputSchema)
      };
    }
  }

  return contracts;
}

const capabilityContracts = buildCapabilityContracts([
  P0_CAPABILITY_CATALOG,
  EXPERIMENTAL_CAPABILITY_CATALOG
]);

export function isCapabilityName(value: string): value is CapabilityName {
  return ALL_CAPABILITY_NAMES.includes(value as CapabilityName);
}

export function validateCapabilityCatalog(value: unknown): ContractValidationResult {
  return runValidation(capabilityCatalogValidator, value);
}

export function getCapabilityDescriptor(capability: CapabilityName): CapabilityDescriptor {
  return capabilityContracts[capability].descriptor;
}

export function validateCapabilityInput(
  capability: CapabilityName,
  value: unknown
): ContractValidationResult {
  return runValidation(capabilityContracts[capability].input as ValidateFunction, value);
}

export function validateCapabilityOutput(
  capability: CapabilityName,
  value: unknown
): ContractValidationResult {
  return runValidation(capabilityContracts[capability].output as ValidateFunction, value);
}

export { ALL_CAPABILITY_DESCRIPTORS };
