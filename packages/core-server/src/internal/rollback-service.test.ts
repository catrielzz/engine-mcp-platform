import { describe, expect, it } from "vitest";

import { resolveInlineJournalStatus } from "./rollback-service.js";

describe("core-server rollback service", () => {
  it("keeps non-rollback success paths as succeeded", () => {
    expect(
      resolveInlineJournalStatus({
        capability: "scene.object.delete",
        output: {
          deleted: true,
          snapshotId: "snapshot-001"
        }
      })
    ).toBe("succeeded");
  });

  it("classifies successful snapshot.restore output as rolled_back", () => {
    expect(
      resolveInlineJournalStatus({
        capability: "snapshot.restore",
        output: {
          snapshotId: "snapshot-001",
          restored: true
        }
      })
    ).toBe("rolled_back");
  });

  it("does not over-classify rollback when restore confirmation is missing", () => {
    expect(
      resolveInlineJournalStatus({
        capability: "snapshot.restore",
        output: {
          snapshotId: "snapshot-001",
          restored: false
        }
      })
    ).toBe("succeeded");
  });
});
