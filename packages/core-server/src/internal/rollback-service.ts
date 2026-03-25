import type { CapabilityName, JournalResultStatus } from "@engine-mcp/contracts";

export function resolveInlineJournalStatus(options: {
  capability: CapabilityName;
  output: Readonly<Record<string, unknown>>;
}): JournalResultStatus {
  if (options.capability !== "snapshot.restore") {
    return "succeeded";
  }

  return options.output.restored === true ? "rolled_back" : "succeeded";
}
