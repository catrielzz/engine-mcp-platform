import { describe, expect, it } from "vitest";

import {
  createPolicyDeniedToolError,
  evaluateToolPolicy
} from "./policy-engine.js";

describe("core-server policy engine", () => {
  it("classifies read capabilities as allowed and non-destructive", () => {
    const evaluation = evaluateToolPolicy("editor.state.read", {
      includeDiagnostics: true
    });

    expect(evaluation).toEqual({
      decision: {
        capability: "editor.state.read",
        riskClass: "read",
        decision: "allow",
        requiredScopes: ["read"],
        requiresSnapshot: false,
        sandboxOnly: false
      },
      target: undefined
    });
  });

  it("allows destructive scene mutations inside the sandbox", () => {
    const evaluation = evaluateToolPolicy("scene.object.delete", {
      target: {
        logicalName: "SandboxRoot/Gameplay/Marker"
      },
      snapshotLabel: "pre-delete"
    });

    expect(evaluation.decision).toEqual({
      capability: "scene.object.delete",
      riskClass: "destructive",
      decision: "allow",
      requiredScopes: ["write", "project"],
      requiresSnapshot: true,
      sandboxOnly: true
    });
    expect(evaluation.target).toEqual({
      logicalName: "SandboxRoot/Gameplay/Marker",
      sandboxed: undefined
    });
  });

  it("denies destructive scene mutations outside the sandbox", () => {
    const evaluation = evaluateToolPolicy("scene.object.delete", {
      target: {
        logicalName: "ProductionRoot/BossArena"
      },
      snapshotLabel: "pre-delete"
    });

    expect(evaluation.decision).toEqual({
      capability: "scene.object.delete",
      riskClass: "destructive",
      decision: "deny",
      requiredScopes: ["write", "project"],
      requiresSnapshot: true,
      sandboxOnly: true,
      reasonCode: "target_outside_sandbox"
    });
    expect(createPolicyDeniedToolError(evaluation)).toEqual({
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
  });

  it("denies scene creation outside the sandbox parent branch", () => {
    const evaluation = evaluateToolPolicy("scene.object.create", {
      parent: {
        logicalName: "ProductionRoot/Gameplay"
      },
      name: "CheckpointMarker"
    });

    expect(evaluation.decision.decision).toBe("deny");
    expect(evaluation.decision.reasonCode).toBe("target_outside_sandbox");
  });
});
