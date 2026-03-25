import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("@engine-mcp/core-server stdio policy foundation", () => {
  it("denies destructive scene mutations outside the sandbox before adapter execution", async () => {
    const invoke = vi.fn(async () => VALID_SAMPLES["scene.object.delete"].output);
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["scene.object.delete"], invoke)
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
      arguments: {
        target: {
          logicalName: "ProductionRoot/BossArena"
        },
        snapshotLabel: "pre-delete"
      }
    });

    expect(callToolResponse.result.isError).toBe(true);
    expect(callToolResponse.result.structuredContent.error).toEqual({
      code: "policy_denied",
      message: "target_outside_sandbox",
      details: {
        riskClass: "destructive",
        requiredScopes: ["write", "project"],
        requiresSnapshot: true,
        sandboxOnly: true,
        targetLogicalName: "ProductionRoot/BossArena"
      }
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows destructive scene mutations inside the sandbox", async () => {
    const invoke = vi.fn(async () => VALID_SAMPLES["scene.object.delete"].output);
    const { harness } = await createInitializedHarness(openHarnesses, {
      adapter: createFakeAdapter(["scene.object.delete"], invoke)
    });

    const callToolResponse = await requestResult<{
      isError?: boolean;
      structuredContent: Record<string, unknown>;
    }>(harness, "tools/call", {
      name: "scene.object.delete",
      arguments: VALID_SAMPLES["scene.object.delete"].input as Record<string, unknown>
    });

    expect(callToolResponse.result.isError).toBeUndefined();
    expect(callToolResponse.result.structuredContent).toEqual(
      VALID_SAMPLES["scene.object.delete"].output
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
