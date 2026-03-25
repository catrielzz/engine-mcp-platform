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

describe("@engine-mcp/core-server stdio snapshot foundation", () => {
  it("records snapshot linkage for successful destructive inline tools/call", async () => {
    const journalService = createInMemoryJournalService();
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService,
      adapter: createFakeAdapter(
        ["scene.object.delete"],
        async () => VALID_SAMPLES["scene.object.delete"].output
      )
    });

    const callToolResponse = await requestResult<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
    });

    expect(callToolResponse.result.isError).toBeUndefined();
    expect(callToolResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["scene.object.delete"].output
    );

    const entries = await journalService.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      capability: "scene.object.delete",
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: true
      },
      result: {
        status: "succeeded"
      }
    });
  });

  it("fails destructive success paths that omit snapshot linkage", async () => {
    const journalService = createInMemoryJournalService();
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService,
      adapter: createFakeAdapter(["scene.object.delete"], async () => ({
        target: {
          logicalName: "SandboxRoot/GeneratedCubeRenamed"
        },
        deleted: true
      }))
    });

    const callToolResponse = await requestResult<{
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
      };
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error).toEqual({
      code: "snapshot_required",
      message: "snapshot_required",
      details: {
        capability: "scene.object.delete",
        adapterId: "fake-core-server-adapter",
        requiresSnapshot: true
      }
    });

    const entries = await journalService.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      capability: "scene.object.delete",
      result: {
        status: "failed",
        error: {
          code: "snapshot_required",
          message: "snapshot_required"
        }
      }
    });
    expect(entries[0]?.snapshot).toBeUndefined();
  });
});
