declare module "../../../../../scripts/ci/unity/build-project.js" {
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
