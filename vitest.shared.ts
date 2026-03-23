import { fileURLToPath } from "node:url";

import type { UserConfig } from "vitest/config";

export const workspaceAlias = {
  "@engine-mcp/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
  "@engine-mcp/core-server": fileURLToPath(new URL("./packages/core-server/src/index.ts", import.meta.url)),
  "@engine-mcp/policy-engine": fileURLToPath(new URL("./packages/policy-engine/src/index.ts", import.meta.url)),
  "@engine-mcp/conformance-runner": fileURLToPath(
    new URL("./packages/conformance-runner/src/index.ts", import.meta.url)
  ),
  "@engine-mcp/cli": fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
  "@engine-mcp/unity-bridge": fileURLToPath(
    new URL("./adapters/unity/bridge/src/index.ts", import.meta.url)
  )
} satisfies NonNullable<UserConfig["resolve"]>["alias"];

export const workspaceVitestBaseConfig = {
  resolve: {
    alias: workspaceAlias
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    }
  }
} satisfies UserConfig;
