import { describe, expect, it } from "vitest";

import { createInMemoryJournalService } from "./journal-service.js";

describe("core-server journal service", () => {
  it("stores append-only entries in insertion order", async () => {
    const journalService = createInMemoryJournalService();

    await journalService.append({
      id: "journal-001",
      timestamp: "2026-03-25T00:00:00.000Z",
      capability: "editor.state.read",
      riskClass: "read",
      actor: {
        type: "client",
        id: "req-1"
      },
      decision: {
        capability: "editor.state.read",
        riskClass: "read",
        decision: "allow",
        requiredScopes: ["read"],
        requiresSnapshot: false,
        sandboxOnly: false
      },
      result: {
        status: "succeeded"
      }
    });

    await journalService.append({
      id: "journal-002",
      timestamp: "2026-03-25T00:00:01.000Z",
      capability: "scene.object.delete",
      riskClass: "destructive",
      actor: {
        type: "client",
        id: "req-2"
      },
      decision: {
        capability: "scene.object.delete",
        riskClass: "destructive",
        decision: "deny",
        requiredScopes: ["write", "project"],
        requiresSnapshot: true,
        sandboxOnly: true,
        reasonCode: "target_outside_sandbox"
      },
      result: {
        status: "denied",
        error: {
          code: "policy_denied",
          message: "target_outside_sandbox"
        }
      }
    });

    expect(journalService.list()).toEqual([
      expect.objectContaining({
        id: "journal-001",
        capability: "editor.state.read"
      }),
      expect.objectContaining({
        id: "journal-002",
        capability: "scene.object.delete"
      })
    ]);
  });
});
