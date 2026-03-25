#if UNITY_EDITOR
using System;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.HostTests
{
    public class EngineMcpUnityPluginLocalHttpServerTests
    {
        private const string SessionBootstrapFileEnvironmentVariable = "ENGINE_MCP_UNITY_PLUGIN_SESSION_FILE";
        private const string SandboxScenePath = "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity";

        private string _bootstrapFilePath;

        [SetUp]
        public void SetUp()
        {
            _bootstrapFilePath = Path.Combine(
                Path.GetTempPath(),
                $"engine-mcp-unity-plugin-test-{Guid.NewGuid():N}.json");
            Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, _bootstrapFilePath);
            EnsureSandboxSceneOpen();
            RestartLocalHttpServerBootstrap();
        }

        [TearDown]
        public void TearDown()
        {
            ResetTestCatalogProvider();
            StopLocalHttpServerBootstrap();
            Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, null);

            if (!string.IsNullOrWhiteSpace(_bootstrapFilePath) && File.Exists(_bootstrapFilePath))
            {
                File.Delete(_bootstrapFilePath);
            }
        }

        [Test]
        public void LocalHttpServer_ShouldRoundTripEditorStateRead_AndWriteBootstrapManifest()
        {
            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var sessionToken = ReadBootstrapProperty<string>("SessionToken");
            var bootstrapFilePath = ReadBootstrapProperty<string>("SessionBootstrapFilePath");

            Assert.That(endpointUrl, Is.Not.Null.And.Not.Empty);
            Assert.That(sessionToken, Is.Not.Null.And.Not.Empty);
            Assert.That(bootstrapFilePath, Is.EqualTo(_bootstrapFilePath));
            Assert.That(File.Exists(_bootstrapFilePath), Is.True);

            var bootstrap = JsonConvert.DeserializeObject<LocalBridgeSessionBootstrap>(File.ReadAllText(_bootstrapFilePath));
            Assert.That(bootstrap, Is.Not.Null);
            Assert.That(bootstrap!.EndpointUrl, Is.EqualTo(endpointUrl));
            Assert.That(bootstrap.SessionToken, Is.EqualTo(sessionToken));

            var responseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-roundtrip",
                    Capability = "editor.state.read",
                    SessionScope = "inspect",
                    Payload = JObject.FromObject(new
                    {
                        includeSelection = true,
                        includeActiveContainer = true,
                        includeDiagnostics = true
                    })
                });
            var httpResponse = WaitForTask(responseTask);

            Assert.That(httpResponse.StatusCode, Is.EqualTo(200));

            var response = JsonConvert.DeserializeObject<BridgeCallResponse>(httpResponse.Body);
            Assert.That(response, Is.Not.Null);
            Assert.That(response!.Success, Is.True);
            Assert.That(response.Payload?["engine"]?.Value<string>(), Is.EqualTo("Unity"));
            Assert.That(response.Payload?["activeContainer"]?["enginePath"]?.Value<string>(), Is.EqualTo(SandboxScenePath));
        }

        [Test]
        public void LocalHttpServer_ShouldRejectRequestsWithoutSessionToken()
        {
            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var responseTask = SendRequestAsync(
                endpointUrl,
                null,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-unauthorized",
                    Capability = "editor.state.read",
                    SessionScope = "inspect",
                    Payload = new JObject()
                });
            var httpResponse = WaitForTask(responseTask);

            Assert.That(httpResponse.StatusCode, Is.EqualTo(401));
            Assert.That(httpResponse.Body, Does.Contain("Missing or invalid session token"));
        }

        [Test]
        public void LocalHttpServer_ShouldReturnStructuredSandboxPolicyDetails()
        {
            _ = new GameObject("UnsafeRoot");
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());

            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var sessionToken = ReadBootstrapProperty<string>("SessionToken");
            var responseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-policy-denied",
                    Capability = "scene.object.create",
                    SessionScope = "sandbox_write",
                    Payload = JObject.FromObject(new
                    {
                        parent = new
                        {
                            logicalName = "UnsafeRoot"
                        },
                        name = "ShouldFail"
                    })
                });
            var httpResponse = WaitForTask(responseTask);

            Assert.That(httpResponse.StatusCode, Is.EqualTo(200));

            var response = JsonConvert.DeserializeObject<BridgeCallResponse>(httpResponse.Body);
            Assert.That(response, Is.Not.Null);
            Assert.That(response!.Success, Is.False);
            Assert.That(response.Error, Is.Not.Null);
            Assert.That(response.Error!.Code, Is.EqualTo("policy_denied"));
            Assert.That(response.Error.Message, Is.EqualTo("target_outside_sandbox"));
            Assert.That(response.Error.Details?["rule"]?.Value<string>(), Is.EqualTo("object_namespace"));
            Assert.That(response.Error.Details?["targetLogicalName"]?.Value<string>(), Is.EqualTo("UnsafeRoot"));
            Assert.That(response.Error.Details?["targetDisplayName"]?.Value<string>(), Is.EqualTo("UnsafeRoot"));
        }

        [Test]
        public void LocalHttpServer_ShouldReturnPolicyDeniedRollbackUnavailable_ForMissingSnapshotRestore()
        {
            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var sessionToken = ReadBootstrapProperty<string>("SessionToken");
            var responseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-missing-restore",
                    Capability = "snapshot.restore",
                    SessionScope = "dangerous_write",
                    Payload = JObject.FromObject(new
                    {
                        snapshotId = "snapshot-missing"
                    })
                });
            var httpResponse = WaitForTask(responseTask);

            Assert.That(httpResponse.StatusCode, Is.EqualTo(200));

            var response = JsonConvert.DeserializeObject<BridgeCallResponse>(httpResponse.Body);
            Assert.That(response, Is.Not.Null);
            Assert.That(response!.Success, Is.False);
            Assert.That(response.Error, Is.Not.Null);
            Assert.That(response.Error!.Code, Is.EqualTo("policy_denied"));
            Assert.That(response.Error.Message, Is.EqualTo("rollback_unavailable"));
            Assert.That(response.Error.Details?["capability"]?.Value<string>(), Is.EqualTo("snapshot.restore"));
            Assert.That(response.Error.Details?["snapshotId"]?.Value<string>(), Is.EqualTo("snapshot-missing"));
        }

        [Test]
        public void LocalHttpServer_ShouldReturnExplicitSnapshotIndexResource()
        {
            var sandboxRoot = GameObject.Find("SandboxRoot");
            Assert.That(sandboxRoot, Is.Not.Null);

            var deleteTarget = new GameObject("MCP_E2E__SnapshotIndexProbe");
            deleteTarget.transform.SetParent(sandboxRoot!.transform, false);
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());

            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var sessionToken = ReadBootstrapProperty<string>("SessionToken");

            var deleteResponseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-snapshot-capture",
                    Capability = "scene.object.delete",
                    SessionScope = "dangerous_write",
                    Payload = JObject.FromObject(new
                    {
                        target = new
                        {
                            logicalName = "SandboxRoot/MCP_E2E__SnapshotIndexProbe"
                        },
                        snapshotLabel = "snapshot-index-probe"
                    })
                });
            var deleteHttpResponse = WaitForTask(deleteResponseTask);
            var deleteEnvelope = JsonConvert.DeserializeObject<BridgeCallResponse>(deleteHttpResponse.Body);

            Assert.That(deleteEnvelope, Is.Not.Null);
            Assert.That(deleteEnvelope!.Success, Is.True);
            Assert.That(deleteEnvelope.SnapshotId, Is.Not.Null.And.Not.Empty);

            var resourceResponseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-snapshot-index",
                    RequestType = LocalBridgeProtocol.RequestTypeResourceRead,
                    SessionScope = "inspect",
                    Uri = LocalBridgeProtocol.SnapshotIndexResourceUri
                });
            var resourceHttpResponse = WaitForTask(resourceResponseTask);

            Assert.That(resourceHttpResponse.StatusCode, Is.EqualTo(200));

            var resourceEnvelope = JsonConvert.DeserializeObject<BridgeCallResponse>(resourceHttpResponse.Body);
            Assert.That(resourceEnvelope, Is.Not.Null);
            Assert.That(resourceEnvelope!.Success, Is.True);
            Assert.That(resourceEnvelope.Payload?["uri"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.SnapshotIndexResourceUri));
            Assert.That(resourceEnvelope.Payload?["mimeType"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.DiscoveryResourceMimeType));
            Assert.That(resourceEnvelope.Payload?["text"]?.Value<string>(), Does.Contain(deleteEnvelope.SnapshotId));
        }

        [Test]
        public void LocalHttpServer_ShouldReturnExplicitTestCatalogResource()
        {
            SetTestCatalogProvider(new[]
            {
                "Gameplay.EditMode.CheckpointTests.CreatesMarker",
                "Gameplay.PlayMode.CheckpointTests.RestoresSnapshot"
            });

            var endpointUrl = ReadBootstrapProperty<string>("EndpointUrl");
            var sessionToken = ReadBootstrapProperty<string>("SessionToken");
            var responseTask = SendRequestAsync(
                endpointUrl,
                sessionToken,
                new BridgeCallRequest
                {
                    RequestId = "req-plugin-server-test-catalog",
                    RequestType = LocalBridgeProtocol.RequestTypeResourceRead,
                    SessionScope = "inspect",
                    Uri = LocalBridgeProtocol.TestCatalogResourceUri
                });
            var httpResponse = WaitForTask(responseTask);

            Assert.That(httpResponse.StatusCode, Is.EqualTo(200));

            var response = JsonConvert.DeserializeObject<BridgeCallResponse>(httpResponse.Body);
            Assert.That(response, Is.Not.Null);
            Assert.That(response!.Success, Is.True);
            Assert.That(response.Payload?["uri"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.TestCatalogResourceUri));
            Assert.That(response.Payload?["mimeType"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.DiscoveryResourceMimeType));
            Assert.That(response.Payload?["text"]?.Value<string>(), Does.Contain("Gameplay.EditMode.CheckpointTests.CreatesMarker"));
            Assert.That(response.Payload?["text"]?.Value<string>(), Does.Contain("Gameplay.PlayMode.CheckpointTests.RestoresSnapshot"));
        }

        private static void EnsureSandboxSceneOpen()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(SandboxScenePath) == null)
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }

            var bootstrapType = Type.GetType(
                "EngineMcp.Unity.Plugin.Editor.UnitySandboxBootstrap, EngineMcp.Unity.Plugin.Editor");
            Assert.That(bootstrapType, Is.Not.Null);

            var ensureSceneOpen = bootstrapType!.GetMethod(
                "EnsureSandboxSceneOpen",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(ensureSceneOpen, Is.Not.Null);

            ensureSceneOpen!.Invoke(null, null);
            Assert.That(EditorSceneManager.GetActiveScene().path, Is.EqualTo(SandboxScenePath));
        }

        private static void RestartLocalHttpServerBootstrap()
        {
            var bootstrapType = GetBootstrapType();
            var restart = bootstrapType.GetMethod("RestartForTests", BindingFlags.Static | BindingFlags.NonPublic);

            Assert.That(restart, Is.Not.Null, "Local HTTP server bootstrap should expose RestartForTests.");

            restart!.Invoke(null, null);
        }

        private static void StopLocalHttpServerBootstrap()
        {
            var bootstrapType = GetBootstrapType();
            var stop = bootstrapType.GetMethod("StopForTests", BindingFlags.Static | BindingFlags.NonPublic);

            Assert.That(stop, Is.Not.Null, "Local HTTP server bootstrap should expose StopForTests.");

            stop!.Invoke(null, null);
        }

        private static void PumpLocalHttpServer()
        {
            var bootstrapType = GetBootstrapType();
            var pump = bootstrapType.GetMethod("ProcessPendingRequestsForTests", BindingFlags.Static | BindingFlags.NonPublic);

            Assert.That(pump, Is.Not.Null, "Local HTTP server bootstrap should expose ProcessPendingRequestsForTests.");

            pump!.Invoke(null, null);
        }

        private static T ReadBootstrapProperty<T>(string propertyName)
        {
            var bootstrapType = GetBootstrapType();
            var property = bootstrapType.GetProperty(propertyName, BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);

            Assert.That(property, Is.Not.Null, $"Expected bootstrap property {propertyName}.");

            return (T)property!.GetValue(null);
        }

        private static Type GetBootstrapType()
        {
            var bootstrapType = Type.GetType(
                "EngineMcp.Unity.Plugin.Editor.UnityPluginLocalHttpServerBootstrap, EngineMcp.Unity.Plugin.Editor");
            Assert.That(bootstrapType, Is.Not.Null, "Plugin-side local HTTP bootstrap type should exist.");
            return bootstrapType!;
        }

        private static void SetTestCatalogProvider(string[] tests)
        {
            var catalogType = Type.GetType(
                "EngineMcp.Unity.Plugin.Editor.UnityEditorTestCatalog, EngineMcp.Unity.Plugin.Editor");
            Assert.That(catalogType, Is.Not.Null, "Unity test catalog type should exist.");

            var setProvider = catalogType!.GetMethod(
                "SetProviderForTests",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(setProvider, Is.Not.Null, "Unity test catalog should expose SetProviderForTests.");

            Func<Task<string[]>> provider = () => Task.FromResult(tests);
            setProvider!.Invoke(null, new object[] { provider });
        }

        private static void ResetTestCatalogProvider()
        {
            var catalogType = Type.GetType(
                "EngineMcp.Unity.Plugin.Editor.UnityEditorTestCatalog, EngineMcp.Unity.Plugin.Editor");

            if (catalogType == null)
            {
                return;
            }

            var reset = catalogType.GetMethod(
                "ResetForTests",
                BindingFlags.Static | BindingFlags.NonPublic);

            reset?.Invoke(null, null);
        }

        private static HttpResponseData WaitForTask(Task<HttpResponseData> task)
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);

            while (!task.IsCompleted && DateTime.UtcNow < deadline)
            {
                PumpLocalHttpServer();
                Thread.Sleep(10);
            }

            if (!task.IsCompleted)
            {
                Assert.Fail("Timed out waiting for the plugin local HTTP server response.");
            }

            return task.GetAwaiter().GetResult();
        }

        private static async Task<HttpResponseData> SendRequestAsync(
            string endpointUrl,
            string sessionToken,
            BridgeCallRequest request)
        {
            using var client = new HttpClient();
            using var message = new HttpRequestMessage(HttpMethod.Post, endpointUrl)
            {
                Content = new StringContent(JsonConvert.SerializeObject(request), Encoding.UTF8, "application/json")
            };

            if (!string.IsNullOrWhiteSpace(sessionToken))
            {
                message.Headers.TryAddWithoutValidation("x-engine-mcp-session-token", sessionToken);
            }

            using var response = await client.SendAsync(message).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            return new HttpResponseData((int)response.StatusCode, body);
        }

        private sealed class HttpResponseData
        {
            public HttpResponseData(int statusCode, string body)
            {
                StatusCode = statusCode;
                Body = body;
            }

            public int StatusCode { get; }

            public string Body { get; }
        }
    }
}
#endif
