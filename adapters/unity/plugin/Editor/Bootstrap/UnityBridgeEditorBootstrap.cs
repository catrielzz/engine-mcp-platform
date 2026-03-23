#if UNITY_EDITOR
using System;
using System.IO;
using EngineMcp.Unity.Plugin.Client;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;
using DiagnosticsProcess = System.Diagnostics.Process;

namespace EngineMcp.Unity.Plugin.Editor
{
    [InitializeOnLoad]
    internal static class UnityBridgeEditorBootstrap
    {
        internal const string EndpointUrlEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_URL";
        internal const string SessionTokenEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_TOKEN";
        internal const string SessionBootstrapFileEnvironmentVariable = "ENGINE_MCP_UNITY_BRIDGE_SESSION_FILE";
        internal const string DefaultBootstrapFileName = "engine-mcp-unity-bridge-session.json";
        internal const string DefaultBootstrapDirectory = "engine-mcp-platform/unity-bridge";
        private const string SessionStatePrefix = "EngineMcp.Unity.Plugin.Editor.UnityBridgeBootstrap";

        internal static string EndpointUrl { get; private set; } = string.Empty;
        internal static string SessionToken { get; private set; } = string.Empty;
        internal static string SessionBootstrapFilePath { get; private set; } = string.Empty;
        internal static bool IsConfigured => !string.IsNullOrWhiteSpace(EndpointUrl)
                                             && !string.IsNullOrWhiteSpace(SessionToken);

        static UnityBridgeEditorBootstrap()
        {
            RefreshConfiguration();
        }

        internal static void RefreshConfiguration()
        {
            var bootstrapFilePath = ResolveBootstrapFilePath();

            if (TryLoadSessionBootstrap(bootstrapFilePath, out var bootstrap))
            {
                ApplyConfiguration(bootstrap.EndpointUrl, bootstrap.SessionToken, bootstrapFilePath, cacheForSession: true);
                return;
            }

            ClearCachedConfiguration();

            var envEndpoint = ReadSetting(EndpointUrlEnvironmentVariable, string.Empty);
            var envToken = ReadSetting(SessionTokenEnvironmentVariable, string.Empty);

            if (!string.IsNullOrWhiteSpace(envEndpoint) && !string.IsNullOrWhiteSpace(envToken))
            {
                ApplyConfiguration(envEndpoint, envToken, bootstrapFilePath, cacheForSession: true);
                return;
            }

            ApplyConfiguration(string.Empty, string.Empty, bootstrapFilePath, cacheForSession: false);
        }

        internal static UnityBridgeClient CreateDefaultClient()
        {
            RefreshConfiguration();

            if (!IsConfigured)
            {
                throw new InvalidOperationException(
                    "Unity bridge bootstrap is not configured. Provide a session bootstrap file or explicit bridge environment variables.");
            }

            return new UnityBridgeClient(new LocalHttpUnityBridgeTransport(EndpointUrl, SessionToken));
        }

        private static void ApplyConfiguration(
            string endpointUrl,
            string sessionToken,
            string bootstrapFilePath,
            bool cacheForSession)
        {
            EndpointUrl = endpointUrl;
            SessionToken = sessionToken;
            SessionBootstrapFilePath = bootstrapFilePath;

            if (!cacheForSession)
            {
                return;
            }

            SessionState.SetString($"{SessionStatePrefix}.EndpointUrl", endpointUrl);
            SessionState.SetString($"{SessionStatePrefix}.SessionToken", sessionToken);
            SessionState.SetString($"{SessionStatePrefix}.BootstrapFilePath", bootstrapFilePath);
        }

        private static void ClearCachedConfiguration()
        {
            SessionState.EraseString($"{SessionStatePrefix}.EndpointUrl");
            SessionState.EraseString($"{SessionStatePrefix}.SessionToken");
            SessionState.EraseString($"{SessionStatePrefix}.BootstrapFilePath");
        }

        private static string ResolveBootstrapFilePath()
        {
            var configuredPath = ReadSetting(SessionBootstrapFileEnvironmentVariable, string.Empty);

            if (!string.IsNullOrWhiteSpace(configuredPath))
            {
                return configuredPath;
            }

            return Path.Combine(Path.GetTempPath(), DefaultBootstrapDirectory, DefaultBootstrapFileName);
        }

        private static bool TryLoadSessionBootstrap(string bootstrapFilePath, out LocalBridgeSessionBootstrap bootstrap)
        {
            bootstrap = null;

            if (string.IsNullOrWhiteSpace(bootstrapFilePath) || !File.Exists(bootstrapFilePath))
            {
                return false;
            }

            try
            {
                var bootstrapJson = File.ReadAllText(bootstrapFilePath);
                var parsed = JsonConvert.DeserializeObject<LocalBridgeSessionBootstrap>(bootstrapJson);

                if (parsed == null
                    || !string.Equals(parsed.ProtocolVersion, LocalBridgeProtocol.Version, StringComparison.Ordinal)
                    || !string.Equals(parsed.Transport, "local_http", StringComparison.Ordinal)
                    || string.IsNullOrWhiteSpace(parsed.EndpointUrl)
                    || string.IsNullOrWhiteSpace(parsed.SessionToken)
                    || parsed.OwnerProcessId <= 0)
                {
                    return false;
                }

                if (!IsOwnerProcessAlive(parsed.OwnerProcessId))
                {
                    TryDeleteBootstrapFile(bootstrapFilePath);
                    return false;
                }

                bootstrap = parsed;
                return true;
            }
            catch (Exception exception)
            {
                Debug.LogWarning(
                    $"Engine MCP Unity bridge bootstrap could not read session file '{bootstrapFilePath}': {exception.Message}");
                return false;
            }
        }

        private static string ReadSetting(string environmentVariable, string fallbackValue)
        {
            var value = Environment.GetEnvironmentVariable(environmentVariable);

            return string.IsNullOrWhiteSpace(value) ? fallbackValue : value.Trim();
        }

        private static bool IsOwnerProcessAlive(int ownerProcessId)
        {
            try
            {
                using var process = DiagnosticsProcess.GetProcessById(ownerProcessId);
                return !process.HasExited;
            }
            catch
            {
                return false;
            }
        }

        private static void TryDeleteBootstrapFile(string bootstrapFilePath)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(bootstrapFilePath) && File.Exists(bootstrapFilePath))
                {
                    File.Delete(bootstrapFilePath);
                }
            }
            catch
            {
            }
        }
    }
}
#endif
