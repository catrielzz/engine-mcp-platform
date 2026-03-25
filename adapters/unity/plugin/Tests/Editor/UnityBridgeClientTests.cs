#if UNITY_EDITOR
using System;
using System.Threading;
using System.Threading.Tasks;
using EngineMcp.Unity.Plugin.Client;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace EngineMcp.Unity.Plugin.Tests.Editor
{
    public class UnityBridgeClientTests
    {
        [Test]
        public async Task CallAsync_ShouldRoundTripJsonPayload_AndPreserveRequestMetadata()
        {
            var transport = new CapturingTransport(requestJson =>
            {
                var request = JObject.Parse(requestJson);

                Assert.That(request["requestId"]?.Value<string>(), Is.EqualTo("req-002"));
                Assert.That(request["protocolVersion"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.Version));
                Assert.That(request["payload"]?["target"]?["logicalName"]?.Value<string>(), Is.EqualTo("SandboxRoot/MCP_E2E__Cube"));

                return @"{
  ""protocolVersion"": ""0.1.0"",
  ""requestId"": ""req-002"",
  ""success"": true,
  ""payload"": {
    ""deleted"": true
  },
  ""snapshotId"": ""snapshot-0001""
}";
            });
            var client = new UnityBridgeClient(transport);

            var response = await client.CallAsync(new BridgeCallRequest
            {
                RequestId = "req-002",
                Capability = "scene.object.delete",
                SessionScope = "dangerous_write",
                Payload = JObject.FromObject(new
                {
                    target = new
                    {
                        logicalName = "SandboxRoot/MCP_E2E__Cube"
                    }
                })
            });

            Assert.That(response.Success, Is.True);
            Assert.That(response.SnapshotId, Is.EqualTo("snapshot-0001"));
            Assert.That(response.Payload?["deleted"]?.Value<bool>(), Is.True);
        }

        [Test]
        public void CallAsync_ShouldRejectMismatchedProtocolVersion()
        {
            var transport = new CapturingTransport(_ => @"{
  ""protocolVersion"": ""9.9.9"",
  ""requestId"": ""req-003"",
  ""success"": true,
  ""payload"": {}
}");
            var client = new UnityBridgeClient(transport);

            var exception = Assert.ThrowsAsync<InvalidOperationException>(async () =>
                await client.CallAsync(new BridgeCallRequest
                {
                    RequestId = "req-003",
                    Capability = "editor.state.read",
                    Payload = new JObject()
                }));

            Assert.That(exception!.Message, Does.Contain("protocolVersion"));
        }

        [Test]
        public async Task CallAsync_ShouldSupportExplicitResourceReadRequests()
        {
            var transport = new CapturingTransport(requestJson =>
            {
                var request = JObject.Parse(requestJson);

                Assert.That(request["requestType"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.RequestTypeResourceRead));
                Assert.That(request["uri"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.SnapshotIndexResourceUri));

                return @"{
  ""protocolVersion"": ""0.1.0"",
  ""requestId"": ""req-resource-002"",
  ""success"": true,
  ""payload"": {
    ""uri"": ""engine://discovery/snapshot-index"",
    ""mimeType"": ""application/vnd.engine-mcp.discovery+json"",
    ""text"": ""{\""adapterId\"":\""unity-plugin-local-http\"",\""snapshots\"":[\""snapshot-001\""]}""
  }
}";
            });
            var client = new UnityBridgeClient(transport);

            var response = await client.CallAsync(new BridgeCallRequest
            {
                RequestId = "req-resource-002",
                RequestType = LocalBridgeProtocol.RequestTypeResourceRead,
                SessionScope = "inspect",
                Uri = LocalBridgeProtocol.SnapshotIndexResourceUri
            });

            Assert.That(response.Success, Is.True);
            Assert.That(response.Payload?["uri"]?.Value<string>(), Is.EqualTo(LocalBridgeProtocol.SnapshotIndexResourceUri));
        }

        private sealed class CapturingTransport : IUnityBridgeTransport
        {
            private readonly Func<string, string> _responseFactory;

            public CapturingTransport(Func<string, string> responseFactory)
            {
                _responseFactory = responseFactory;
            }

            public Task<string> SendAsync(string requestJson, CancellationToken cancellationToken = default)
            {
                return Task.FromResult(_responseFactory(requestJson));
            }
        }
    }
}
#endif
