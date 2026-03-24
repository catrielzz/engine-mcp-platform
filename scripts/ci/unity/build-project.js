import path from "node:path";

import { resolveWindowsUnityEditorPath, splitCommandLine } from "./host-unity.js";

export function deriveUnityBuildArtifactPaths(options) {
  const buildsDir = path.resolve(
    options.workspacePath,
    options.buildsPath && options.buildsPath.trim().length > 0 ? options.buildsPath : path.join("artifacts", `unity-build-${options.unityVersion}`)
  );
  const resolvedBuildOutputPath =
    options.buildOutputPath && options.buildOutputPath.trim().length > 0
      ? path.resolve(options.workspacePath, options.buildOutputPath)
      : buildsDir;

  return {
    buildsPath: buildsDir,
    buildOutputPath: resolvedBuildOutputPath,
    logPath: path.join(buildsDir, "unity-build.log"),
    summaryPath: path.join(buildsDir, options.summaryFileName ?? "summary.json")
  };
}

export function buildUnityExecuteMethodArgs(options) {
  const args = [
    "-batchmode",
    "-nographics",
    "-quit",
    "-projectPath",
    options.projectPath,
    "-logFile",
    options.logPath,
    "-executeMethod",
    options.buildMethod
  ];

  return args.concat(splitCommandLine(options.customParameters ?? ""));
}

export { resolveWindowsUnityEditorPath };
