# Unity Sandbox Bootstrap

## Purpose

This package reserves a Unity-side sandbox zone so future live capability handlers can enforce a stable boundary for E2E and rollback work.

## Reserved paths

- `Assets/MCP_Sandbox/`
- `Assets/MCP_Sandbox/Scenes/`
- `Assets/MCP_Sandbox/Generated/`
- `Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity`

## Reserved hierarchy

- root object: `SandboxRoot`
- generated object prefix: `MCP_E2E__`

## Editor entry points

The package exposes two menu items:

- `Tools/Engine MCP/Sandbox/Ensure Scaffold`
- `Tools/Engine MCP/Sandbox/Open Sandbox Scene`

`Ensure Scaffold` creates the reserved folders and sandbox scene if they do not exist yet.

`Open Sandbox Scene` opens the reserved scene and ensures the `SandboxRoot` object exists.

## Enforcement intent

Future Unity-backed capability handlers should use this bootstrap to:

- reject destructive or mutating requests outside the reserved sandbox scene
- normalize generated object names under `MCP_E2E__*`
- keep E2E and rollback flows contained inside `Assets/MCP_Sandbox/`

## Current status

This slice adds the Unity-side scaffold and naming rules.

The live bridge capabilities now use this sandbox for scene/object mutation, delete snapshots, and rollback-oriented TDD within the reserved scene.
