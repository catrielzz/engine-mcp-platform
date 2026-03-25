#if UNITY_EDITOR
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace EngineMcp.Unity.Plugin.Tests.Editor
{
    public class LocalBridgeProtocolTests
    {
        [Test]
        public void BridgeCallRequest_ShouldRoundTripPayload_WithNewtonsoftJson()
        {
            var request = new BridgeCallRequest
            {
                RequestId = "req-001",
                Capability = "scene.object.create",
                SessionScope = "sandbox_write",
                Payload = JObject.FromObject(new
                {
                    name = "MCP_E2E__Cube",
                    parent = new
                    {
                        logicalName = "SandboxRoot"
                    },
                    labels = new[] { "sandbox" }
                })
            };

            var json = JsonConvert.SerializeObject(request);
            var roundTrip = JsonConvert.DeserializeObject<BridgeCallRequest>(json);

            Assert.That(roundTrip, Is.Not.Null);
            Assert.That(roundTrip!.ProtocolVersion, Is.EqualTo(LocalBridgeProtocol.Version));
            Assert.That(roundTrip.Payload?["name"]?.Value<string>(), Is.EqualTo("MCP_E2E__Cube"));
            Assert.That(roundTrip.Payload?["parent"]?["logicalName"]?.Value<string>(), Is.EqualTo("SandboxRoot"));
            Assert.That(roundTrip.Payload?["labels"]?[0]?.Value<string>(), Is.EqualTo("sandbox"));
        }

        [Test]
        public void BridgeCallRequest_ShouldRoundTripExplicitResourceReadEnvelope()
        {
            var request = new BridgeCallRequest
            {
                RequestId = "req-resource-001",
                RequestType = LocalBridgeProtocol.RequestTypeResourceRead,
                SessionScope = "inspect",
                Uri = LocalBridgeProtocol.SnapshotIndexResourceUri
            };

            var json = JsonConvert.SerializeObject(request);
            var roundTrip = JsonConvert.DeserializeObject<BridgeCallRequest>(json);

            Assert.That(roundTrip, Is.Not.Null);
            Assert.That(roundTrip!.ProtocolVersion, Is.EqualTo(LocalBridgeProtocol.Version));
            Assert.That(roundTrip.RequestType, Is.EqualTo(LocalBridgeProtocol.RequestTypeResourceRead));
            Assert.That(roundTrip.Uri, Is.EqualTo(LocalBridgeProtocol.SnapshotIndexResourceUri));
        }

        [Test]
        public void LocalBridgeSessionBootstrap_ShouldDeserialize_FromJsonManifest()
        {
            const string json = @"{
  ""protocolVersion"": ""0.1.0"",
  ""transport"": ""local_http"",
  ""endpointUrl"": ""http://127.0.0.1:38123/bridge/call"",
  ""sessionToken"": ""test-token"",
  ""issuedAt"": ""2026-03-19T00:00:00.0000000Z"",
  ""ownerProcessId"": 12345
}";

            var bootstrap = JsonConvert.DeserializeObject<LocalBridgeSessionBootstrap>(json);

            Assert.That(bootstrap, Is.Not.Null);
            Assert.That(bootstrap!.Transport, Is.EqualTo("local_http"));
            Assert.That(bootstrap.EndpointUrl, Is.EqualTo("http://127.0.0.1:38123/bridge/call"));
            Assert.That(bootstrap.SessionToken, Is.EqualTo("test-token"));
            Assert.That(bootstrap.OwnerProcessId, Is.EqualTo(12345));
        }
    }
}
#endif
