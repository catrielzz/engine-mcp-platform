declare module "../../../../../scripts/ci/unity/run-tests.js" {
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
}

declare module "../../../../../scripts/ci/unity/host-unity.js" {
  export function resolveWindowsUnityEditorPath(options: {
    projectPath: string;
    unityVersion?: string;
    unityEditorPath?: string;
    installRoot?: string;
    installedVersionsByRoot?: Record<string, string[]> | Map<string, string[]>;
    pathExists?: (targetPath: string) => boolean;
  }): {
    editorPath: string;
    resolvedVersion: string;
    requestedVersion: string | null;
    projectEditorVersion: string | null;
    source: string;
    installRoot: string;
  };
}
