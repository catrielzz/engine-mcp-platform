import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildUnityRunTestsArgs,
  deriveUnityTestArtifactPaths,
  mapUnityTestMode
} from "./run-tests.js";
import { readProjectEditorVersion, resolveWindowsUnityEditorPath, splitCommandLine } from "./host-unity.js";

describe("mapUnityTestMode", () => {
  it("maps editmode to EditMode", () => {
    expect(mapUnityTestMode("editmode")).toBe("EditMode");
  });

  it("maps standalone to StandaloneWindows64", () => {
    expect(mapUnityTestMode("standalone")).toBe("StandaloneWindows64");
  });

  it("throws for unsupported modes", () => {
    expect(() => mapUnityTestMode("unknown")).toThrow("Unsupported Unity test mode");
  });
});

describe("splitCommandLine", () => {
  it("splits quoted arguments", () => {
    expect(splitCommandLine('-CI true -log "hello world"')).toEqual(["-CI", "true", "-log", "hello world"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitCommandLine("   ")).toEqual([]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => splitCommandLine('-message "unterminated')).toThrow("Unterminated quoted argument");
  });
});

describe("readProjectEditorVersion", () => {
  it("reads the real project version from Unity-Tests/6000.3.1f1", () => {
    const projectPath = path.resolve("E:/engine-mcp-platform/Unity-Tests/6000.3.1f1");
    expect(readProjectEditorVersion(projectPath)).toBe("6000.3.11f1");
  });
});

describe("resolveWindowsUnityEditorPath", () => {
  it("prefers the project's exact version when installed", () => {
    const result = resolveWindowsUnityEditorPath({
      projectPath: path.resolve("E:/engine-mcp-platform/Unity-Tests/6000.3.1f1"),
      unityVersion: "6000.3.1f1",
      installRoot: "C:\\Program Files\\Unity\\Hub\\Editor",
      installedVersionsByRoot: {
        "C:\\Program Files\\Unity\\Hub\\Editor": ["2022.3.62f3", "6000.3.11f1"]
      },
      pathExists: (targetPath) => targetPath.includes("6000.3.11f1")
    });

    expect(result.resolvedVersion).toBe("6000.3.11f1");
    expect(result.source).toBe("projectVersion");
    expect(result.editorPath).toContain("6000.3.11f1");
  });

  it("accepts an explicit unity-editor-path", () => {
    const explicitEditorPath = path.resolve("E:/engine-mcp-platform/commands/TestData/FakeUnity/Editor/Unity.exe");
    const result = resolveWindowsUnityEditorPath({
      projectPath: path.resolve("E:/engine-mcp-platform/Unity-Tests/2022.3.62f3"),
      unityEditorPath: explicitEditorPath
    });

    expect(result.editorPath).toBe(explicitEditorPath);
    expect(result.source).toBe("explicit");
  });
});

describe("deriveUnityTestArtifactPaths", () => {
  it("derives stable default artifact paths", () => {
    const result = deriveUnityTestArtifactPaths({
      workspacePath: "E:/engine-mcp-platform",
      unityVersion: "2022.3.62f3",
      testMode: "editmode"
    });

    expect(result.artifactsPath).toContain("artifacts");
    expect(result.resultsXmlPath).toContain("test-results.xml");
    expect(result.logPath).toContain("unity.log");
    expect(result.summaryPath).toContain("summary.json");
  });
});

describe("buildUnityRunTestsArgs", () => {
  it("builds Unity test args with mapped platform and custom params", () => {
    const args = buildUnityRunTestsArgs({
      projectPath: "E:/engine-mcp-platform/Unity-Tests/2022.3.62f3",
      resultsXmlPath: "E:/engine-mcp-platform/artifacts/test-results.xml",
      logPath: "E:/engine-mcp-platform/artifacts/unity.log",
      testMode: "editmode",
      customParameters: "-CI true -GITHUB_ACTIONS true"
    });

    expect(args).toEqual([
      "-runTests",
      "-batchmode",
      "-nographics",
      "-projectPath",
      "E:/engine-mcp-platform/Unity-Tests/2022.3.62f3",
      "-testResults",
      "E:/engine-mcp-platform/artifacts/test-results.xml",
      "-testPlatform",
      "EditMode",
      "-logFile",
      "E:/engine-mcp-platform/artifacts/unity.log",
      "-CI",
      "true",
      "-GITHUB_ACTIONS",
      "true"
    ]);
  });
});
