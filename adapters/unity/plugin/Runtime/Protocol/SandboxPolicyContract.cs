#if UNITY_EDITOR
using Newtonsoft.Json.Linq;

namespace EngineMcp.Unity.Plugin.Protocol
{
    public static class SandboxPolicyContract
    {
        public const string TargetOutsideSandboxReason = "target_outside_sandbox";
        public const string SnapshotRequiredReason = "snapshot_required";
        public const string RollbackUnavailableReason = "rollback_unavailable";
        public const string ScenePathRule = "scene_path";
        public const string ObjectNamespaceRule = "object_namespace";
        public const string SandboxRootImmutableRule = "sandbox_root_immutable";

        public static JObject CreateTargetOutsideSandboxDetails(
            string rule,
            string targetLogicalName = null,
            string targetDisplayName = null,
            string scenePath = null,
            string expectedScenePath = null)
        {
            var details = new JObject
            {
                ["rule"] = rule
            };

            if (!string.IsNullOrWhiteSpace(targetLogicalName))
            {
                details["targetLogicalName"] = targetLogicalName;
            }

            if (!string.IsNullOrWhiteSpace(targetDisplayName))
            {
                details["targetDisplayName"] = targetDisplayName;
            }

            if (!string.IsNullOrWhiteSpace(scenePath))
            {
                details["scenePath"] = scenePath;
            }

            if (!string.IsNullOrWhiteSpace(expectedScenePath))
            {
                details["expectedScenePath"] = expectedScenePath;
            }

            return details;
        }

        public static JObject CreateSnapshotAvailabilityDetails(
            string capability,
            string targetLogicalName = null,
            string snapshotId = null)
        {
            var details = new JObject
            {
                ["capability"] = capability
            };

            if (!string.IsNullOrWhiteSpace(targetLogicalName))
            {
                details["targetLogicalName"] = targetLogicalName;
            }

            if (!string.IsNullOrWhiteSpace(snapshotId))
            {
                details["snapshotId"] = snapshotId;
            }

            return details;
        }
    }
}
#endif
