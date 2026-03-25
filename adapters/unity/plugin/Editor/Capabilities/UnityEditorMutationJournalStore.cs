#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnityEditorMutationJournalStore
    {
        internal static void AppendEntry(
            string operation,
            string snapshotId,
            string targetLogicalName,
            string scenePath,
            string outcome)
        {
            if (string.IsNullOrWhiteSpace(operation))
            {
                throw new ArgumentException("Journal operation must be non-empty.", nameof(operation));
            }

            var entry = new MutationJournalEntry
            {
                EntryId = Guid.NewGuid().ToString("N"),
                OccurredAt = DateTime.UtcNow.ToString("O"),
                Operation = operation.Trim(),
                SnapshotId = string.IsNullOrWhiteSpace(snapshotId) ? null : snapshotId.Trim(),
                TargetLogicalName = string.IsNullOrWhiteSpace(targetLogicalName) ? null : targetLogicalName.Trim(),
                ScenePath = string.IsNullOrWhiteSpace(scenePath) ? null : scenePath.Trim(),
                Outcome = string.IsNullOrWhiteSpace(outcome) ? "recorded" : outcome.Trim()
            };

            var journalDirectoryPath = GetJournalDirectoryPath();
            var fileName = $"{DateTime.UtcNow:yyyyMMddTHHmmssfffZ}-{SanitizeFileFragment(entry.Operation)}-{entry.EntryId}.json";
            var filePath = Path.Combine(journalDirectoryPath, fileName);
            WriteJsonAtomically(filePath, JsonConvert.SerializeObject(entry));
        }

        internal static void ResetForTests()
        {
            var journalDirectoryPath = GetJournalDirectoryPath();

            if (Directory.Exists(journalDirectoryPath))
            {
                Directory.Delete(journalDirectoryPath, true);
            }
        }

        private static string GetJournalDirectoryPath()
        {
            return Path.Combine(GetProjectRootPath(), "Library", "EngineMcp", "Journal");
        }

        private static string GetProjectRootPath()
        {
            var projectRootPath = Directory.GetParent(Application.dataPath)?.FullName;

            if (string.IsNullOrWhiteSpace(projectRootPath))
            {
                throw new InvalidOperationException("Could not resolve the Unity project root.");
            }

            return projectRootPath;
        }

        private static void WriteJsonAtomically(string filePath, string json)
        {
            var directoryPath = Path.GetDirectoryName(filePath) ?? GetProjectRootPath();
            Directory.CreateDirectory(directoryPath);

            var temporaryPath = $"{filePath}.{Guid.NewGuid():N}.tmp";

            try
            {
                File.WriteAllText(temporaryPath, json);

                if (File.Exists(filePath))
                {
                    File.Replace(temporaryPath, filePath, null);
                }
                else
                {
                    File.Move(temporaryPath, filePath);
                }
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
        }

        private static string SanitizeFileFragment(string value)
        {
            var sanitized = value
                .Replace('/', '_')
                .Replace('\\', '_')
                .Replace(' ', '_')
                .Replace('.', '_');

            return string.IsNullOrWhiteSpace(sanitized) ? "mutation" : sanitized;
        }

        [Serializable]
        private sealed class MutationJournalEntry
        {
            public string EntryId { get; set; }

            public string OccurredAt { get; set; }

            public string Operation { get; set; }

            public string SnapshotId { get; set; }

            public string TargetLogicalName { get; set; }

            public string ScenePath { get; set; }

            public string Outcome { get; set; }
        }
    }
}
#endif
