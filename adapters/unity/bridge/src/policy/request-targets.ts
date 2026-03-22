export function extractTargetLogicalName(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  if (
    "target" in input &&
    input.target &&
    typeof input.target === "object" &&
    !Array.isArray(input.target)
  ) {
    const target = input.target as {
      logicalName?: unknown;
      displayName?: unknown;
    };

    if (typeof target.logicalName === "string") {
      return target.logicalName;
    }

    if (typeof target.displayName === "string") {
      return target.displayName;
    }
  }

  return undefined;
}

export function extractSnapshotId(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  if ("snapshotId" in input && typeof input.snapshotId === "string") {
    return input.snapshotId;
  }

  return undefined;
}
