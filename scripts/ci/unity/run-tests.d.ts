export type UnityWorkflowTestMode = "editmode" | "playmode" | "standalone";
export type UnityEditorTestPlatform = "EditMode" | "PlayMode" | "StandaloneWindows64";

export function mapUnityTestMode(mode: string): UnityEditorTestPlatform;

export function deriveUnityTestArtifactPaths(options: {
  workspacePath: string;
  unityVersion: string;
  testMode: UnityWorkflowTestMode;
  artifactsPath?: string;
}): {
  artifactsPath: string;
  resultsXmlPath: string;
  logPath: string;
  summaryPath: string;
};

export function buildUnityRunTestsArgs(options: {
  projectPath: string;
  resultsXmlPath: string;
  logPath: string;
  testMode: UnityWorkflowTestMode;
  customParameters?: string;
}): string[];
