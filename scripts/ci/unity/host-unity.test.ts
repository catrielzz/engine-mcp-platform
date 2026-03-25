import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDefaultUnityInstallRoots,
  readProjectEditorVersion,
  resolveWindowsUnityEditorPath,
  splitCommandLine
} from "./host-unity.js";

describe("host-unity splitCommandLine", () => {
  it("splits quoted arguments", () => {
    expect(splitCommandLine('-CI true -message "hello world"')).toEqual(["-CI", "true", "-message", "hello world"]);
  });
});

describe("host-unity readProjectEditorVersion", () => {
  it("reads the installer project version", () => {
    const projectPath = path.resolve("E:/engine-mcp-platform/Installer");
    expect(readProjectEditorVersion(projectPath)).toBe("2022.3.62f3");
  });
});

describe("host-unity getDefaultUnityInstallRoots", () => {
  it("includes common windows roots", () => {
    const roots = getDefaultUnityInstallRoots();
    expect(roots.some((root) => root.endsWith(path.normalize("Program Files\\Unity\\Hub\\Editor")))).toBe(true);
    expect(roots.some((root) => root.endsWith(path.normalize("E:\\Unity\\Hub\\Editor")))).toBe(true);
  });
});

describe("host-unity resolveWindowsUnityEditorPath", () => {
  it("prefix matches across multiple install roots", () => {
    const installerProjectPath = path.resolve("E:/engine-mcp-platform/Installer");
    const installRoot = path.normalize("E:\\Unity\\Hub\\Editor");
    const result = resolveWindowsUnityEditorPath({
      projectPath: installerProjectPath,
      unityVersion: "2022.3.62f3",
      installedVersionsByRoot: {
        [installRoot]: ["2022.3.62f3"]
      },
      pathExists: (targetPath) => targetPath.includes(path.normalize("E:\\Unity\\Hub\\Editor\\2022.3.62f3\\Editor\\Unity.exe"))
    });

    expect(result.resolvedVersion).toBe("2022.3.62f3");
    expect(result.installRoot).toBe(installRoot);
    expect(result.editorPath).toContain("2022.3.62f3");
  });
});
