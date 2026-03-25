#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnityEditorDeleteSnapshotStore
    {
        private static readonly object SyncRoot = new();
        private static readonly Dictionary<string, DeleteSnapshotRecord> Snapshots = new(StringComparer.Ordinal);

        internal static string CaptureSnapshot(GameObject target, string snapshotLabel)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            var scene = target.scene;

            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("snapshot_failed: target scene could not be resolved.");
            }

            var snapshotId = BuildSnapshotId(target, snapshotLabel);
            var snapshot = new DeleteSnapshotRecord
            {
                SnapshotId = snapshotId,
                CreatedAt = DateTime.UtcNow.ToString("O"),
                Label = string.IsNullOrWhiteSpace(snapshotLabel) ? null : snapshotLabel.Trim(),
                ScenePath = scene.path,
                ParentLogicalName = target.transform.parent != null
                    ? BuildLogicalName(target.transform.parent)
                    : null,
                Root = CaptureNode(target)
            };

            try
            {
                PersistSnapshot(snapshot);
                UnityEditorMutationJournalStore.AppendEntry(
                    "scene.object.delete",
                    snapshot.SnapshotId,
                    BuildLogicalName(target.transform),
                    scene.path,
                    "captured");
            }
            catch (Exception exception)
            {
                DeletePersistedSnapshot(snapshotId);
                throw new InvalidOperationException($"snapshot_failed: {exception.Message}");
            }

            lock (SyncRoot)
            {
                Snapshots[snapshotId] = snapshot;
            }

            return snapshotId;
        }

        internal static DeleteSnapshotRestoreResult RestoreSnapshot(string snapshotId)
        {
            if (string.IsNullOrWhiteSpace(snapshotId))
            {
                throw new ArgumentException("snapshot.restore requires a non-empty snapshotId.", nameof(snapshotId));
            }

            try
            {
                return RestoreSnapshotCore(snapshotId);
            }
            catch (Exception exception) when (exception is InvalidOperationException or ArgumentException)
            {
                throw new UnityBridgeCallException(
                    "policy_denied",
                    SandboxPolicyContract.RollbackUnavailableReason,
                    SandboxPolicyContract.CreateSnapshotAvailabilityDetails(
                        "snapshot.restore",
                        snapshotId: snapshotId));
            }
        }

        internal static string[] ListSnapshotIds()
        {
            string[] cachedSnapshotIds;

            lock (SyncRoot)
            {
                cachedSnapshotIds = Snapshots.Keys.ToArray();
            }

            var snapshotDirectoryPath = GetSnapshotDirectoryPath();
            var persistedSnapshotIds = Directory.Exists(snapshotDirectoryPath)
                ? Directory
                    .GetFiles(snapshotDirectoryPath, "*.json", SearchOption.TopDirectoryOnly)
                    .Select(Path.GetFileNameWithoutExtension)
                    .Where((snapshotId) => !string.IsNullOrWhiteSpace(snapshotId))
                : Enumerable.Empty<string>();

            return cachedSnapshotIds
                .Concat(persistedSnapshotIds)
                .Distinct(StringComparer.Ordinal)
                .OrderBy((snapshotId) => snapshotId, StringComparer.Ordinal)
                .ToArray();
        }

        private static bool RestoreSnapshotForTests(string snapshotId)
        {
            try
            {
                RestoreSnapshotCore(snapshotId);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void ResetForTests()
        {
            lock (SyncRoot)
            {
                Snapshots.Clear();
            }

            var snapshotDirectoryPath = GetSnapshotDirectoryPath();

            if (Directory.Exists(snapshotDirectoryPath))
            {
                Directory.Delete(snapshotDirectoryPath, true);
            }

            ResetMutationJournalForTests();
        }

        private static void ClearCacheForTests()
        {
            lock (SyncRoot)
            {
                Snapshots.Clear();
            }
        }

        private static DeleteSnapshotRestoreResult RestoreSnapshotCore(string snapshotId)
        {
            var snapshot = GetSnapshot(snapshotId);

            var scene = ResolveScene(snapshot.ScenePath);

            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException($"snapshot {snapshotId} scene could not be resolved.");
            }

            Transform parent = null;

            if (!string.IsNullOrWhiteSpace(snapshot.ParentLogicalName))
            {
                var parentObject = FindGameObjectByLogicalName(scene, snapshot.ParentLogicalName);

                if (parentObject == null)
                {
                    throw new InvalidOperationException(
                        $"snapshot {snapshotId} parent '{snapshot.ParentLogicalName}' could not be resolved.");
                }

                parent = parentObject.transform;
            }

            var restored = RestoreNode(snapshot.Root, scene, parent);
            EditorSceneManager.MarkSceneDirty(scene);

            DeletePersistedSnapshot(snapshotId);

            lock (SyncRoot)
            {
                Snapshots.Remove(snapshotId);
            }

            UnityEditorMutationJournalStore.AppendEntry(
                "snapshot.restore",
                snapshot.SnapshotId,
                BuildLogicalName(restored.transform),
                scene.path,
                "restored");

            return new DeleteSnapshotRestoreResult
            {
                SnapshotId = snapshot.SnapshotId,
                TargetLogicalName = BuildLogicalName(restored.transform),
                TargetDisplayName = restored.name
            };
        }

        private static DeleteSnapshotNode CaptureNode(GameObject gameObject)
        {
            return new DeleteSnapshotNode
            {
                Name = gameObject.name,
                ActiveSelf = gameObject.activeSelf,
                Tag = gameObject.tag,
                Layer = gameObject.layer,
                IsStatic = gameObject.isStatic,
                SiblingIndex = gameObject.transform.GetSiblingIndex(),
                TransformJson = EditorJsonUtility.ToJson(gameObject.transform),
                Components = gameObject
                    .GetComponents<Component>()
                    .Where((component) => component != null && component is not Transform)
                    .Select(CaptureComponent)
                    .ToArray(),
                Children = Enumerable.Range(0, gameObject.transform.childCount)
                    .Select((index) => CaptureNode(gameObject.transform.GetChild(index).gameObject))
                    .ToArray()
            };
        }

        private static DeleteSnapshotComponent CaptureComponent(Component component)
        {
            return new DeleteSnapshotComponent
            {
                TypeName = component.GetType().FullName,
                Json = EditorJsonUtility.ToJson(component)
            };
        }

        private static GameObject RestoreNode(DeleteSnapshotNode snapshot, Scene scene, Transform parent)
        {
            var restored = new GameObject(snapshot.Name);
            SceneManager.MoveGameObjectToScene(restored, scene);

            if (parent != null)
            {
                restored.transform.SetParent(parent, false);
            }

            restored.transform.SetSiblingIndex(snapshot.SiblingIndex);
            restored.tag = snapshot.Tag;
            restored.layer = snapshot.Layer;
            restored.isStatic = snapshot.IsStatic;

            if (!string.IsNullOrWhiteSpace(snapshot.TransformJson))
            {
                EditorJsonUtility.FromJsonOverwrite(snapshot.TransformJson, restored.transform);
            }

            foreach (var componentSnapshot in snapshot.Components)
            {
                var componentType = ResolveComponentType(componentSnapshot.TypeName);

                if (componentType == null)
                {
                    throw new InvalidOperationException(
                        $"snapshot_failed: component type '{componentSnapshot.TypeName}' could not be resolved.");
                }

                var component = restored.GetComponent(componentType);

                if (component == null)
                {
                    component = restored.AddComponent(componentType);
                }

                if (component == null)
                {
                    throw new InvalidOperationException(
                        $"snapshot_failed: component type '{componentSnapshot.TypeName}' could not be restored.");
                }

                EditorJsonUtility.FromJsonOverwrite(componentSnapshot.Json, component);
            }

            foreach (var childSnapshot in snapshot.Children.OrderBy((child) => child.SiblingIndex))
            {
                RestoreNode(childSnapshot, scene, restored.transform);
            }

            restored.SetActive(snapshot.ActiveSelf);
            return restored;
        }

        private static Scene ResolveScene(string scenePath)
        {
            if (!string.IsNullOrWhiteSpace(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);

                if (scene.IsValid())
                {
                    return scene;
                }
            }

            return SceneManager.GetActiveScene();
        }

        private static Type ResolveComponentType(string typeName)
        {
            if (string.IsNullOrWhiteSpace(typeName))
            {
                return null;
            }

            var direct = Type.GetType(typeName, throwOnError: false);

            if (direct != null && typeof(Component).IsAssignableFrom(direct))
            {
                return direct;
            }

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type candidate;

                try
                {
                    candidate = assembly.GetType(typeName, throwOnError: false)
                                ?? assembly
                                    .GetTypes()
                                    .FirstOrDefault((loadedType) =>
                                        string.Equals(loadedType.FullName, typeName, StringComparison.Ordinal)
                                        || string.Equals(loadedType.Name, typeName, StringComparison.Ordinal));
                }
                catch (ReflectionTypeLoadException exception)
                {
                    candidate = exception.Types.FirstOrDefault((loadedType) =>
                        loadedType != null
                        && (string.Equals(loadedType.FullName, typeName, StringComparison.Ordinal)
                            || string.Equals(loadedType.Name, typeName, StringComparison.Ordinal)));
                }

                if (candidate != null && typeof(Component).IsAssignableFrom(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static GameObject FindGameObjectByLogicalName(Scene scene, string logicalName)
        {
            foreach (var rootObject in scene.GetRootGameObjects())
            {
                var match = FindGameObjectByLogicalName(rootObject, logicalName);

                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static GameObject FindGameObjectByLogicalName(GameObject current, string logicalName)
        {
            if (string.Equals(BuildLogicalName(current.transform), logicalName, StringComparison.Ordinal))
            {
                return current;
            }

            for (var index = 0; index < current.transform.childCount; index += 1)
            {
                var match = FindGameObjectByLogicalName(current.transform.GetChild(index).gameObject, logicalName);

                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static string BuildLogicalName(Transform transform)
        {
            return transform.parent == null
                ? transform.name
                : $"{BuildLogicalName(transform.parent)}/{transform.name}";
        }

        private static string BuildSnapshotId(GameObject gameObject, string snapshotLabel)
        {
            var label = string.IsNullOrWhiteSpace(snapshotLabel)
                ? BuildLogicalName(gameObject.transform)
                : snapshotLabel.Trim();
            var normalizedLabel = label
                .Replace('/', '_')
                .Replace(' ', '_');

            return $"unity-delete-{normalizedLabel}-{Guid.NewGuid():N}";
        }

        private static DeleteSnapshotRecord GetSnapshot(string snapshotId)
        {
            lock (SyncRoot)
            {
                if (Snapshots.TryGetValue(snapshotId, out var cachedSnapshot))
                {
                    return cachedSnapshot;
                }
            }

            var snapshotPath = GetSnapshotFilePath(snapshotId);

            if (!File.Exists(snapshotPath))
            {
                throw new InvalidOperationException($"snapshot {snapshotId} could not be resolved.");
            }

            DeleteSnapshotRecord snapshot;

            try
            {
                snapshot = JsonConvert.DeserializeObject<DeleteSnapshotRecord>(File.ReadAllText(snapshotPath));
            }
            catch (Exception exception)
            {
                throw new InvalidOperationException(
                    $"snapshot {snapshotId} could not be read: {exception.Message}");
            }

            if (snapshot == null)
            {
                throw new InvalidOperationException($"snapshot {snapshotId} could not be read.");
            }

            lock (SyncRoot)
            {
                Snapshots[snapshotId] = snapshot;
            }

            return snapshot;
        }

        private static void PersistSnapshot(DeleteSnapshotRecord snapshot)
        {
            var snapshotPath = GetSnapshotFilePath(snapshot.SnapshotId);
            WriteJsonAtomically(snapshotPath, JsonConvert.SerializeObject(snapshot));
        }

        private static string GetSnapshotFilePath(string snapshotId)
        {
            return Path.Combine(GetSnapshotDirectoryPath(), $"{snapshotId}.json");
        }

        private static string GetSnapshotDirectoryPath()
        {
            return Path.Combine(GetProjectRootPath(), "Library", "EngineMcp", "Snapshots");
        }

        private static string GetProjectRootPath()
        {
            var projectRootPath = Directory.GetParent(Application.dataPath)?.FullName;

            if (string.IsNullOrWhiteSpace(projectRootPath))
            {
                throw new InvalidOperationException("snapshot_failed: project root could not be resolved.");
            }

            return projectRootPath;
        }

        private static void DeletePersistedSnapshot(string snapshotId)
        {
            var snapshotPath = GetSnapshotFilePath(snapshotId);

            if (File.Exists(snapshotPath))
            {
                File.Delete(snapshotPath);
            }
        }

        private static void WriteJsonAtomically(string filePath, string json)
        {
            var directoryPath = Path.GetDirectoryName(filePath) ?? GetProjectRootPath();
            Directory.CreateDirectory(directoryPath);

            var temporaryPath = $"{filePath}.{Guid.NewGuid():N}.tmp";

            try
            {
                File.WriteAllText(temporaryPath, json);

                if (File.Exists(filePath))
                {
                    File.Replace(temporaryPath, filePath, null);
                }
                else
                {
                    File.Move(temporaryPath, filePath);
                }
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
        }

        private static void ResetMutationJournalForTests()
        {
            UnityEditorMutationJournalStore.ResetForTests();
        }

        internal sealed class DeleteSnapshotRestoreResult
        {
            public string SnapshotId { get; set; }

            public string TargetLogicalName { get; set; }

            public string TargetDisplayName { get; set; }
        }

        [Serializable]
        private sealed class DeleteSnapshotRecord
        {
            public string SnapshotId { get; set; }

            public string CreatedAt { get; set; }

            public string Label { get; set; }

            public string ScenePath { get; set; }

            public string ParentLogicalName { get; set; }

            public DeleteSnapshotNode Root { get; set; }
        }

        [Serializable]
        private sealed class DeleteSnapshotNode
        {
            public string Name { get; set; }

            public bool ActiveSelf { get; set; }

            public string Tag { get; set; }

            public int Layer { get; set; }

            public bool IsStatic { get; set; }

            public int SiblingIndex { get; set; }

            public string TransformJson { get; set; }

            public DeleteSnapshotComponent[] Components { get; set; } = Array.Empty<DeleteSnapshotComponent>();

            public DeleteSnapshotNode[] Children { get; set; } = Array.Empty<DeleteSnapshotNode>();
        }

        [Serializable]
        private sealed class DeleteSnapshotComponent
        {
            public string TypeName { get; set; }

            public string Json { get; set; }
        }
    }
}
#endif
