import type { ConformanceExpectedError } from "../types.js";

function normalizeErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error);
}

interface NormalizedConformanceError {
  code?: string;
  message?: string;
  details?: unknown;
}

function normalizeConformanceError(error: unknown): NormalizedConformanceError {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? { message: error.message } : {};
  }

  const errorRecord = error as Record<string, unknown>;
  const decision =
    "decision" in errorRecord && errorRecord.decision && typeof errorRecord.decision === "object"
      ? (errorRecord.decision as Record<string, unknown>)
      : undefined;

  return {
    ...(typeof errorRecord.code === "string"
      ? { code: errorRecord.code }
      : typeof decision?.code === "string"
        ? { code: decision.code }
        : {}),
    ...(typeof errorRecord.message === "string"
      ? { message: errorRecord.message }
      : typeof decision?.reason === "string"
        ? { message: decision.reason }
        : error instanceof Error
          ? { message: error.message }
          : {}),
    ...("details" in errorRecord
      ? { details: errorRecord.details }
      : typeof decision?.details !== "undefined"
        ? { details: decision.details }
        : {})
  };
}

export function matchesExpectedSubset(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) {
    return true;
  }

  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }

    return expected.every((entry, index) => matchesExpectedSubset(actual[index], entry));
  }

  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }

  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;

  return Object.entries(expectedRecord).every(([key, value]) =>
    matchesExpectedSubset(actualRecord[key], value)
  );
}

export function matchesExpectedError(
  error: unknown,
  expectedError: ConformanceExpectedError | undefined
): { matched: boolean; details?: string } {
  if (!expectedError) {
    return { matched: true };
  }

  const normalized = normalizeConformanceError(error);

  if (expectedError.code && normalized.code !== expectedError.code) {
    return {
      matched: false,
      details: `Expected error code ${expectedError.code}, received ${normalized.code ?? "(missing)"}.`
    };
  }

  if (expectedError.message && normalized.message !== expectedError.message) {
    return {
      matched: false,
      details: `Expected error message ${expectedError.message}, received ${normalized.message ?? "(missing)"}.`
    };
  }

  if (!matchesExpectedSubset(normalized.details, expectedError.detailsSubset)) {
    return {
      matched: false,
      details: `Expected error details subset ${JSON.stringify(expectedError.detailsSubset)}, received ${JSON.stringify(normalized.details)}.`
    };
  }

  return { matched: true };
}

export { normalizeErrorDetails };
