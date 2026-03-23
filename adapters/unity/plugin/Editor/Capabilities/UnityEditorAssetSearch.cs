#if UNITY_EDITOR
#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnityEditorAssetSearch
    {
        internal static AssetSearchOutput Execute(AssetSearchInput? input)
        {
            var query = input?.Query?.Trim();
            var roots = (input?.Roots ?? Array.Empty<string>())
                .Where((root) => !string.IsNullOrWhiteSpace(root))
                .Select(NormalizePath)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            var kinds = (input?.Kinds ?? Array.Empty<string>())
                .Where((kind) => !string.IsNullOrWhiteSpace(kind))
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            var limit = input?.Limit ?? 50;

            if (limit < 1 || limit > 200)
            {
                throw new InvalidOperationException("validation_error: asset.search limit must be between 1 and 200.");
            }

            if (string.IsNullOrWhiteSpace(query) && roots.Length == 0 && kinds.Length == 0)
            {
                throw new InvalidOperationException(
                    "validation_error: asset.search requires query, roots, or kinds.");
            }

            var searchFolders = roots.Where(AssetDatabase.IsValidFolder).ToArray();
            var assetGuids = searchFolders.Length > 0
                ? AssetDatabase.FindAssets(query ?? string.Empty, searchFolders)
                : AssetDatabase.FindAssets(query ?? string.Empty);
            var results = new List<AssetRecordOutput>();

            foreach (var assetGuid in assetGuids)
            {
                var assetPath = NormalizePath(AssetDatabase.GUIDToAssetPath(assetGuid));

                if (string.IsNullOrWhiteSpace(assetPath))
                {
                    continue;
                }

                if (roots.Length > 0 && !MatchesRoots(assetPath, roots))
                {
                    continue;
                }

                var assetType = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
                var kind = ResolveKind(assetPath, assetType);

                if (kinds.Length > 0 && !kinds.Contains(kind, StringComparer.Ordinal))
                {
                    continue;
                }

                results.Add(new AssetRecordOutput
                {
                    AssetGuid = AssetDatabase.AssetPathToGUID(assetPath),
                    AssetPath = assetPath,
                    DisplayName = Path.GetFileNameWithoutExtension(assetPath),
                    Kind = kind
                });
            }

            var total = results.Count;

            return new AssetSearchOutput
            {
                Results = results.Take(limit).ToArray(),
                Total = total,
                Truncated = total > limit
            };
        }

        private static bool MatchesRoots(string assetPath, IReadOnlyList<string> roots)
        {
            foreach (var root in roots)
            {
                if (string.Equals(assetPath, root, StringComparison.Ordinal))
                {
                    return true;
                }

                if (assetPath.StartsWith($"{root}/", StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static string ResolveKind(string assetPath, Type? assetType)
        {
            if (string.Equals(Path.GetExtension(assetPath), ".unity", StringComparison.OrdinalIgnoreCase)
                || assetType == typeof(SceneAsset))
            {
                return "scene";
            }

            if (string.Equals(Path.GetExtension(assetPath), ".prefab", StringComparison.OrdinalIgnoreCase))
            {
                return "prefab";
            }

            if (string.Equals(Path.GetExtension(assetPath), ".cs", StringComparison.OrdinalIgnoreCase)
                || assetType == typeof(MonoScript))
            {
                return "script";
            }

            if (string.Equals(Path.GetExtension(assetPath), ".mat", StringComparison.OrdinalIgnoreCase)
                || assetType == typeof(Material))
            {
                return "material";
            }

            if (string.Equals(Path.GetExtension(assetPath), ".shader", StringComparison.OrdinalIgnoreCase)
                || assetType == typeof(Shader))
            {
                return "shader";
            }

            if (assetType != null && typeof(Texture).IsAssignableFrom(assetType))
            {
                return "texture";
            }

            return "other";
        }

        private static string NormalizePath(string path)
        {
            return path.Replace('\\', '/');
        }
    }
}
#endif
