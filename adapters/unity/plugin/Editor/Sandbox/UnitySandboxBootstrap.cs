#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnitySandboxBootstrap
    {
        internal const string SandboxRootFolder = "Assets/MCP_Sandbox";
        internal const string SandboxScenesFolder = "Assets/MCP_Sandbox/Scenes";
        internal const string SandboxGeneratedAssetsFolder = "Assets/MCP_Sandbox/Generated";
        internal const string SandboxScenePath = "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity";
        internal const string SandboxRootObjectName = "SandboxRoot";
        internal const string SandboxObjectPrefix = "MCP_E2E__";

        [MenuItem("Tools/Engine MCP/Sandbox/Ensure Scaffold")]
        internal static void EnsureSandboxScaffoldMenuItem()
        {
            var result = EnsureSandboxScaffold();

            Debug.Log(
                $"Engine MCP sandbox scaffold ready. Folders created: {result.CreatedFolders.Count}, createdScene: {result.CreatedScene}, createdRootObject: {result.CreatedRootObject}");
        }

        [MenuItem("Tools/Engine MCP/Sandbox/Open Sandbox Scene")]
        internal static void OpenSandboxSceneMenuItem()
        {
            EnsureSandboxSceneOpen();
        }

        internal static UnitySandboxBootstrapResult EnsureSandboxScaffold()
        {
            var createdFolders = new List<string>();

            EnsureFolder("Assets", "MCP_Sandbox", createdFolders);
            EnsureFolder(SandboxRootFolder, "Scenes", createdFolders);
            EnsureFolder(SandboxRootFolder, "Generated", createdFolders);

            var createdScene = false;
            var createdRootObject = false;

            if (!SceneAssetExists())
            {
                var previousActiveScenePath = SceneManager.GetActiveScene().path;
                var restorePreviousScene = !string.IsNullOrWhiteSpace(previousActiveScenePath)
                                           && File.Exists(previousActiveScenePath)
                                           && !string.Equals(previousActiveScenePath, SandboxScenePath, StringComparison.Ordinal);
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                createdRootObject = EnsureSandboxRootObject(scene);
                createdScene = EditorSceneManager.SaveScene(scene, SandboxScenePath);

                if (!createdScene)
                {
                    throw new InvalidOperationException(
                        $"Engine MCP sandbox scene could not be saved at '{SandboxScenePath}'.");
                }

                if (restorePreviousScene)
                {
                    EditorSceneManager.OpenScene(previousActiveScenePath, OpenSceneMode.Single);
                }
            }

            AssetDatabase.Refresh();

            return new UnitySandboxBootstrapResult(
                createdFolders.AsReadOnly(),
                createdScene,
                createdRootObject,
                SandboxScenePath);
        }

        internal static UnitySandboxBootstrapResult EnsureSandboxSceneOpen()
        {
            var scaffold = EnsureSandboxScaffold();
            var scene = EditorSceneManager.OpenScene(SandboxScenePath, OpenSceneMode.Single);
            var createdRootObject = EnsureSandboxRootObject(scene);

            if (createdRootObject || scene.isDirty)
            {
                EditorSceneManager.SaveScene(scene);
            }

            return new UnitySandboxBootstrapResult(
                scaffold.CreatedFolders,
                scaffold.CreatedScene,
                scaffold.CreatedRootObject || createdRootObject,
                SandboxScenePath);
        }

        internal static bool IsSandboxScene(Scene scene)
        {
            return scene.IsValid()
                   && string.Equals(scene.path, SandboxScenePath, StringComparison.Ordinal);
        }

        internal static bool IsActiveSceneSandbox()
        {
            return IsSandboxScene(SceneManager.GetActiveScene());
        }

        internal static bool IsAllowedSandboxObjectName(string objectName)
        {
            if (string.IsNullOrWhiteSpace(objectName))
            {
                return false;
            }

            return string.Equals(objectName, SandboxRootObjectName, StringComparison.Ordinal)
                   || objectName.StartsWith(SandboxObjectPrefix, StringComparison.Ordinal);
        }

        internal static string EnsureSandboxObjectName(string objectName)
        {
            if (string.IsNullOrWhiteSpace(objectName))
            {
                throw new ArgumentException("Sandbox object name is required.", nameof(objectName));
            }

            if (IsAllowedSandboxObjectName(objectName))
            {
                return objectName;
            }

            return $"{SandboxObjectPrefix}{objectName.Trim()}";
        }

        internal static bool IsSandboxObject(GameObject gameObject)
        {
            return gameObject != null
                   && IsSandboxScene(gameObject.scene)
                   && IsAllowedSandboxObjectName(gameObject.name);
        }

        private static void EnsureFolder(string parentFolder, string childFolderName, IList<string> createdFolders)
        {
            var childFolderPath = $"{parentFolder}/{childFolderName}";

            if (AssetDatabase.IsValidFolder(childFolderPath))
            {
                return;
            }

            AssetDatabase.CreateFolder(parentFolder, childFolderName);
            createdFolders.Add(childFolderPath);
        }

        private static bool SceneAssetExists()
        {
            return AssetDatabase.LoadAssetAtPath<SceneAsset>(SandboxScenePath) != null;
        }

        private static bool EnsureSandboxRootObject(Scene scene)
        {
            foreach (var rootObject in scene.GetRootGameObjects())
            {
                if (string.Equals(rootObject.name, SandboxRootObjectName, StringComparison.Ordinal))
                {
                    return false;
                }
            }

            var sandboxRoot = new GameObject(SandboxRootObjectName);
            SceneManager.MoveGameObjectToScene(sandboxRoot, scene);
            EditorSceneManager.MarkSceneDirty(scene);

            return true;
        }
    }

    internal readonly struct UnitySandboxBootstrapResult
    {
        internal UnitySandboxBootstrapResult(
            IReadOnlyList<string> createdFolders,
            bool createdScene,
            bool createdRootObject,
            string sandboxScenePath)
        {
            CreatedFolders = createdFolders;
            CreatedScene = createdScene;
            CreatedRootObject = createdRootObject;
            SandboxScenePath = sandboxScenePath;
        }

        internal IReadOnlyList<string> CreatedFolders { get; }

        internal bool CreatedScene { get; }

        internal bool CreatedRootObject { get; }

        internal string SandboxScenePath { get; }
    }
}
#endif
