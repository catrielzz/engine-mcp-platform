#if UNITY_EDITOR
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using NUnit.Framework;
using UnityEditor;

namespace EngineMcp.Unity.Plugin.Tests.Editor
{
    public class UnityBridgeEditorBootstrapTests
    {
        private const string SessionStatePrefix = "EngineMcp.Unity.Plugin.Editor.UnityBridgeBootstrap";
        private const string SessionBootstrapFileEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_SESSION_FILE";
        private const string EndpointUrlEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_URL";
        private const string SessionTokenEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_TOKEN";

        [SetUp]
        public void SetUp()
        {
            ClearEnvironment();
            ClearSessionState();
            InvokeRefreshConfiguration();
        }

        [TearDown]
        public void TearDown()
        {
            ClearEnvironment();
            ClearSessionState();
            InvokeRefreshConfiguration();
        }

        [Test]
        public void RefreshConfiguration_ShouldLoadBootstrapFile_AndMarkClientConfigured()
        {
            var bootstrapFilePath = Path.GetTempFileName();

            try
            {
                File.WriteAllText(
                    bootstrapFilePath,
                    JsonConvert.SerializeObject(new LocalBridgeSessionBootstrap
                    {
                        EndpointUrl = "http://127.0.0.1:38123/bridge/call",
                        SessionToken = "bootstrap-token",
                        IssuedAt = "2026-03-19T00:00:00.0000000Z",
                        OwnerProcessId = Process.GetCurrentProcess().Id
                    }));
                Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, bootstrapFilePath);

                InvokeRefreshConfiguration();

                Assert.That(ReadStaticProperty<string>("EndpointUrl"), Is.EqualTo("http://127.0.0.1:38123/bridge/call"));
                Assert.That(ReadStaticProperty<string>("SessionToken"), Is.EqualTo("bootstrap-token"));
                Assert.That(ReadStaticProperty<bool>("IsConfigured"), Is.True);
            }
            finally
            {
                if (File.Exists(bootstrapFilePath))
                {
                    File.Delete(bootstrapFilePath);
                }
            }
        }

        [Test]
        public void RefreshConfiguration_ShouldFallbackToExplicitEnvironmentVariables_WhenBootstrapFileIsMissing()
        {
            Environment.SetEnvironmentVariable(EndpointUrlEnvironmentVariable, "http://127.0.0.1:38123/bridge/call");
            Environment.SetEnvironmentVariable(SessionTokenEnvironmentVariable, "env-token");

            InvokeRefreshConfiguration();

            Assert.That(ReadStaticProperty<string>("EndpointUrl"), Is.EqualTo("http://127.0.0.1:38123/bridge/call"));
            Assert.That(ReadStaticProperty<string>("SessionToken"), Is.EqualTo("env-token"));
            Assert.That(ReadStaticProperty<bool>("IsConfigured"), Is.True);
        }

        [Test]
        public void RefreshConfiguration_ShouldRejectBootstrap_WhenOwnerProcessIsNotAlive()
        {
            var bootstrapFilePath = Path.GetTempFileName();

            try
            {
                File.WriteAllText(
                    bootstrapFilePath,
                    JsonConvert.SerializeObject(new LocalBridgeSessionBootstrap
                    {
                        EndpointUrl = "http://127.0.0.1:38123/bridge/call",
                        SessionToken = "bootstrap-token",
                        IssuedAt = "2026-03-19T00:00:00.0000000Z",
                        OwnerProcessId = int.MaxValue
                    }));
                Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, bootstrapFilePath);

                InvokeRefreshConfiguration();

                Assert.That(ReadStaticProperty<bool>("IsConfigured"), Is.False);
                Assert.That(ReadStaticProperty<string>("EndpointUrl"), Is.Empty);
                Assert.That(ReadStaticProperty<string>("SessionToken"), Is.Empty);
            }
            finally
            {
                if (File.Exists(bootstrapFilePath))
                {
                    File.Delete(bootstrapFilePath);
                }
            }
        }

        [Test]
        public void CreateDefaultClient_ShouldRejectCachedBootstrap_WhenSessionFileIsMissing()
        {
            var bootstrapFilePath = Path.GetTempFileName();

            try
            {
                File.WriteAllText(
                    bootstrapFilePath,
                    JsonConvert.SerializeObject(new LocalBridgeSessionBootstrap
                    {
                        EndpointUrl = "http://127.0.0.1:38123/bridge/call",
                        SessionToken = "bootstrap-token",
                        IssuedAt = "2026-03-19T00:00:00.0000000Z",
                        OwnerProcessId = Process.GetCurrentProcess().Id
                    }));
                Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, bootstrapFilePath);

                InvokeRefreshConfiguration();
                File.Delete(bootstrapFilePath);

                var exception = Assert.Throws<TargetInvocationException>(() => InvokeCreateDefaultClient());

                Assert.That(exception!.InnerException, Is.TypeOf<InvalidOperationException>());
                Assert.That(ReadStaticProperty<bool>("IsConfigured"), Is.False);
                Assert.That(ReadStaticProperty<string>("EndpointUrl"), Is.Empty);
                Assert.That(ReadStaticProperty<string>("SessionToken"), Is.Empty);
            }
            finally
            {
                if (File.Exists(bootstrapFilePath))
                {
                    File.Delete(bootstrapFilePath);
                }
            }
        }

        private static void ClearEnvironment()
        {
            Environment.SetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable, null);
            Environment.SetEnvironmentVariable(EndpointUrlEnvironmentVariable, null);
            Environment.SetEnvironmentVariable(SessionTokenEnvironmentVariable, null);
        }

        private static void ClearSessionState()
        {
            SessionState.EraseString($"{SessionStatePrefix}.EndpointUrl");
            SessionState.EraseString($"{SessionStatePrefix}.SessionToken");
            SessionState.EraseString($"{SessionStatePrefix}.BootstrapFilePath");
        }

        private static void InvokeRefreshConfiguration()
        {
            var method = GetBootstrapType().GetMethod(
                "RefreshConfiguration",
                BindingFlags.Static | BindingFlags.NonPublic);

            method!.Invoke(null, null);
        }

        private static object InvokeCreateDefaultClient()
        {
            var method = GetBootstrapType().GetMethod(
                "CreateDefaultClient",
                BindingFlags.Static | BindingFlags.NonPublic);

            return method!.Invoke(null, null);
        }

        private static T ReadStaticProperty<T>(string propertyName)
        {
            var property = GetBootstrapType().GetProperty(
                propertyName,
                BindingFlags.Static | BindingFlags.NonPublic);

            return (T)property!.GetValue(null);
        }

        private static Type GetBootstrapType()
        {
            return Type.GetType("EngineMcp.Unity.Plugin.Editor.UnityBridgeEditorBootstrap, EngineMcp.Unity.Plugin.Editor");
        }
    }
}
#endif
