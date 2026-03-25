using System;
using System.Threading;
using System.Threading.Tasks;
using EngineMcp.Unity.Plugin.Protocol;

namespace EngineMcp.Unity.Plugin.Client
{
    public sealed class UnityBridgeClient
    {
        private readonly IUnityBridgeTransport _transport;

        public UnityBridgeClient(IUnityBridgeTransport transport)
        {
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        }

        public async Task<BridgeCallResponse> CallAsync(
            BridgeCallRequest request,
            CancellationToken cancellationToken = default)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            if (string.Equals(request.RequestType, LocalBridgeProtocol.RequestTypeResourceRead, StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(request.Uri))
                {
                    throw new ArgumentException("URI is required for resource.read requests.", nameof(request));
                }
            }
            else if (string.IsNullOrWhiteSpace(request.Capability))
            {
                throw new ArgumentException("Capability is required.", nameof(request));
            }

            var requestJson = LocalBridgeJson.Serialize(request);
            var responseJson = await _transport.SendAsync(requestJson, cancellationToken).ConfigureAwait(false);
            var response = LocalBridgeJson.Deserialize<BridgeCallResponse>(responseJson);

            if (response == null)
            {
                throw new InvalidOperationException("Bridge transport returned an empty response.");
            }

            if (!string.Equals(response.RequestId, request.RequestId, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Bridge response requestId does not match the original request.");
            }

            if (!string.Equals(response.ProtocolVersion, request.ProtocolVersion, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Bridge response protocolVersion does not match the request.");
            }

            return response;
        }
    }
}
