#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Compilation;

namespace EngineMcp.Unity.Plugin.Editor
{
    [InitializeOnLoad]
    internal static class UnityEditorScriptValidation
    {
        private static readonly object CompilationMessagesLock = new();
        private static readonly Dictionary<string, CompilerMessage[]> CompilationMessagesByAssembly =
            new(StringComparer.Ordinal);

        static UnityEditorScriptValidation()
        {
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
        }

        internal static ScriptValidateOutput Execute(ScriptValidateInput input)
        {
            var targetPath = ResolveTargetPath(input);
            var assemblyName = CompilationPipeline.GetAssemblyNameFromScriptPath(targetPath);

            if (string.IsNullOrWhiteSpace(assemblyName))
            {
                throw new InvalidOperationException("target_not_found: script assembly could not be resolved.");
            }

            var diagnostics = ReadDiagnosticsForAssembly(assemblyName, input.IncludeWarnings);

            return new ScriptValidateOutput
            {
                TargetPath = targetPath,
                IsValid = diagnostics.All((diagnostic) => !string.Equals(diagnostic.Severity, "error", StringComparison.Ordinal)),
                Diagnostics = diagnostics
            };
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] messages)
        {
            var assemblyName = Path.GetFileNameWithoutExtension(assemblyPath);

            if (string.IsNullOrWhiteSpace(assemblyName))
            {
                return;
            }

            lock (CompilationMessagesLock)
            {
                CompilationMessagesByAssembly[assemblyName] = messages ?? Array.Empty<CompilerMessage>();
            }
        }

        private static string ResolveTargetPath(ScriptValidateInput input)
        {
            if (input == null)
            {
                throw new ArgumentNullException(nameof(input));
            }

            var targetPath = !string.IsNullOrWhiteSpace(input.Path)
                ? input.Path.Trim()
                : ResolvePathFromGuid(input.AssetGuid);

            if (string.IsNullOrWhiteSpace(targetPath))
            {
                throw new ArgumentException("script.validate requires path or assetGuid.");
            }

            targetPath = NormalizePath(targetPath);

            if (AssetDatabase.LoadAssetAtPath<MonoScript>(targetPath) == null)
            {
                throw new InvalidOperationException("target_not_found: script asset could not be resolved.");
            }

            return targetPath;
        }

        private static string ResolvePathFromGuid(string assetGuid)
        {
            if (string.IsNullOrWhiteSpace(assetGuid))
            {
                return string.Empty;
            }

            return AssetDatabase.GUIDToAssetPath(assetGuid.Trim()) ?? string.Empty;
        }

        private static IReadOnlyList<DiagnosticRecord> ReadDiagnosticsForAssembly(string assemblyName, bool includeWarnings)
        {
            CompilerMessage[] messages;

            lock (CompilationMessagesLock)
            {
                CompilationMessagesByAssembly.TryGetValue(assemblyName, out messages);
            }

            messages ??= Array.Empty<CompilerMessage>();

            return messages
                .Where((message) => includeWarnings || message.type != CompilerMessageType.Warning)
                .Where((message) => message.type == CompilerMessageType.Error || message.type == CompilerMessageType.Warning)
                .Select(ToDiagnosticRecord)
                .ToArray();
        }

        private static DiagnosticRecord ToDiagnosticRecord(CompilerMessage message)
        {
            return new DiagnosticRecord
            {
                Severity = message.type == CompilerMessageType.Error ? "error" : "warning",
                Message = message.message ?? string.Empty,
                Path = string.IsNullOrWhiteSpace(message.file) ? null : NormalizePath(message.file),
                Line = message.line > 0 ? message.line : null,
                Column = message.column > 0 ? message.column : null
            };
        }

        private static string NormalizePath(string path)
        {
            return path.Replace('\\', '/');
        }

        private static void SeedCompilationMessagesForTests(string assemblyName, CompilerMessage[] messages)
        {
            if (string.IsNullOrWhiteSpace(assemblyName))
            {
                throw new ArgumentException("Assembly name is required for test seeding.", nameof(assemblyName));
            }

            lock (CompilationMessagesLock)
            {
                CompilationMessagesByAssembly[assemblyName] = messages ?? Array.Empty<CompilerMessage>();
            }
        }

        private static void ResetCompilationMessagesForTests()
        {
            lock (CompilationMessagesLock)
            {
                CompilationMessagesByAssembly.Clear();
            }
        }
    }
}
#endif
