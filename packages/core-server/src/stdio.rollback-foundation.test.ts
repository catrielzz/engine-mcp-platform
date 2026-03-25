import { afterEach, describe, expect, it } from "vitest";

import { createInMemoryJournalService } from "./index.js";
import { createFakeAdapter, VALID_SAMPLES } from "./test-support/fixtures.js";
import {
  createInitializedHarness,
  requestResult
} from "./test-support/stdio-foundation.js";
import type { StdioHarness } from "./test-support/stdio.js";

const openHarnesses: StdioHarness[] = [];

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

describe("@engine-mcp/core-server stdio rollback foundation", () => {
  it("journals snapshot.restore as rolled_back over stdio", async () => {
    const journalService = createInMemoryJournalService();
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService,
      adapter: createFakeAdapter(
        ["snapshot.restore"],
        async () => VALID_SAMPLES["snapshot.restore"].output
      )
    });

    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>(harness, "tools/call", {
      name: "snapshot.restore",
      arguments: VALID_SAMPLES["snapshot.restore"].input as Record<string, unknown>
    });

    expect(callToolResponse.result.isError).toBeUndefined();
    expect(callToolResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["snapshot.restore"].output
    );

    const entries = await journalService.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      capability: "snapshot.restore",
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: false
      },
      result: {
        status: "rolled_back"
      }
    });
  });
});
