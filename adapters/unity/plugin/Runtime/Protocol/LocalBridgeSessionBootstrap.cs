using System;
using Newtonsoft.Json;

namespace EngineMcp.Unity.Plugin.Protocol
{
    [Serializable]
    public sealed class LocalBridgeSessionBootstrap
    {
        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; } = LocalBridgeProtocol.Version;

        [JsonProperty("transport")]
        public string Transport { get; set; } = "local_http";

        [JsonProperty("endpointUrl")]
        public string EndpointUrl { get; set; } = string.Empty;

        [JsonProperty("sessionToken")]
        public string SessionToken { get; set; } = string.Empty;

        [JsonProperty("issuedAt")]
        public string IssuedAt { get; set; } = string.Empty;

        [JsonProperty("ownerProcessId")]
        public int OwnerProcessId { get; set; }
    }
}
