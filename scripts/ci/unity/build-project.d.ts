export function deriveUnityBuildArtifactPaths(options: {
  workspacePath: string;
  unityVersion: string;
  buildsPath?: string;
  buildOutputPath?: string;
  summaryFileName?: string;
}): {
  buildsPath: string;
  buildOutputPath: string;
  logPath: string;
  summaryPath: string;
};

export function buildUnityExecuteMethodArgs(options: {
  projectPath: string;
  logPath: string;
  buildMethod: string;
  customParameters?: string;
}): string[];

export { resolveWindowsUnityEditorPath } from "./host-unity.js";
