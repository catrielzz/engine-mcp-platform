import type {
  CapabilityDescriptor,
  CapabilityName,
  ContractValidationIssue
} from "@engine-mcp/contracts";
import { FIRST_CAPABILITY_SLICE } from "@engine-mcp/contracts";

export type ConformanceExpectation = "success" | "invalid-input-rejected" | "error";
export type ConformanceOutcome = "passed" | "failed" | "skipped";
export type ConformancePhase = "declaration" | "fixture" | "invoke" | "output";
export type P0CapabilityName = (typeof FIRST_CAPABILITY_SLICE)[number];

export interface CapabilityConformanceFixture {
  validInput: unknown;
  invalidInput: unknown;
}

export type P0CapabilityFixtures = Record<P0CapabilityName, CapabilityConformanceFixture>;

export interface ConformanceExpectedError {
  code?: string;
  message?: string;
  detailsSubset?: unknown;
}

export interface ConformanceCase {
  id: string;
  capability: CapabilityName;
  expectation: ConformanceExpectation;
  summary: string;
  input: unknown;
  expectedError?: ConformanceExpectedError;
  expectedOutputSubset?: unknown;
}

export interface ConformanceInvocation {
  capability: CapabilityName;
  input: unknown;
}

export interface ConformanceAdapter {
  adapter: string;
  capabilities?: readonly CapabilityName[];
  invoke(request: ConformanceInvocation): Promise<unknown> | unknown;
}

export interface ConformanceCaseResult {
  id: string;
  capability: CapabilityName;
  descriptor: CapabilityDescriptor;
  expectation: ConformanceExpectation;
  outcome: ConformanceOutcome;
  phase: ConformancePhase;
  summary: string;
  details?: string;
  validationErrors: readonly ContractValidationIssue[];
}

export interface ConformanceReport {
  adapter: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  missingCapabilities: readonly CapabilityName[];
  results: readonly ConformanceCaseResult[];
}

export interface RunConformanceOptions {
  requiredCapabilities?: readonly CapabilityName[];
}

export interface ReadHeavyConformanceCaseOptions {
  testJobId?: string;
  scriptPath?: string;
  scriptAssetGuid?: string;
}

export interface RunP0ConformanceOptions extends RunConformanceOptions {
  cases?: readonly ConformanceCase[];
}
