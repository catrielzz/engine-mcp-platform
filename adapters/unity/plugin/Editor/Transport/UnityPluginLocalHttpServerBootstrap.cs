#if UNITY_EDITOR
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using DiagnosticsProcess = System.Diagnostics.Process;

namespace EngineMcp.Unity.Plugin.Editor
{
    [InitializeOnLoad]
    internal static class UnityPluginLocalHttpServerBootstrap
    {
        internal const string SessionBootstrapFileEnvironmentVariable = "ENGINE_MCP_UNITY_PLUGIN_SESSION_FILE";
        internal const string DefaultBootstrapFileName = "engine-mcp-unity-plugin-session.json";
        internal const string DefaultBootstrapDirectory = "engine-mcp-platform/unity-plugin";
        private const string SessionTokenHeaderName = "x-engine-mcp-session-token";
        private const string CallPath = "/bridge/call";

        private static readonly ConcurrentQueue<PendingInvocation> PendingInvocations = new();
        private static readonly UnityEditorBackedBridgeDispatcher Dispatcher = new();

        private static HttpListener _listener;
        private static CancellationTokenSource _listenerCancellation;
        private static Task _listenerTask;

        internal static string EndpointUrl { get; private set; } = string.Empty;
        internal static string SessionToken { get; private set; } = string.Empty;
        internal static string SessionBootstrapFilePath { get; private set; } = string.Empty;
        internal static bool IsRunning => _listener != null && _listener.IsListening;

        static UnityPluginLocalHttpServerBootstrap()
        {
            EditorApplication.update += ProcessPendingRequests;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            EnsureStarted();
        }

        internal static void RestartForTests()
        {
            Stop();
            EnsureStarted();
        }

        internal static void StopForTests()
        {
            Stop();
        }

        internal static void ProcessPendingRequestsForTests()
        {
            ProcessPendingRequests();
        }

        private static void EnsureStarted()
        {
            if (IsRunning)
            {
                return;
            }

            SessionBootstrapFilePath = ResolveBootstrapFilePath();
            SessionToken = CreateSessionToken();

            var port = ReserveLoopbackPort();
            EndpointUrl = $"http://127.0.0.1:{port}{CallPath}";

            _listenerCancellation = new CancellationTokenSource();
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            _listener.Start();

            WriteBootstrapManifest(SessionBootstrapFilePath, EndpointUrl, SessionToken);

            _listenerTask = Task.Run(() => ListenAsync(_listener, _listenerCancellation.Token));
        }

        private static async Task ListenAsync(HttpListener listener, CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                HttpListenerContext context;

                try
                {
                    context = await listener.GetContextAsync().ConfigureAwait(false);
                }
                catch (Exception exception) when (
                    cancellationToken.IsCancellationRequested
                    || exception is ObjectDisposedException
                    || exception is HttpListenerException)
                {
                    break;
                }

                _ = Task.Run(() => HandleContextAsync(context, cancellationToken), cancellationToken);
            }
        }

