import { defineConfig } from "vitest/config";

import { workspaceVitestBaseConfig } from "./vitest.shared.js";

export default defineConfig({
  ...workspaceVitestBaseConfig,
  test: {
    ...workspaceVitestBaseConfig.test,
    name: "platform-packages",
    include: ["packages/*/src/**/*.test.ts", "adapters/*/bridge/src/**/*.test.ts"]
  }
});
