export function splitCommandLine(input: string): string[];

export function readProjectEditorVersion(projectPath: string): string | null;

export function getDefaultUnityInstallRoots(): string[];

export function listInstalledUnityVersions(installRoot: string): string[];

export function buildUnityEditorPath(installRoot: string, version: string): string;

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