        private static async Task HandleContextAsync(HttpListenerContext context, CancellationToken cancellationToken)
        {
            try
            {
                if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(context.Response, 405, new { error = "Method not allowed." });
                    return;
                }

                if (!string.Equals(context.Request.Url?.AbsolutePath, CallPath, StringComparison.Ordinal))
                {
                    WriteJson(context.Response, 404, new { error = "Not found." });
                    return;
                }

                var presentedToken = context.Request.Headers[SessionTokenHeaderName];

                if (!string.Equals(presentedToken, SessionToken, StringComparison.Ordinal))
                {
                    WriteJson(context.Response, 401, new { error = "Missing or invalid session token." });
                    return;
                }

                BridgeCallRequest request;

                try
                {
                    using var reader = new StreamReader(
                        context.Request.InputStream,
                        context.Request.ContentEncoding ?? Encoding.UTF8);
                    var requestJson = await reader.ReadToEndAsync().ConfigureAwait(false);
                    request = JsonConvert.DeserializeObject<BridgeCallRequest>(requestJson);
                }
                catch (Exception exception)
                {
                    WriteJson(context.Response, 400, new { error = $"Invalid request body: {exception.Message}" });
                    return;
                }

                if (request == null)
                {
                    WriteJson(context.Response, 400, new { error = "Invalid request body: empty request." });
                    return;
                }

                var completion = new TaskCompletionSource<BridgeCallResponse>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                PendingInvocations.Enqueue(new PendingInvocation(request, completion, cancellationToken));
                var response = await completion.Task.ConfigureAwait(false);

                WriteJson(context.Response, 200, response);
            }
            catch (Exception exception)
            {
                WriteJson(context.Response, 500, new { error = exception.Message });
            }
        }

        private static void ProcessPendingRequests()
        {
            while (PendingInvocations.TryDequeue(out var pendingInvocation))
            {
                if (pendingInvocation.CancellationToken.IsCancellationRequested)
                {
                    pendingInvocation.Completion.TrySetCanceled(pendingInvocation.CancellationToken);
                    continue;
                }

                _ = CompletePendingInvocationAsync(pendingInvocation);
            }
        }

        private static async Task CompletePendingInvocationAsync(PendingInvocation pendingInvocation)
        {
            try
            {
                var response = await Dispatcher.InvokeAsync(pendingInvocation.Request);
                pendingInvocation.Completion.TrySetResult(response);
            }
            catch (Exception exception)
            {
                pendingInvocation.Completion.TrySetResult(
                    CreateErrorResponse(pendingInvocation.Request, exception));
            }
        }

        private static BridgeCallResponse CreateErrorResponse(BridgeCallRequest request, Exception exception)
        {
            var (code, message, details) = MapError(exception);

            return new BridgeCallResponse
            {
                ProtocolVersion = request?.ProtocolVersion ?? LocalBridgeProtocol.Version,
                RequestId = request?.RequestId ?? string.Empty,
                Success = false,
                Payload = JValue.CreateNull(),
                Error = new BridgeCallError
                {
                    Code = code,
                    Message = message,
                    Details = details
                }
            };
        }

        private static (string code, string message, JToken details) MapError(Exception exception)
        {
            if (exception == null)
            {
                return ("bridge_transport_error", "Unknown transport failure.", null);
            }

            if (exception is UnityBridgeCallException bridgeCallException)
            {
                return (bridgeCallException.Code, bridgeCallException.ErrorMessage, bridgeCallException.Details);
            }

            if (exception is ArgumentException)
            {
                return ("validation_error", exception.Message, null);
            }

            if (TryMapPrefixedError(exception.Message, "policy_denied:", "policy_denied", out var policyMessage))
            {
                return ("policy_denied", policyMessage, null);
            }

            if (TryMapPrefixedError(exception.Message, "validation_error:", "validation_error", out var validationMessage))
            {
                return ("validation_error", validationMessage, null);
            }

            if (TryMapPrefixedError(exception.Message, "target_not_found:", "target_not_found", out var targetMessage))
            {
                return ("target_not_found", targetMessage, null);
            }

            if (TryMapPrefixedError(exception.Message, "snapshot_failed:", "snapshot_failed", out var snapshotMessage))
            {
                return ("snapshot_failed", snapshotMessage, null);
            }

            if (TryMapPrefixedError(exception.Message, "rollback_unavailable:", "rollback_unavailable", out _))
            {
                return ("policy_denied", SandboxPolicyContract.RollbackUnavailableReason, null);
            }

            return ("bridge_transport_error", exception.Message, null);
        }

        private static bool TryMapPrefixedError(
            string message,
            string prefix,
            string errorCode,
            out string normalizedMessage)
        {
            normalizedMessage = string.Empty;

            if (string.IsNullOrWhiteSpace(message)
                || !message.StartsWith(prefix, StringComparison.Ordinal))
            {
                return false;
            }

            normalizedMessage = message.Substring(prefix.Length).Trim();

            if (string.IsNullOrWhiteSpace(normalizedMessage))
            {
                normalizedMessage = errorCode;
            }

            return true;
        }

        private static void Stop()
        {
            while (PendingInvocations.TryDequeue(out var pendingInvocation))
            {
                pendingInvocation.Completion.TrySetCanceled();
            }

            _listenerCancellation?.Cancel();

            try
            {
                _listener?.Stop();
                _listener?.Close();
            }
            catch
            {
            }

            try
            {
                _listenerTask?.Wait(TimeSpan.FromSeconds(1));
            }
            catch
            {
            }

            _listenerTask = null;
            _listener = null;
            _listenerCancellation?.Dispose();
            _listenerCancellation = null;

            if (!string.IsNullOrWhiteSpace(SessionBootstrapFilePath) && File.Exists(SessionBootstrapFilePath))
            {
                File.Delete(SessionBootstrapFilePath);
            }

            EndpointUrl = string.Empty;
            SessionToken = string.Empty;
        }

        private static string ResolveBootstrapFilePath()
        {
            var configuredPath = Environment.GetEnvironmentVariable(SessionBootstrapFileEnvironmentVariable);

            if (!string.IsNullOrWhiteSpace(configuredPath))
            {
                return configuredPath.Trim();
            }

            return Path.Combine(Path.GetTempPath(), DefaultBootstrapDirectory, DefaultBootstrapFileName);
        }

        private static void WriteBootstrapManifest(string bootstrapFilePath, string endpointUrl, string sessionToken)
        {
            var directoryPath = Path.GetDirectoryName(bootstrapFilePath);

            if (!string.IsNullOrWhiteSpace(directoryPath))
            {
                Directory.CreateDirectory(directoryPath);
            }

            var bootstrap = new LocalBridgeSessionBootstrap
            {
                ProtocolVersion = LocalBridgeProtocol.Version,
                Transport = "local_http",
                EndpointUrl = endpointUrl,
                SessionToken = sessionToken,
                IssuedAt = DateTime.UtcNow.ToString("O"),
                OwnerProcessId = DiagnosticsProcess.GetCurrentProcess().Id
            };

            File.WriteAllText(bootstrapFilePath, JsonConvert.SerializeObject(bootstrap));
        }

        private static string CreateSessionToken()
        {
            return $"{Guid.NewGuid():N}{Guid.NewGuid():N}";
        }

        private static int ReserveLoopbackPort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static void WriteJson(HttpListenerResponse response, int statusCode, object payload)
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";

            using var writer = new StreamWriter(response.OutputStream, Encoding.UTF8);
            writer.Write(JsonConvert.SerializeObject(payload));
            writer.Flush();
            response.Close();
        }

        private readonly struct PendingInvocation
        {
            public PendingInvocation(
                BridgeCallRequest request,
                TaskCompletionSource<BridgeCallResponse> completion,
                CancellationToken cancellationToken)
            {
                Request = request;
                Completion = completion;
                CancellationToken = cancellationToken;
            }

            public BridgeCallRequest Request { get; }

            public TaskCompletionSource<BridgeCallResponse> Completion { get; }

            public CancellationToken CancellationToken { get; }
        }
    }
}
#endif
