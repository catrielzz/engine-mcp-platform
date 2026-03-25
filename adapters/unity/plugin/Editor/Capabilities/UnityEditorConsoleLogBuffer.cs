#if UNITY_EDITOR
#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.Editor
{
    [InitializeOnLoad]
    public static class UnityEditorConsoleLogBuffer
    {
        private const int MaxEntries = 2000;
        private static readonly object Sync = new();
        private static readonly List<ConsoleEntryRecord> Entries = new();
        private static int _nextSequence;

        static UnityEditorConsoleLogBuffer()
        {
            Application.logMessageReceivedThreaded -= OnLogMessageReceived;
            Application.logMessageReceivedThreaded += OnLogMessageReceived;
        }

        public static ConsoleReadOutput Read(ConsoleReadInput? input)
        {
            var sinceSequence = Math.Max(0, input?.SinceSequence ?? 0);
            var allowedSeverities = NormalizeSeverityFilter(input?.Severities);
            var limit = Math.Clamp(input?.Limit ?? 100, 1, 500);

            lock (Sync)
            {
                var filtered = Entries
                    .Where((entry) => entry.Sequence > sinceSequence)
                    .Where((entry) => allowedSeverities == null || allowedSeverities.Contains(entry.Severity))
                    .ToList();

                var selected = filtered.Take(limit).ToArray();
                var nextSequence = selected.Length > 0
                    ? selected[^1].Sequence
                    : sinceSequence;

                return new ConsoleReadOutput
                {
                    Entries = selected
                        .Select((entry) => new ConsoleEntryOutput
                        {
                            Severity = entry.Severity,
                            Message = entry.Message,
                            Channel = entry.Channel,
                            Source = entry.Source,
                            Sequence = entry.Sequence,
                            Timestamp = entry.Timestamp
                        })
                        .ToArray(),
                    NextSequence = nextSequence,
                    Truncated = filtered.Count > selected.Length
                };
            }
        }

        public static void ResetForTests()
        {
            lock (Sync)
            {
                Entries.Clear();
                _nextSequence = 0;
            }

            Debug.ClearDeveloperConsole();
        }

        public static int GetLatestSequenceForTests()
        {
            lock (Sync)
            {
                return _nextSequence;
            }
        }

        private static void OnLogMessageReceived(string message, string stackTrace, LogType type)
        {
            lock (Sync)
            {
                var sequence = ++_nextSequence;
                Entries.Add(new ConsoleEntryRecord
                {
                    Severity = MapSeverity(type),
                    Message = message,
                    Channel = "unity",
                    Source = "editor",
                    Sequence = sequence,
                    Timestamp = DateTime.UtcNow.ToString("O")
                });

                if (Entries.Count > MaxEntries)
                {
                    Entries.RemoveRange(0, Entries.Count - MaxEntries);
                }
            }
        }

        private static HashSet<string>? NormalizeSeverityFilter(string[]? severities)
        {
            if (severities == null || severities.Length == 0)
            {
                return null;
            }

            var normalized = new HashSet<string>(StringComparer.Ordinal);

            foreach (var severity in severities)
            {
                if (!string.Equals(severity, "info", StringComparison.Ordinal)
                    && !string.Equals(severity, "warning", StringComparison.Ordinal)
                    && !string.Equals(severity, "error", StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        $"validation_error: unsupported console severity '{severity}'.");
                }

                normalized.Add(severity);
            }

            return normalized;
        }

        private static string MapSeverity(LogType logType)
        {
            return logType switch
            {
                LogType.Warning => "warning",
                LogType.Assert => "error",
                LogType.Error => "error",
                LogType.Exception => "error",
                _ => "info"
            };
        }

        private sealed class ConsoleEntryRecord
        {
            public string Severity { get; set; } = "info";

            public string Message { get; set; } = string.Empty;

            public string Channel { get; set; } = "unity";

            public string Source { get; set; } = "editor";

            public int Sequence { get; set; }

            public string Timestamp { get; set; } = string.Empty;
        }
    }
}
#endif
