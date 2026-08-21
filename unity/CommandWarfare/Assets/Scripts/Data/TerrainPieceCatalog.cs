using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loaded from Assets/Data/terrain-pieces-unity.json (export:unity:terrain-pieces).</summary>
    [Serializable]
    public class TerrainPieceDef
    {
        public string id;
        public string name;
        public string kind;
        public string sizeClass;
        public AxialCell[] shape;

        public TerrainKind KindEnum => ParseKind(kind);
        public bool IsSmall => string.Equals(sizeClass, "small", StringComparison.OrdinalIgnoreCase);
        public bool IsMedium => string.Equals(sizeClass, "medium", StringComparison.OrdinalIgnoreCase);
        public bool IsLarge => string.Equals(sizeClass, "large", StringComparison.OrdinalIgnoreCase);

        public TerrainPlacement.AxialOffset[] ShapeOffsets()
        {
            if (shape == null || shape.Length == 0)
                return Array.Empty<TerrainPlacement.AxialOffset>();
            var arr = new TerrainPlacement.AxialOffset[shape.Length];
            for (var i = 0; i < shape.Length; i++)
                arr[i] = new TerrainPlacement.AxialOffset(shape[i].q, shape[i].r);
            return arr;
        }

        public static TerrainKind ParseKind(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return TerrainKind.Plains;
            return raw.ToLowerInvariant() switch
            {
                "forest" => TerrainKind.Forest,
                "swamp" => TerrainKind.Swamp,
                "desert" => TerrainKind.Desert,
                "water" => TerrainKind.Water,
                "wall" => TerrainKind.Wall,
                "volcanic" => TerrainKind.Volcanic,
                "mountains" => TerrainKind.Mountains,
                _ => TerrainKind.Plains,
            };
        }
    }

    [Serializable]
    public struct AxialCell
    {
        public int q;
        public int r;
    }

    [Serializable]
    public class TerrainPiecesFile
    {
        public int landDropsPerSize = 3;
        public TerrainPieceDef[] pieces;
        public TerrainPiecesBySize bySize;
    }

    [Serializable]
    public class TerrainPiecesBySize
    {
        public TerrainPieceDef[] large;
        public TerrainPieceDef[] medium;
        public TerrainPieceDef[] small;
    }

    public static class TerrainPieceCatalog
    {
        static TerrainPiecesFile _file;
        static readonly Dictionary<string, TerrainPieceDef> ById = new();

        public static int LandDropsPerSize =>
            _file != null && _file.landDropsPerSize > 0
                ? _file.landDropsPerSize
                : GameConstants.TerrainLandDropsPerSize;

        public static void LoadFromTextAsset(TextAsset asset)
        {
            if (asset == null || string.IsNullOrEmpty(asset.text)) return;
            LoadFromJson(asset.text);
        }

        public static void LoadFromJson(string json)
        {
            _file = JsonUtility.FromJson<TerrainPiecesFile>(json);
            ById.Clear();
            if (_file?.pieces == null) return;
            foreach (var p in _file.pieces)
            {
                if (p == null || string.IsNullOrEmpty(p.id)) continue;
                ById[p.id] = p;
            }
        }

        public static bool IsLoaded => ById.Count > 0;

        public static TerrainPieceDef Get(string id) =>
            !string.IsNullOrEmpty(id) && ById.TryGetValue(id, out var p) ? p : null;

        public static IReadOnlyList<TerrainPieceDef> ForSize(string sizeClass)
        {
            EnsureFallback();
            if (_file?.bySize != null)
            {
                var list = sizeClass?.ToLowerInvariant() switch
                {
                    "large" => _file.bySize.large,
                    "medium" => _file.bySize.medium,
                    "small" => _file.bySize.small,
                    _ => null,
                };
                if (list != null && list.Length > 0) return list;
            }
            return Array.Empty<TerrainPieceDef>();
        }

        /// <summary>Port of commandZonePieceCatalog — pieces allowed for CR quota.</summary>
        public static List<TerrainPieceDef> CommandZoneCatalog(int maxPlayers)
        {
            EnsureFallback();
            var quota = CommandZonePieceQuota.ForMaxPlayers(maxPlayers);
            var result = new List<TerrainPieceDef>();
            void AddFrom(string size, int allowed)
            {
                if (allowed <= 0) return;
                foreach (var p in ForSize(size))
                {
                    if (p == null) continue;
                    if (p.KindEnum == TerrainKind.Water && !p.IsSmall) continue;
                    result.Add(p);
                }
            }
            AddFrom("large", quota.Large);
            AddFrom("medium", quota.Medium);
            AddFrom("small", quota.Small);
            return result;
        }

        public static string QuotaLabel(int maxPlayers)
        {
            var q = CommandZonePieceQuota.ForMaxPlayers(maxPlayers);
            var parts = new List<string>();
            if (q.Large > 0) parts.Add($"{q.Large} large");
            if (q.Medium > 0) parts.Add($"{q.Medium} medium");
            parts.Add($"{q.Small} small");
            return string.Join(" + ", parts);
        }

        /// <summary>Built-in tiny catalog if JSON not loaded (edit-mode / missing asset).</summary>
        public static void EnsureFallback()
        {
            if (ById.Count > 0) return;
            var small = new[]
            {
                Fallback("plains-dot", "Clearing", "plains", "small", (0, 0)),
                Fallback("forest-pair", "Forest Pair", "forest", "small", (0, 0), (1, 0)),
                Fallback("forest-elbow-s", "Forest Elbow", "forest", "small", (0, 0), (1, 0), (0, 1)),
                Fallback("mountains-dot", "Peak", "mountains", "small", (0, 0)),
            };
            var medium = new[]
            {
                Fallback("forest-disk", "Forest Grove", "forest", "medium",
                    Disk(2)),
                Fallback("plains-ribbon", "Plains Ribbon", "plains", "medium",
                    Ribbon(5, 0)),
            };
            var large = new[]
            {
                Fallback("forest-mass", "Forest Mass", "forest", "large", Disk(3)),
                Fallback("mountains-mass", "Mountain Mass", "mountains", "large", Disk(3)),
            };
            _file = new TerrainPiecesFile
            {
                landDropsPerSize = GameConstants.TerrainLandDropsPerSize,
                pieces = Concat(large, medium, small),
                bySize = new TerrainPiecesBySize { large = large, medium = medium, small = small },
            };
            foreach (var p in _file.pieces)
                ById[p.id] = p;
        }

        static TerrainPieceDef[] Concat(params TerrainPieceDef[][] parts)
        {
            var n = 0;
            foreach (var p in parts) n += p.Length;
            var all = new TerrainPieceDef[n];
            var i = 0;
            foreach (var p in parts)
            foreach (var x in p)
                all[i++] = x;
            return all;
        }

        static TerrainPieceDef Fallback(
            string id, string name, string kind, string size, params (int q, int r)[] cells)
        {
            var shape = new AxialCell[cells.Length];
            for (var i = 0; i < cells.Length; i++)
                shape[i] = new AxialCell { q = cells[i].q, r = cells[i].r };
            return new TerrainPieceDef
            {
                id = id,
                name = name,
                kind = kind,
                sizeClass = size,
                shape = shape,
            };
        }

        static (int q, int r)[] Disk(int radius)
        {
            var list = new List<(int, int)>();
            for (var q = -radius; q <= radius; q++)
            {
                var rMin = Math.Max(-radius, -q - radius);
                var rMax = Math.Min(radius, -q + radius);
                for (var r = rMin; r <= rMax; r++)
                    list.Add((q, r));
            }
            return list.ToArray();
        }

        static (int q, int r)[] Ribbon(int length, int halfWidth)
        {
            var list = new List<(int, int)>();
            for (var q = 0; q < length; q++)
            for (var r = -halfWidth; r <= halfWidth; r++)
                list.Add((q, r));
            return list.ToArray();
        }
    }
}
