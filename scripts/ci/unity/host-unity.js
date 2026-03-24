import fs from "node:fs";
import path from "node:path";

export function splitCommandLine(input) {
  if (!input.trim()) {
    return [];
  }

  const args = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error(`Unterminated quoted argument in custom parameters: ${input}`);
  }

  if (escaping) {
    current += "\\";
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export function readProjectEditorVersion(projectPath) {
  const versionFilePath = path.join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  if (!fs.existsSync(versionFilePath)) {
    return null;
  }

  const versionFile = fs.readFileSync(versionFilePath, "utf8");
  const match = versionFile.match(/m_EditorVersion:\s*(.+)/);
  return match ? match[1].trim() : null;
}

export function getDefaultUnityInstallRoots() {
  const candidates = [
    process.env.UNITY_EDITOR_INSTALL_ROOT,
    "C:\\Program Files\\Unity\\Hub\\Editor",
    "E:\\Unity\\Hub\\Editor",
    "D:\\Unity\\Hub\\Editor"
  ].filter((value) => typeof value === "string" && value.trim().length > 0);

  return [...new Set(candidates.map((value) => path.resolve(value)))];
}

export function listInstalledUnityVersions(installRoot) {
  if (!fs.existsSync(installRoot)) {
    return [];
  }

  return fs
    .readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function buildUnityEditorPath(installRoot, version) {
  return path.join(installRoot, version, "Editor", "Unity.exe");
}

export function resolveWindowsUnityEditorPath(options) {
  const requestedVersion = options.unityVersion ?? null;
  const projectEditorVersion = readProjectEditorVersion(options.projectPath);
  const pathExists = options.pathExists ?? fs.existsSync;

  if (options.unityEditorPath) {
    const explicitPath = path.resolve(options.unityEditorPath);
    if (!pathExists(explicitPath)) {
      throw new Error(`Configured unity-editor-path does not exist: ${explicitPath}`);
    }

    return {
      editorPath: explicitPath,
      resolvedVersion: projectEditorVersion ?? requestedVersion ?? path.basename(path.dirname(path.dirname(explicitPath))),
      requestedVersion,
      projectEditorVersion,
      source: "explicit",
      installRoot: path.dirname(path.dirname(explicitPath))
    };
  }

  const installRoots = options.installRoot ? [path.resolve(options.installRoot)] : getDefaultUnityInstallRoots();
  const installedVersionsByRoot =
    options.installedVersionsByRoot instanceof Map
      ? options.installedVersionsByRoot
      : new Map(Object.entries(options.installedVersionsByRoot ?? {}));
  const candidateVersions = [];

  if (projectEditorVersion) {
    candidateVersions.push({ version: projectEditorVersion, source: "projectVersion" });
  }

  if (requestedVersion && requestedVersion !== projectEditorVersion) {
    candidateVersions.push({ version: requestedVersion, source: "workflowVersion" });
  }

  for (const installRoot of installRoots) {
    for (const candidate of candidateVersions) {
      const exactPath = buildUnityEditorPath(installRoot, candidate.version);
      if (pathExists(exactPath)) {
        return {
          editorPath: exactPath,
          resolvedVersion: candidate.version,
          requestedVersion,
          projectEditorVersion,
          source: candidate.source,
          installRoot
        };
      }
    }
  }

  for (const installRoot of installRoots) {
    const installedVersions = installedVersionsByRoot.get(installRoot) ?? listInstalledUnityVersions(installRoot);

    for (const candidate of candidateVersions) {
      const matches = installedVersions.filter((version) => version.startsWith(candidate.version));
      if (matches.length === 1) {
        const prefixMatchedPath = buildUnityEditorPath(installRoot, matches[0]);
        if (!pathExists(prefixMatchedPath)) {
          continue;
        }

        return {
          editorPath: prefixMatchedPath,
          resolvedVersion: matches[0],
          requestedVersion,
          projectEditorVersion,
          source: "prefixMatch",
          installRoot
        };
      }

      if (matches.length > 1) {
        throw new Error(
          `Multiple installed Unity versions match ${candidate.version} under ${installRoot}: ${matches.join(", ")}. Configure unity-editor-path explicitly.`
        );
      }
    }
  }

  throw new Error(
    `Unable to resolve Unity.exe. Requested=${requestedVersion ?? "n/a"} ProjectVersion=${projectEditorVersion ?? "n/a"} InstallRoots=${installRoots.join(", ")}`
  );
}
