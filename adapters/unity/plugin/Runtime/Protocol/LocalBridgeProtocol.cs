#nullable enable
using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace EngineMcp.Unity.Plugin.Protocol
{
    public static class LocalBridgeProtocol
    {
        public const string Version = "0.1.0";
        public const string RequestTypeCall = "call";
        public const string RequestTypeResourceRead = "resource.read";
        public const string DiscoveryResourceMimeType = "application/vnd.engine-mcp.discovery+json";
        public const string SnapshotIndexResourceUri = "engine://discovery/snapshot-index";
        public const string TestCatalogResourceUri = "engine://discovery/test-catalog";
    }

    [Serializable]
    public sealed class BridgeCallRequest
    {
        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; } = LocalBridgeProtocol.Version;

        [JsonProperty("requestId")]
        public string RequestId { get; set; } = Guid.NewGuid().ToString("N");

        [JsonProperty("requestType")]
        public string RequestType { get; set; } = LocalBridgeProtocol.RequestTypeCall;

        [JsonProperty("capability")]
        public string Capability { get; set; } = string.Empty;

        [JsonProperty("sessionScope")]
        public string SessionScope { get; set; } = "inspect";

        [JsonProperty("uri")]
        public string Uri { get; set; } = string.Empty;

        [JsonProperty("payload")]
        public JToken Payload { get; set; } = JValue.CreateNull();
    }

    [Serializable]
    public sealed class BridgeCallResponse
    {
        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; } = LocalBridgeProtocol.Version;

        [JsonProperty("requestId")]
        public string RequestId { get; set; } = string.Empty;

        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("payload")]
        public JToken Payload { get; set; } = JValue.CreateNull();

        [JsonProperty("snapshotId")]
        public string? SnapshotId { get; set; }

        [JsonProperty("error")]
        public BridgeCallError? Error { get; set; }
    }

    [Serializable]
    public sealed class BridgeCallError
    {
        [JsonProperty("code")]
        public string Code { get; set; } = string.Empty;

        [JsonProperty("message")]
        public string Message { get; set; } = string.Empty;

        [JsonProperty("details")]
        public JToken? Details { get; set; }
    }

    [Serializable]
    public sealed class BridgeResourceContent
    {
        [JsonProperty("uri")]
        public string Uri { get; set; } = string.Empty;

        [JsonProperty("mimeType")]
        public string MimeType { get; set; } = string.Empty;

        [JsonProperty("text")]
        public string Text { get; set; } = string.Empty;
    }
}
#nullable restore
