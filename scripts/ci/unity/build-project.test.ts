import { describe, expect, it } from "vitest";

import { buildUnityExecuteMethodArgs, deriveUnityBuildArtifactPaths } from "./build-project.js";

describe("deriveUnityBuildArtifactPaths", () => {
  it("derives stable build paths", () => {
    const result = deriveUnityBuildArtifactPaths({
      workspacePath: "E:/engine-mcp-platform",
      unityVersion: "2022.3.62f3",
      buildsPath: "Installer/build",
      buildOutputPath: "Installer/build/AI-Game-Dev-Installer.unitypackage"
    });

    expect(result.buildsPath).toContain("Installer");
    expect(result.buildOutputPath).toContain("AI-Game-Dev-Installer.unitypackage");
    expect(result.logPath).toContain("unity-build.log");
    expect(result.summaryPath).toContain("summary.json");
  });
});

describe("buildUnityExecuteMethodArgs", () => {
  it("builds executeMethod args with custom parameters", () => {
    expect(
      buildUnityExecuteMethodArgs({
        projectPath: "E:/engine-mcp-platform/Installer",
        logPath: "E:/engine-mcp-platform/Installer/build/unity-build.log",
        buildMethod: "com.IvanMurzak.Unity.MCP.Installer.PackageExporter.ExportPackage",
        customParameters: "-CI true -GITHUB_ACTIONS true"
      })
    ).toEqual([
      "-batchmode",
      "-nographics",
      "-quit",
      "-projectPath",
      "E:/engine-mcp-platform/Installer",
      "-logFile",
      "E:/engine-mcp-platform/Installer/build/unity-build.log",
      "-executeMethod",
      "com.IvanMurzak.Unity.MCP.Installer.PackageExporter.ExportPackage",
      "-CI",
      "true",
      "-GITHUB_ACTIONS",
      "true"
    ]);
  });
});
