import {
  FIRST_CAPABILITY_SLICE,
  getCapabilityDescriptor,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName,
  type ContractValidationIssue
} from "@engine-mcp/contracts";

import { P0_CONFORMANCE_CASES } from "../cases/p0.js";
import { matchesExpectedError, matchesExpectedSubset, normalizeErrorDetails } from "./matching.js";
import type {
  ConformanceAdapter,
  ConformanceCase,
  ConformanceCaseResult,
  ConformanceOutcome,
  ConformancePhase,
  ConformanceReport,
  RunConformanceOptions,
  RunP0ConformanceOptions
} from "../types.js";

function uniqueCapabilities(capabilities: readonly CapabilityName[]): CapabilityName[] {
  return [...new Set(capabilities)];
}

function makeResult(
  capability: CapabilityName,
  inputCase: ConformanceCase,
  outcome: ConformanceOutcome,
  phase: ConformancePhase,
  summary: string,
  details?: string,
  validationErrors: readonly ContractValidationIssue[] = []
): ConformanceCaseResult {
  return {
    id: inputCase.id,
    capability,
    descriptor: getCapabilityDescriptor(capability),
    expectation: inputCase.expectation,
    outcome,
    phase,
    summary,
    details,
    validationErrors
  };
}

export function getMissingCapabilities(
  adapterCapabilities: readonly CapabilityName[] | undefined,
  requiredCapabilities: readonly CapabilityName[]
): readonly CapabilityName[] {
  if (!adapterCapabilities) {
    return [];
  }

  const declaredCapabilities = new Set(adapterCapabilities);

  return requiredCapabilities.filter((capability) => !declaredCapabilities.has(capability));
}

export async function runConformanceSuite(
  adapter: ConformanceAdapter,
  cases: readonly ConformanceCase[],
  options: RunConformanceOptions = {}
): Promise<ConformanceReport> {
  const requiredCapabilities = uniqueCapabilities(
    options.requiredCapabilities ?? cases.map(({ capability }) => capability)
  );
  const missingCapabilities = getMissingCapabilities(adapter.capabilities, requiredCapabilities);
  const missingCapabilitySet = new Set(missingCapabilities);
  const results: ConformanceCaseResult[] = missingCapabilities.map((capability) =>
    makeResult(
      capability,
      {
        id: `${capability}:declaration`,
        capability,
        expectation: "success",
        summary: `Adapter must declare support for ${capability}.`,
        input: null
      },
      "failed",
      "declaration",
      `Adapter does not declare support for ${capability}.`
    )
  );

  for (const inputCase of cases) {
    if (missingCapabilitySet.has(inputCase.capability)) {
      results.push(
        makeResult(
          inputCase.capability,
          inputCase,
          "skipped",
          "declaration",
          `Skipped because ${adapter.adapter} does not declare ${inputCase.capability}.`
        )
      );
      continue;
    }

    const inputValidation = validateCapabilityInput(inputCase.capability, inputCase.input);

    if (inputCase.expectation === "success") {
      if (!inputValidation.valid) {
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "fixture",
            `The success fixture for ${inputCase.capability} is not valid against the canonical input schema.`,
            undefined,
            inputValidation.errors
          )
        );
        continue;
      }

      let output: unknown;

      try {
        output = await adapter.invoke({
          capability: inputCase.capability,
          input: inputCase.input
        });
      } catch (error) {
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "invoke",
            `Adapter threw while handling a valid ${inputCase.capability} request.`,
            normalizeErrorDetails(error)
          )
        );
        continue;
      }

      const outputValidation = validateCapabilityOutput(inputCase.capability, output);

      if (!outputValidation.valid) {
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "output",
            `Adapter returned an invalid ${inputCase.capability} payload.`,
            undefined,
            outputValidation.errors
          )
        );
        continue;
      }

      if (!matchesExpectedSubset(output, inputCase.expectedOutputSubset)) {
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "output",
            `Adapter returned an unexpected ${inputCase.capability} payload.`,
            `Expected output subset ${JSON.stringify(inputCase.expectedOutputSubset)}, received ${JSON.stringify(output)}.`
          )
        );
        continue;
      }

      results.push(
        makeResult(
          inputCase.capability,
          inputCase,
          "passed",
          "output",
          `Adapter returned a contract-valid payload for ${inputCase.capability}.`
        )
      );
      continue;
    }

    if (inputCase.expectation === "error") {
      if (!inputValidation.valid) {
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "fixture",
            `The error fixture for ${inputCase.capability} is not valid against the canonical input schema.`,
            undefined,
            inputValidation.errors
          )
        );
        continue;
      }

      try {
        await adapter.invoke({
          capability: inputCase.capability,
          input: inputCase.input
        });
        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            "failed",
            "invoke",
            `Adapter accepted the ${inputCase.capability} request instead of returning the expected error.`
          )
        );
      } catch (error) {
        const expectedErrorMatch = matchesExpectedError(error, inputCase.expectedError);

        results.push(
          makeResult(
            inputCase.capability,
            inputCase,
            expectedErrorMatch.matched ? "passed" : "failed",
            "invoke",
            expectedErrorMatch.matched
              ? `Adapter returned the expected ${inputCase.capability} error.`
              : `Adapter returned an unexpected ${inputCase.capability} error.`,
            expectedErrorMatch.matched
              ? normalizeErrorDetails(error)
              : expectedErrorMatch.details ?? normalizeErrorDetails(error)
          )
        );
      }

      continue;
    }

    if (inputValidation.valid) {
      results.push(
        makeResult(
          inputCase.capability,
          inputCase,
          "failed",
          "fixture",
          `The invalid-input fixture for ${inputCase.capability} unexpectedly passed canonical validation.`
        )
      );
      continue;
    }

    try {
      await adapter.invoke({
        capability: inputCase.capability,
        input: inputCase.input
      });
      results.push(
        makeResult(
          inputCase.capability,
          inputCase,
          "failed",
          "invoke",
          `Adapter accepted an invalid ${inputCase.capability} request instead of rejecting it.`
        )
      );
    } catch (error) {
      results.push(
        makeResult(
          inputCase.capability,
          inputCase,
          "passed",
          "invoke",
          `Adapter rejected the invalid ${inputCase.capability} request as expected.`,
          normalizeErrorDetails(error),
          inputValidation.errors
        )
      );
    }
  }

  const passed = results.filter(({ outcome }) => outcome === "passed").length;
  const failed = results.filter(({ outcome }) => outcome === "failed").length;
  const skipped = results.filter(({ outcome }) => outcome === "skipped").length;

  return {
    adapter: adapter.adapter,
    total: results.length,
    passed,
    failed,
    skipped,
    missingCapabilities,
    results: Object.freeze(results)
  };
}

export async function runP0Conformance(
  adapter: ConformanceAdapter,
  options: RunP0ConformanceOptions = {}
): Promise<ConformanceReport> {
  return runConformanceSuite(adapter, options.cases ?? P0_CONFORMANCE_CASES, {
    requiredCapabilities: options.requiredCapabilities ?? FIRST_CAPABILITY_SLICE
  });
}

export function isConformancePassing(report: ConformanceReport): boolean {
  return report.failed === 0;
}

export function summarizeConformanceReport(report: ConformanceReport): string {
  return `${report.adapter}: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`;
}
