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

describe("@engine-mcp/core-server stdio journal foundation", () => {
  it("records success and denial journal entries for inline tools/call", async () => {
    const journalService = createInMemoryJournalService();
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService,
      adapter: createFakeAdapter(
        ["scene.object.delete"],
        async () => VALID_SAMPLES["scene.object.delete"].output
      )
    });

    await requestResult(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
    });
    await requestResult(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: {
        target: {
          logicalName: "ProductionRoot/BossArena"
        },
        snapshotLabel: "pre-delete"
      }
    });

    const entries = await journalService.list();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      capability: "scene.object.delete",
      result: {
        status: "succeeded"
      }
    });
    expect(entries[1]).toMatchObject({
      capability: "scene.object.delete",
      result: {
        status: "denied",
        error: {
          code: "policy_denied",
          message: "target_outside_sandbox"
        }
      }
    });
  });

  it("returns journal_write_failed when the backend cannot append", async () => {
    const { harness } = await createInitializedHarness(openHarnesses, {
      journalService: {
        async append() {
          throw new Error("disk full");
        },
        async list() {
          return [];
        }
      },
      adapter: createFakeAdapter(
        ["editor.state.read"],
        async () => VALID_SAMPLES["editor.state.read"].output
      )
    });

    const callToolResponse = await requestResult<{
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
          message: string;
        };
      };
    }>(harness, "tools/call", {
      name: "editor.state.read",
      arguments: VALID_SAMPLES["editor.state.read"].input as Record<string, unknown>
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error).toEqual({
      code: "journal_write_failed",
      message: "Failed to append journal entry for editor.state.read."
    });
  });
});
