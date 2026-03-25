import path from "node:path";
import { resolveWindowsUnityEditorPath, splitCommandLine } from "./host-unity.js";

/**
 * @typedef {"editmode" | "playmode" | "standalone"} UnityWorkflowTestMode
 * @typedef {"EditMode" | "PlayMode" | "StandaloneWindows64"} UnityEditorTestPlatform
 */

/**
 * @param {string} mode
 * @returns {UnityEditorTestPlatform}
 */
export function mapUnityTestMode(mode) {
  switch (mode.toLowerCase()) {
    case "editmode":
      return "EditMode";
    case "playmode":
      return "PlayMode";
    case "standalone":
      return "StandaloneWindows64";
    default:
      throw new Error(`Unsupported Unity test mode: ${mode}`);
  }
}

/**
 * @param {{
 *   workspacePath: string;
 *   unityVersion: string;
 *   testMode: UnityWorkflowTestMode;
 *   artifactsPath?: string;
 * }} options
 */
export function deriveUnityTestArtifactPaths(options) {
  const rawArtifactsPath =
    options.artifactsPath && options.artifactsPath.trim().length > 0
      ? options.artifactsPath
      : path.join("artifacts", `unity-tests-${options.unityVersion}-${options.testMode}`);

  const artifactsPath = path.resolve(options.workspacePath, rawArtifactsPath);
  return {
    artifactsPath,
    resultsXmlPath: path.join(artifactsPath, "test-results.xml"),
    logPath: path.join(artifactsPath, "unity.log"),
    summaryPath: path.join(artifactsPath, "summary.json")
  };
}

/**
 * @param {{
 *   projectPath: string;
 *   resultsXmlPath: string;
 *   logPath: string;
 *   testMode: UnityWorkflowTestMode;
 *   customParameters?: string;
 * }} options
 * @returns {string[]}
 */
export function buildUnityRunTestsArgs(options) {
  const args = [
    "-runTests",
    "-batchmode",
    "-nographics",
    "-projectPath",
    options.projectPath,
    "-testResults",
    options.resultsXmlPath,
    "-testPlatform",
    mapUnityTestMode(options.testMode),
    "-logFile",
    options.logPath
  ];

  return args.concat(splitCommandLine(options.customParameters ?? ""));
}
