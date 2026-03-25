# ADR-0005: Core Policy, Journal, Snapshot, And Rollback As The Next V1 Baseline

## Status

Proposed

## Date

2026-03-25

## Context

The repository now has a stable-enough execution path for:

- `stdio`
- `Streamable HTTP`
- prompt discovery
- resource discovery
- the Unity adapter running against a self-hosted Windows runner

That closes a large chunk of CI and adapter plumbing, but it does not yet close the core V1 risk described in [platform-foundation/security-model.md](E:/engine-mcp-platform/platform-foundation/security-model.md) and [platform-foundation/roadmap-v1.md](E:/engine-mcp-platform/platform-foundation/roadmap-v1.md).

The current platform state is still weak in the areas that make non-interactive editor automation safe and auditable:

- server-side policy decisions
- machine-readable denial reasons
- operation journaling
- pre-mutation snapshot creation
- rollback orchestration for sandbox mutations

Official MCP specification context:

- MCP defines transports, tools, resources, and prompts, but leaves authorization, state control, and rollback design to the server implementation.
- For `Streamable HTTP`, servers must validate `Origin`, should bind locally when appropriate, and should implement authentication.
- Authorization for HTTP-based transports is transport-level and optional, but when implemented should follow the MCP authorization guidance.

## Decision

The next platform baseline after CI stabilization is:

1. `policy-engine`
2. `journal-service`
3. `snapshot-service`
4. `rollback` orchestration for sandbox mutations
5. machine-readable core error model for policy and recovery failures

This slice is the next mandatory V1 hardening step.

It is prioritized ahead of:

- expanding Unity feature parity
- broad prompt expansion
- wider CoplayDev capability porting
- multi-engine skeleton growth

## Why This Decision

Why this comes before more feature work:

- The repository already has enough mutation surface that "feature growth without rollback" would increase risk faster than value.
- The local platform direction explicitly rejects prompt-time confirmation as the primary control plane.
- Without policy and snapshot orchestration, destructive or wide-scope operations remain too dependent on convention and caller discipline.

Why not solve this only in the Unity adapter:

- The policy and audit concerns are cross-cutting platform responsibilities.
- The same contracts should later apply to Unreal and Godot adapters.
- A Unity-only solution would cement engine-specific assumptions in the wrong layer.

Why journal and snapshot must move together:

- A journal without recovery evidence is insufficient for safe automation.
- A snapshot without a durable operation record is insufficient for diagnosis and replay.

## Consequences

Positive:

- Mutations gain explicit server-side control instead of informal trust.
- Sandbox rollback becomes a first-class platform claim rather than a documentation promise.
- Future adapters can plug into the same capability risk model.

Tradeoffs:

- More core modules and contracts must be introduced before widening tool surface.
- The first implementation should remain sandbox-first and not attempt full project-wide mutation coverage immediately.
- Existing adapter operations may need classification work before being allowed through the new policy layer.

## Required Outputs For The Slice

- functional specification
- technical specification
- delivery roadmap
- bounded implementation plan for:
  - `packages/core-server`
  - `packages/contracts`
  - `adapters/unity/bridge`
  - sandbox assets/tests in `Unity-Tests/6000.3.11f1`

## Sources

- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
