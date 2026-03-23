#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EngineMcp.Unity.Plugin.Editor
{
    public sealed class UnityEditorBackedBridgeDispatcher
    {
        private static readonly JsonSerializerSettings JsonSettings = new()
        {
            NullValueHandling = NullValueHandling.Ignore
        };

        public BridgeCallResponse Invoke(BridgeCallRequest request)
        {
            return InvokeAsync(request).GetAwaiter().GetResult();
        }

        public async System.Threading.Tasks.Task<BridgeCallResponse> InvokeAsync(BridgeCallRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            if (!string.Equals(request.ProtocolVersion, LocalBridgeProtocol.Version, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Unsupported local bridge protocol version '{request.ProtocolVersion}'.");
            }

            if (string.Equals(request.RequestType, LocalBridgeProtocol.RequestTypeResourceRead, StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(request.Uri))
                {
                    throw new ArgumentException("resource.read requires a non-empty uri.");
                }

                return CreateSuccessResponse(request, await UnityEditorBridgeResourceReader.ReadAsync(request.Uri));
            }

            return request.Capability switch
            {
                "editor.state.read" => CreateSuccessResponse(request, HandleEditorStateRead(ReadPayload<EditorStateReadInput>(request.Payload))),
                "asset.search" => CreateSuccessResponse(request, UnityEditorAssetSearch.Execute(ReadPayload<AssetSearchInput>(request.Payload))),
                "script.validate" => CreateSuccessResponse(request, UnityEditorScriptValidation.Execute(ReadPayload<ScriptValidateInput>(request.Payload))),
                "scene.hierarchy.read" => CreateSuccessResponse(request, HandleSceneHierarchyRead(ReadPayload<SceneHierarchyReadInput>(request.Payload))),
                "scene.object.create" => CreateSuccessResponse(request, HandleSceneObjectCreate(ReadPayload<SceneObjectCreateInput>(request.Payload))),
                "scene.object.update" => CreateSuccessResponse(request, HandleSceneObjectUpdate(ReadPayload<SceneObjectUpdateInput>(request.Payload))),
                "scene.object.delete" => CreateSuccessResponse(request, HandleSceneObjectDelete(ReadPayload<SceneObjectDeleteInput>(request.Payload))),
                "snapshot.restore" => CreateSuccessResponse(request, HandleSnapshotRestore(ReadPayload<SnapshotRestoreInput>(request.Payload))),
                "console.read" => CreateSuccessResponse(request, UnityEditorConsoleLogBuffer.Read(ReadPayload<ConsoleReadInput>(request.Payload))),
                "test.run" => CreateSuccessResponse(request, UnityEditorTestJobRegistry.Start(ReadPayload<TestRunInput>(request.Payload))),
                "test.job.read" => CreateSuccessResponse(request, UnityEditorTestJobRegistry.Read(ReadPayload<TestJobReadInput>(request.Payload))),
                _ => throw new InvalidOperationException($"Unsupported capability '{request.Capability}'.")
            };
        }

        private static BridgeCallResponse CreateSuccessResponse(BridgeCallRequest request, object payload)
        {
            return new BridgeCallResponse
            {
                ProtocolVersion = request.ProtocolVersion,
                RequestId = request.RequestId,
                Success = true,
                Payload = JToken.FromObject(payload, JsonSerializer.Create(JsonSettings)),
                SnapshotId = TryResolveSnapshotId(payload)
            };
        }

        private static string TryResolveSnapshotId(object payload)
        {
            return payload switch
            {
                SceneObjectDeleteOutput deleteOutput => deleteOutput.SnapshotId,
                SnapshotRestoreOutput restoreOutput => restoreOutput.SnapshotId,
                _ => null
            };
        }

        private static TPayload ReadPayload<TPayload>(JToken payload)
            where TPayload : new()
        {
            if (payload == null || payload.Type == JTokenType.Null)
            {
                return new TPayload();
            }

            return payload.ToObject<TPayload>(JsonSerializer.Create(JsonSettings)) ?? new TPayload();
        }

        private static EditorStateReadOutput HandleEditorStateRead(EditorStateReadInput input)
        {
            var activeScene = SceneManager.GetActiveScene();

            return new EditorStateReadOutput
            {
                Engine = "Unity",
                EngineVersion = Application.unityVersion,
                WorkspaceName = ResolveWorkspaceName(),
                IsReady = !EditorApplication.isCompiling && !EditorApplication.isUpdating,
                Activity = ResolveEditorActivity(),
                SelectionCount = input.IncludeSelection ? Selection.objects.Length : 0,
                ActiveContainer = input.IncludeActiveContainer && activeScene.IsValid()
                    ? ToSceneEntityRef(activeScene)
                    : null,
                Diagnostics = new List<DiagnosticRecord>()
            };
        }

        private static SceneHierarchyReadOutput HandleSceneHierarchyRead(SceneHierarchyReadInput input)
        {
            var scene = ResolveScene(input.Container);

            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("target_not_found: scene container could not be resolved.");
            }

            var depth = input.Depth ?? int.MaxValue;
            var includeInactive = input.IncludeInactive ?? false;
            var roots = new List<HierarchyNodeOutput>();

            foreach (var rootObject in scene.GetRootGameObjects())
            {
                if (!includeInactive && !rootObject.activeSelf)
                {
                    continue;
                }

                roots.Add(BuildHierarchyNode(rootObject, depth, input.IncludeComponents ?? false, includeInactive));
            }

            return new SceneHierarchyReadOutput
            {
                Container = ToSceneEntityRef(scene),
                Roots = roots
            };
        }

        private static SceneObjectCreateOutput HandleSceneObjectCreate(SceneObjectCreateInput input)
        {
            if (string.IsNullOrWhiteSpace(input.Name))
            {
                throw new ArgumentException("scene.object.create requires a non-empty name.");
            }

            var scene = ResolveScene(input.Container);

            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("target_not_found: scene container could not be resolved.");
            }

            EnsureSandboxScene(scene);

            var parent = input.Parent != null
                ? FindGameObject(scene, input.Parent)
                : FindGameObject(scene, new EntityReferenceInput { LogicalName = UnitySandboxBootstrap.SandboxRootObjectName });

            if (parent == null)
            {
                throw new InvalidOperationException("target_not_found: parent object could not be resolved.");
            }

            EnsureSandboxObject(parent, SandboxPolicyContract.ObjectNamespaceRule);

            var gameObject = new GameObject(UnitySandboxBootstrap.EnsureSandboxObjectName(input.Name.Trim()));
            Undo.RegisterCreatedObjectUndo(gameObject, "Engine MCP Create Object");
            SceneManager.MoveGameObjectToScene(gameObject, scene);
            Undo.SetTransformParent(gameObject.transform, parent.transform, "Engine MCP Create Object");
            GameObjectUtility.SetParentAndAlign(gameObject, parent);

            ApplyTransform(gameObject.transform, input.Transform);

            var appliedComponents = new List<string> { "Transform" };

            foreach (var componentPatch in input.Components ?? Array.Empty<ComponentPatchInput>())
            {
                var componentType = ResolveComponentType(componentPatch.Type);

                if (componentType == null)
                {
                    throw new InvalidOperationException(
                        $"validation_error: component type '{componentPatch.Type}' could not be resolved.");
                }

                if (gameObject.GetComponent(componentType) == null)
                {
                    gameObject.AddComponent(componentType);
                }

                appliedComponents.Add(componentType.Name);
            }

            if (input.SetActive.HasValue)
            {
                gameObject.SetActive(input.SetActive.Value);
            }

            EditorSceneManager.MarkSceneDirty(scene);

            return new SceneObjectCreateOutput
            {
                Object = ToObjectEntityRef(gameObject),
                Container = ToSceneEntityRef(scene),
                Created = true,
                Transform = ReadTransform(gameObject.transform),
                AppliedComponents = appliedComponents.Distinct(StringComparer.Ordinal).ToArray()
            };
        }

        private static SceneObjectUpdateOutput HandleSceneObjectUpdate(SceneObjectUpdateInput input)
        {
            if (input.Target == null)
            {
                throw new ArgumentException("scene.object.update requires a target.");
            }

            var scene = SceneManager.GetActiveScene();
            var target = FindGameObject(scene, input.Target);

            if (target == null)
            {
                throw new InvalidOperationException("target_not_found: target object could not be resolved.");
            }

            EnsureMutableSandboxTarget(target);

            var updatedFields = new List<string>();
            var undoGroup = BeginUndoGroup("Engine MCP Update Object");

            if (input.NewParent != null)
            {
                var newParent = FindGameObject(scene, input.NewParent);

                if (newParent == null)
                {
                    throw new InvalidOperationException("target_not_found: parent object could not be resolved.");
                }

                EnsureSandboxObject(newParent, SandboxPolicyContract.ObjectNamespaceRule);

                if (IsDescendant(newParent.transform, target.transform))
                {
                    throw new InvalidOperationException("validation_error: cannot reparent an object under its own descendant.");
                }

                Undo.SetTransformParent(target.transform, newParent.transform, "Engine MCP Update Object");
                updatedFields.Add("newParent");
            }

            if (!string.IsNullOrWhiteSpace(input.NewName))
            {
                Undo.RecordObject(target, "Engine MCP Update Object");
                target.name = UnitySandboxBootstrap.EnsureSandboxObjectName(input.NewName.Trim());
                updatedFields.Add("newName");
            }

            if (input.Transform != null)
            {
                Undo.RecordObject(target.transform, "Engine MCP Update Object");
                ApplyTransform(target.transform, input.Transform);
                updatedFields.Add("transform");
            }

            if (input.Components != null)
            {
                foreach (var componentPatch in input.Components)
                {
                    var componentType = ResolveComponentType(componentPatch.Type);

                    if (componentType == null)
                    {
                        throw new InvalidOperationException(
                            $"validation_error: component type '{componentPatch.Type}' could not be resolved.");
                    }

                    if (target.GetComponent(componentType) == null)
                    {
                        Undo.AddComponent(target, componentType);
                    }
                }

                updatedFields.Add("components");
            }

            if (input.Labels != null)
            {
                updatedFields.Add("labels");
            }

            if (input.Active.HasValue)
            {
                Undo.RecordObject(target, "Engine MCP Update Object");
                target.SetActive(input.Active.Value);
                updatedFields.Add("active");
            }

            if (updatedFields.Count == 0)
            {
                throw new InvalidOperationException("validation_error: scene.object.update requires at least one mutable field.");
            }

            EditorSceneManager.MarkSceneDirty(scene);
            Undo.CollapseUndoOperations(undoGroup);

            return new SceneObjectUpdateOutput
            {
                Object = ToObjectEntityRef(target),
                UpdatedFields = updatedFields.Distinct(StringComparer.Ordinal).ToArray(),
                Transform = ReadTransform(target.transform)
            };
        }

        private static SceneObjectDeleteOutput HandleSceneObjectDelete(SceneObjectDeleteInput input)
        {
            if (input.Target == null)
            {
                throw new ArgumentException("scene.object.delete requires a target.");
            }

            var scene = SceneManager.GetActiveScene();
            var target = FindGameObject(scene, input.Target);

            if (target == null)
            {
                if (input.AllowMissing)
                {
                    return new SceneObjectDeleteOutput
                    {
                        Target = ToRequestedEntityRef(input.Target),
                        Deleted = false
                    };
                }

                throw new InvalidOperationException("target_not_found: target object could not be resolved.");
            }

            EnsureMutableSandboxTarget(target);

            var targetReference = ToObjectEntityRef(target);
            var snapshotId = UnityEditorDeleteSnapshotStore.CaptureSnapshot(target, input.SnapshotLabel);
            var undoGroup = BeginUndoGroup("Engine MCP Delete Object");

            Undo.DestroyObjectImmediate(target);
            EditorSceneManager.MarkSceneDirty(scene);
            Undo.CollapseUndoOperations(undoGroup);

            return new SceneObjectDeleteOutput
            {
                Target = targetReference,
                Deleted = true,
                SnapshotId = snapshotId
            };
        }

        private static SnapshotRestoreOutput HandleSnapshotRestore(SnapshotRestoreInput input)
        {
            if (string.IsNullOrWhiteSpace(input.SnapshotId))
            {
                throw new ArgumentException("snapshot.restore requires a snapshotId.");
            }

            var restored = UnityEditorDeleteSnapshotStore.RestoreSnapshot(input.SnapshotId.Trim());

            return new SnapshotRestoreOutput
            {
                SnapshotId = restored.SnapshotId,
                Restored = true,
                Target = new EntityReferenceOutput
                {
                    LogicalName = restored.TargetLogicalName,
                    DisplayName = restored.TargetDisplayName
                }
            };
        }

        private static Scene ResolveScene(EntityReferenceInput containerReference)
        {
            if (containerReference == null)
            {
                return SceneManager.GetActiveScene();
            }

            if (!string.IsNullOrWhiteSpace(containerReference.EnginePath))
            {
                return SceneManager.GetSceneByPath(containerReference.EnginePath);
            }

            if (!string.IsNullOrWhiteSpace(containerReference.DisplayName))
            {
                for (var index = 0; index < SceneManager.sceneCount; index += 1)
                {
                    var candidate = SceneManager.GetSceneAt(index);

                    if (string.Equals(candidate.name, containerReference.DisplayName, StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(containerReference.LogicalName))
            {
                for (var index = 0; index < SceneManager.sceneCount; index += 1)
                {
                    var candidate = SceneManager.GetSceneAt(index);

                    if (string.Equals(candidate.name, containerReference.LogicalName, StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }

            return default;
        }

        private static GameObject FindGameObject(Scene scene, EntityReferenceInput reference)
        {
            foreach (var rootObject in scene.GetRootGameObjects())
            {
                var match = FindGameObject(rootObject, reference);

                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static GameObject FindGameObject(GameObject current, EntityReferenceInput reference)
        {
            if (MatchesReference(current, reference))
            {
                return current;
            }

            for (var index = 0; index < current.transform.childCount; index += 1)
            {
                var match = FindGameObject(current.transform.GetChild(index).gameObject, reference);

                if (match != null)
                {
                    return match;
                }
            }

            return null;
        }

        private static bool MatchesReference(GameObject gameObject, EntityReferenceInput reference)
        {
            if (reference == null)
            {
                return false;
            }

            if (!string.IsNullOrWhiteSpace(reference.LogicalName)
                && string.Equals(BuildLogicalName(gameObject.transform), reference.LogicalName, StringComparison.Ordinal))
            {
                return true;
            }

            if (!string.IsNullOrWhiteSpace(reference.DisplayName)
                && string.Equals(gameObject.name, reference.DisplayName, StringComparison.Ordinal))
            {
                return true;
            }

            return false;
        }

        private static void EnsureMutableSandboxTarget(GameObject gameObject)
        {
            EnsureSandboxObject(gameObject, SandboxPolicyContract.ObjectNamespaceRule);

            if (string.Equals(gameObject.name, UnitySandboxBootstrap.SandboxRootObjectName, StringComparison.Ordinal))
            {
                throw CreateTargetOutsideSandboxException(gameObject, SandboxPolicyContract.SandboxRootImmutableRule);
            }
        }

        private static void EnsureSandboxScene(Scene scene)
        {
            if (UnitySandboxBootstrap.IsSandboxScene(scene))
            {
                return;
            }

            throw new UnityBridgeCallException(
                "policy_denied",
                SandboxPolicyContract.TargetOutsideSandboxReason,
                SandboxPolicyContract.CreateTargetOutsideSandboxDetails(
                    SandboxPolicyContract.ScenePathRule,
                    scenePath: scene.path ?? string.Empty,
                    expectedScenePath: UnitySandboxBootstrap.SandboxScenePath));
        }

        private static void EnsureSandboxObject(GameObject gameObject, string rule)
        {
            if (UnitySandboxBootstrap.IsSandboxObject(gameObject))
            {
                return;
            }

            throw CreateTargetOutsideSandboxException(gameObject, rule);
        }

        private static UnityBridgeCallException CreateTargetOutsideSandboxException(
            GameObject gameObject,
            string rule)
        {
            return new UnityBridgeCallException(
                "policy_denied",
                SandboxPolicyContract.TargetOutsideSandboxReason,
                SandboxPolicyContract.CreateTargetOutsideSandboxDetails(
                    rule,
                    targetLogicalName: BuildLogicalName(gameObject.transform),
                    targetDisplayName: gameObject.name,
                    scenePath: gameObject.scene.path ?? string.Empty,
                    expectedScenePath: UnitySandboxBootstrap.SandboxScenePath));
        }

        private static HierarchyNodeOutput BuildHierarchyNode(
            GameObject gameObject,
            int remainingDepth,
            bool includeComponents,
            bool includeInactive)
        {
            var children = new List<HierarchyNodeOutput>();
            var node = new HierarchyNodeOutput
            {
                Object = ToObjectEntityRef(gameObject),
                Active = gameObject.activeSelf,
                Labels = BuildLabels(gameObject),
                Components = includeComponents ? GetComponentNames(gameObject) : null,
                Children = children
            };

            if (remainingDepth <= 0)
            {
                return node;
            }

            for (var index = 0; index < gameObject.transform.childCount; index += 1)
            {
                var child = gameObject.transform.GetChild(index).gameObject;

                if (!includeInactive && !child.activeSelf)
                {
                    continue;
                }

                children.Add(BuildHierarchyNode(child, remainingDepth - 1, includeComponents, includeInactive));
            }

            return node;
        }

        private static string ResolveWorkspaceName()
        {
            var projectDirectory = Directory.GetParent(Application.dataPath);
            return projectDirectory?.Name ?? "UnityProject";
        }

        private static string ResolveEditorActivity()
        {
            if (EditorApplication.isCompiling)
            {
                return "compiling";
            }

            if (EditorApplication.isUpdating)
            {
                return "importing";
            }

            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                return "playing";
            }

            return "idle";
        }

        private static EntityReferenceOutput ToSceneEntityRef(Scene scene)
        {
            return new EntityReferenceOutput
            {
                DisplayName = scene.name,
                EnginePath = scene.path
            };
        }

        private static EntityReferenceOutput ToObjectEntityRef(GameObject gameObject)
        {
            return new EntityReferenceOutput
            {
                LogicalName = BuildLogicalName(gameObject.transform),
                DisplayName = gameObject.name
            };
        }

        private static EntityReferenceOutput ToRequestedEntityRef(EntityReferenceInput reference)
        {
            return new EntityReferenceOutput
            {
                LogicalName = reference.LogicalName,
                EnginePath = reference.EnginePath,
                DisplayName = reference.DisplayName
            };
        }

        private static string BuildLogicalName(Transform transform)
        {
            return transform.parent == null
                ? transform.name
                : $"{BuildLogicalName(transform.parent)}/{transform.name}";
        }

        private static string[] GetComponentNames(GameObject gameObject)
        {
            return gameObject
                .GetComponents<Component>()
                .Where(component => component != null)
                .Select(component => component.GetType().Name)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        }

        private static string[] BuildLabels(GameObject gameObject)
        {
            return UnitySandboxBootstrap.IsSandboxObject(gameObject)
                ? new[] { "sandbox" }
                : Array.Empty<string>();
        }

        private static void ApplyTransform(Transform transform, Transform3DInput input)
        {
            if (input == null)
            {
                return;
            }

            if (input.Position != null)
            {
                transform.localPosition = ToVector3(input.Position);
            }

            if (input.RotationEuler != null)
            {
                transform.localEulerAngles = ToVector3(input.RotationEuler);
            }

            if (input.Scale != null)
            {
                transform.localScale = ToVector3(input.Scale);
            }
        }

        private static Transform3DOutput ReadTransform(Transform transform)
        {
            return new Transform3DOutput
            {
                Position = ToArray(transform.localPosition),
                RotationEuler = ToArray(transform.localEulerAngles),
                Scale = ToArray(transform.localScale)
            };
        }

        private static Type ResolveComponentType(string typeName)
        {
            if (string.IsNullOrWhiteSpace(typeName))
            {
                return null;
            }

            var direct = Type.GetType(typeName, throwOnError: false);

            if (IsComponentType(direct))
            {
                return direct;
            }

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                var candidate = assembly.GetType(typeName, throwOnError: false)
                                ?? assembly
                                    .GetTypes()
                                    .FirstOrDefault(type =>
                                        string.Equals(type.Name, typeName, StringComparison.Ordinal));

                if (IsComponentType(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static bool IsComponentType(Type candidate)
        {
            return candidate != null && typeof(Component).IsAssignableFrom(candidate);
        }

        private static Vector3 ToVector3(float[] values)
        {
            return new Vector3(values[0], values[1], values[2]);
        }

        private static float[] ToArray(Vector3 value)
        {
            return new[] { value.x, value.y, value.z };
        }

        private static int BeginUndoGroup(string label)
        {
            Undo.IncrementCurrentGroup();
            var undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName(label);
            return undoGroup;
        }

        private static bool IsDescendant(Transform candidateParent, Transform target)
        {
            for (var current = candidateParent; current != null; current = current.parent)
            {
                if (current == target)
                {
                    return true;
                }
            }

            return false;
        }

    }

    public sealed class EditorStateReadInput
    {
        [JsonProperty("includeDiagnostics")]
        public bool IncludeDiagnostics { get; set; }

        [JsonProperty("includeSelection")]
        public bool IncludeSelection { get; set; }

        [JsonProperty("includeActiveContainer")]
        public bool IncludeActiveContainer { get; set; }
    }

    public sealed class SceneHierarchyReadInput
    {
        [JsonProperty("container")]
        public EntityReferenceInput Container { get; set; }

        [JsonProperty("depth")]
        public int? Depth { get; set; }

        [JsonProperty("includeComponents")]
        public bool? IncludeComponents { get; set; }

        [JsonProperty("includeInactive")]
        public bool? IncludeInactive { get; set; }
    }

    public sealed class AssetSearchInput
    {
        [JsonProperty("query")]
        public string Query { get; set; }

        [JsonProperty("roots")]
        public string[] Roots { get; set; }

        [JsonProperty("kinds")]
        public string[] Kinds { get; set; }

        [JsonProperty("limit")]
        public int? Limit { get; set; }
    }

    public sealed class ScriptValidateInput
    {
        [JsonProperty("path")]
        public string Path { get; set; }

        [JsonProperty("assetGuid")]
        public string AssetGuid { get; set; }

        [JsonProperty("includeWarnings")]
        public bool IncludeWarnings { get; set; }
    }

    public sealed class SceneObjectCreateInput
    {
        [JsonProperty("container")]
        public EntityReferenceInput Container { get; set; }

        [JsonProperty("parent")]
        public EntityReferenceInput Parent { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("kind")]
        public string Kind { get; set; }

        [JsonProperty("transform")]
        public Transform3DInput Transform { get; set; }

        [JsonProperty("components")]
        public ComponentPatchInput[] Components { get; set; }

        [JsonProperty("labels")]
        public string[] Labels { get; set; }

        [JsonProperty("setActive")]
        public bool? SetActive { get; set; }
    }

    public sealed class SceneObjectUpdateInput
    {
        [JsonProperty("target")]
        public EntityReferenceInput Target { get; set; }

        [JsonProperty("newName")]
        public string NewName { get; set; }

        [JsonProperty("newParent")]
        public EntityReferenceInput NewParent { get; set; }

        [JsonProperty("transform")]
        public Transform3DInput Transform { get; set; }

        [JsonProperty("components")]
        public ComponentPatchInput[] Components { get; set; }

        [JsonProperty("labels")]
        public string[] Labels { get; set; }

        [JsonProperty("active")]
        public bool? Active { get; set; }
    }

    public sealed class SceneObjectDeleteInput
    {
        [JsonProperty("target")]
        public EntityReferenceInput Target { get; set; }

        [JsonProperty("allowMissing")]
        public bool AllowMissing { get; set; }

        [JsonProperty("snapshotLabel")]
        public string SnapshotLabel { get; set; }
    }

    public sealed class SnapshotRestoreInput
    {
        [JsonProperty("snapshotId")]
        public string SnapshotId { get; set; } = string.Empty;
    }

    public sealed class EntityReferenceInput
    {
        [JsonProperty("logicalName")]
        public string LogicalName { get; set; }

        [JsonProperty("enginePath")]
        public string EnginePath { get; set; }

        [JsonProperty("displayName")]
        public string DisplayName { get; set; }
    }

    public sealed class TestRunInput
    {
        [JsonProperty("filter")]
        public TestFilterInput Filter { get; set; }

        [JsonProperty("executionTarget")]
        public string ExecutionTarget { get; set; }

        [JsonProperty("waitForCompletion")]
        public bool? WaitForCompletion { get; set; }

        [JsonProperty("timeoutMs")]
        public int? TimeoutMs { get; set; }
    }

    public sealed class TestJobReadInput
    {
        [JsonProperty("jobId")]
        public string JobId { get; set; } = string.Empty;

        [JsonProperty("maxResults")]
        public int? MaxResults { get; set; }
    }

    public sealed class TestFilterInput
    {
        [JsonProperty("namePattern")]
        public string NamePattern { get; set; }

        [JsonProperty("paths")]
        public string[] Paths { get; set; }

        [JsonProperty("tags")]
        public string[] Tags { get; set; }
    }

    public sealed class ConsoleReadInput
    {
        [JsonProperty("sinceSequence")]
        public int? SinceSequence { get; set; }

        [JsonProperty("severities")]
        public string[] Severities { get; set; }

        [JsonProperty("limit")]
        public int? Limit { get; set; }
    }

    public sealed class ComponentPatchInput
    {
        [JsonProperty("type")]
        public string Type { get; set; } = string.Empty;
    }

    public sealed class Transform3DInput
    {
        [JsonProperty("position")]
        public float[] Position { get; set; }

        [JsonProperty("rotationEuler")]
        public float[] RotationEuler { get; set; }

        [JsonProperty("scale")]
        public float[] Scale { get; set; }
    }

    public sealed class EditorStateReadOutput
    {
        [JsonProperty("engine")]
        public string Engine { get; set; }

        [JsonProperty("engineVersion")]
        public string EngineVersion { get; set; }

        [JsonProperty("workspaceName")]
        public string WorkspaceName { get; set; }

        [JsonProperty("isReady")]
        public bool IsReady { get; set; }

        [JsonProperty("activity")]
        public string Activity { get; set; }

        [JsonProperty("selectionCount")]
        public int SelectionCount { get; set; }

        [JsonProperty("activeContainer")]
        public EntityReferenceOutput ActiveContainer { get; set; }

        [JsonProperty("diagnostics")]
        public IReadOnlyList<DiagnosticRecord> Diagnostics { get; set; }
    }

    public sealed class SceneHierarchyReadOutput
    {
        [JsonProperty("container")]
        public EntityReferenceOutput Container { get; set; }

        [JsonProperty("roots")]
        public IReadOnlyList<HierarchyNodeOutput> Roots { get; set; }
    }

    public sealed class AssetSearchOutput
    {
        [JsonProperty("results")]
        public IReadOnlyList<AssetRecordOutput> Results { get; set; }

        [JsonProperty("total")]
        public int Total { get; set; }

        [JsonProperty("truncated")]
        public bool Truncated { get; set; }
    }

    public sealed class ScriptValidateOutput
    {
        [JsonProperty("targetPath")]
        public string TargetPath { get; set; }

        [JsonProperty("isValid")]
        public bool IsValid { get; set; }

        [JsonProperty("diagnostics")]
        public IReadOnlyList<DiagnosticRecord> Diagnostics { get; set; }
    }

    public sealed class AssetRecordOutput
    {
        [JsonProperty("assetGuid")]
        public string AssetGuid { get; set; }

        [JsonProperty("assetPath")]
        public string AssetPath { get; set; }

        [JsonProperty("displayName")]
        public string DisplayName { get; set; }

        [JsonProperty("kind")]
        public string Kind { get; set; }
    }

    public sealed class SceneObjectCreateOutput
    {
        [JsonProperty("object")]
        public EntityReferenceOutput Object { get; set; }

        [JsonProperty("container")]
        public EntityReferenceOutput Container { get; set; }

        [JsonProperty("created")]
        public bool Created { get; set; }

        [JsonProperty("transform")]
        public Transform3DOutput Transform { get; set; }

        [JsonProperty("appliedComponents")]
        public IReadOnlyList<string> AppliedComponents { get; set; }
    }

    public sealed class SceneObjectUpdateOutput
    {
        [JsonProperty("object")]
        public EntityReferenceOutput Object { get; set; }

        [JsonProperty("updatedFields")]
        public IReadOnlyList<string> UpdatedFields { get; set; }

        [JsonProperty("transform")]
        public Transform3DOutput Transform { get; set; }
    }

    public sealed class SceneObjectDeleteOutput
    {
        [JsonProperty("target")]
        public EntityReferenceOutput Target { get; set; }

        [JsonProperty("deleted")]
        public bool Deleted { get; set; }

        [JsonProperty("snapshotId")]
        public string SnapshotId { get; set; }
    }

    public sealed class SnapshotRestoreOutput
    {
        [JsonProperty("snapshotId")]
        public string SnapshotId { get; set; }

        [JsonProperty("restored")]
        public bool Restored { get; set; }

        [JsonProperty("target")]
        public EntityReferenceOutput Target { get; set; }
    }

    public sealed class TestRunOutput
    {
        [JsonProperty("jobId")]
        public string JobId { get; set; } = string.Empty;

        [JsonProperty("status")]
        public string Status { get; set; } = "queued";

        [JsonProperty("acceptedFilter")]
        public TestFilterInput AcceptedFilter { get; set; }
    }

    public sealed class TestJobReadOutput
    {
        [JsonProperty("jobId")]
        public string JobId { get; set; } = string.Empty;

        [JsonProperty("status")]
        public string Status { get; set; } = "queued";

        [JsonProperty("progress")]
        public double Progress { get; set; }

        [JsonProperty("summary")]
        public TestSummaryOutput Summary { get; set; }

        [JsonProperty("results")]
        public IReadOnlyList<TestCaseResultOutput> Results { get; set; }
    }

    public sealed class TestSummaryOutput
    {
        [JsonProperty("passed")]
        public int Passed { get; set; }

        [JsonProperty("failed")]
        public int Failed { get; set; }

        [JsonProperty("skipped")]
        public int Skipped { get; set; }
    }

    public sealed class TestCaseResultOutput
    {
        [JsonProperty("name")]
        public string Name { get; set; } = string.Empty;

        [JsonProperty("status")]
        public string Status { get; set; } = "passed";

        [JsonProperty("durationMs")]
        public double DurationMs { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; }
    }

    public sealed class ConsoleReadOutput
    {
        [JsonProperty("entries")]
        public IReadOnlyList<ConsoleEntryOutput> Entries { get; set; }

        [JsonProperty("nextSequence")]
        public int NextSequence { get; set; }

        [JsonProperty("truncated")]
        public bool Truncated { get; set; }
    }

    public sealed class ConsoleEntryOutput
    {
        [JsonProperty("severity")]
        public string Severity { get; set; } = "info";

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;

        [JsonProperty("channel")]
        public string Channel { get; set; }

        [JsonProperty("source")]
        public string Source { get; set; }

        [JsonProperty("sequence")]
        public int Sequence { get; set; }

        [JsonProperty("timestamp")]
        public string Timestamp { get; set; }
    }

    public sealed class HierarchyNodeOutput
    {
        [JsonProperty("object")]
        public EntityReferenceOutput Object { get; set; }

        [JsonProperty("active")]
        public bool Active { get; set; }

        [JsonProperty("labels")]
        public IReadOnlyList<string> Labels { get; set; }

        [JsonProperty("components")]
        public IReadOnlyList<string> Components { get; set; }

        [JsonProperty("children")]
        public IReadOnlyList<HierarchyNodeOutput> Children { get; set; }
    }

    public sealed class EntityReferenceOutput
    {
        [JsonProperty("logicalName")]
        public string LogicalName { get; set; }

        [JsonProperty("enginePath")]
        public string EnginePath { get; set; }

        [JsonProperty("displayName")]
        public string DisplayName { get; set; }
    }

    public sealed class Transform3DOutput
    {
        [JsonProperty("position")]
        public float[] Position { get; set; }

        [JsonProperty("rotationEuler")]
        public float[] RotationEuler { get; set; }

        [JsonProperty("scale")]
        public float[] Scale { get; set; }
    }

    public sealed class DiagnosticRecord
    {
        [JsonProperty("severity")]
        public string Severity { get; set; } = "info";

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;

        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("path")]
        public string Path { get; set; }

        [JsonProperty("line")]
        public int? Line { get; set; }

        [JsonProperty("column")]
        public int? Column { get; set; }
    }
}
#endif
