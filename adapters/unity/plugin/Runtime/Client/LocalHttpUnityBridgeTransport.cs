using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine.Networking;

namespace EngineMcp.Unity.Plugin.Client
{
    public sealed class LocalHttpUnityBridgeTransport : IUnityBridgeTransport
    {
        public const string SessionTokenHeaderName = "x-engine-mcp-session-token";

        private readonly string _endpointUrl;
        private readonly string _sessionToken;

        public LocalHttpUnityBridgeTransport(string endpointUrl, string sessionToken)
        {
            if (!Uri.TryCreate(endpointUrl, UriKind.Absolute, out var endpointUri))
            {
                throw new ArgumentException("Endpoint URL must be a valid absolute URI.", nameof(endpointUrl));
            }

            if (!endpointUri.IsLoopback)
            {
                throw new ArgumentException("Endpoint URL must target a loopback address.", nameof(endpointUrl));
            }

            if (!string.Equals(endpointUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("Endpoint URL must use http.", nameof(endpointUrl));
            }

            if (string.IsNullOrWhiteSpace(sessionToken))
            {
                throw new ArgumentException("Session token is required.", nameof(sessionToken));
            }

            _endpointUrl = endpointUri.ToString();
            _sessionToken = sessionToken;
        }

        public async Task<string> SendAsync(string requestJson, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(requestJson))
            {
                throw new ArgumentException("Request JSON is required.", nameof(requestJson));
            }

            using var request = new UnityWebRequest(_endpointUrl, UnityWebRequest.kHttpVerbPOST);
            var payloadBytes = Encoding.UTF8.GetBytes(requestJson);

            request.uploadHandler = new UploadHandlerRaw(payloadBytes);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader(SessionTokenHeaderName, _sessionToken);

            using var cancellationRegistration = cancellationToken.Register(request.Abort);
            var operation = request.SendWebRequest();

            while (!operation.isDone)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
            }

            cancellationToken.ThrowIfCancellationRequested();

            var responseText = request.downloadHandler?.text ?? string.Empty;

            if (request.responseCode < 200 || request.responseCode >= 300)
            {
                throw new InvalidOperationException(
                    $"Bridge HTTP call failed with status {request.responseCode}: {responseText}");
            }

            if (request.result == UnityWebRequest.Result.ConnectionError
                || request.result == UnityWebRequest.Result.DataProcessingError)
            {
                throw new InvalidOperationException(
                    $"Bridge HTTP transport failed: {request.error ?? "unknown transport error"}");
            }

            return responseText;
        }
    }
}
