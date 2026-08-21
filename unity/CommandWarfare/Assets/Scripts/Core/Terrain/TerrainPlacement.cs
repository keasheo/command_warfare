using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;

namespace CommandWarfare.Core.Terrain
{
    /// <summary>Port of play/shared/terrainPieces.ts — expand / validate / flood helpers.</summary>
    public static class TerrainPlacement
    {
        public const int WaterHexCap = 50;

        public static readonly TerrainKind[] FloodTerrainKinds =
        {
            TerrainKind.Plains, TerrainKind.Forest, TerrainKind.Swamp,
            TerrainKind.Desert, TerrainKind.Volcanic, TerrainKind.Mountains,
            TerrainKind.Water,
        };

        public struct AxialOffset
        {
            public int Q;
            public int R;
            public AxialOffset(int q, int r) { Q = q; R = r; }
        }

        public static bool MayCoverCommander(TerrainKind kind) =>
            kind is TerrainKind.Plains or TerrainKind.Forest or TerrainKind.Desert
                or TerrainKind.Swamp or TerrainKind.Volcanic or TerrainKind.Mountains;

        public static bool IsFloodKind(TerrainKind kind)
        {
            foreach (var k in FloodTerrainKinds)
                if (k == kind) return true;
            return false;
        }

        public static int NormalizeRotation(int rotation) => ((rotation % 6) + 6) % 6;

        public static List<HexCoord> ExpandTerrainPiece(
            HexCoord anchor,
            IReadOnlyList<AxialOffset> shape,
            int rotation)
        {
            var cells = new List<HexCoord>();
            if (shape == null || shape.Count == 0) return cells;
            var rot = NormalizeRotation(rotation);
            var origin = HexMath.OddRToAxial(anchor.Col, anchor.Row);
            foreach (var offset in shape)
            {
                var rotated = HexMath.RotateAxial(offset.Q, offset.R, rot);
                cells.Add(HexMath.AxialToOddR(origin.Q + rotated.Q, origin.R + rotated.R));
            }
            return cells;
        }

        public static int CountWaterHexes(Dictionary<string, TerrainKind> terrain)
        {
            if (terrain == null) return 0;
            var n = 0;
            foreach (var kv in terrain)
                if (kv.Value == TerrainKind.Water) n++;
            return n;
        }

        public static bool WaterPlacementAllowed(
            Dictionary<string, TerrainKind> terrain,
            int cap = WaterHexCap) =>
            CountWaterHexes(terrain) < cap;

        public static string ValidateTerrainPlacement(
            IReadOnlyList<HexCoord> cells,
            int boardSize,
            Dictionary<string, TerrainKind> terrain,
            HashSet<string> objectiveKeys,
            TerrainKind kind,
            HashSet<string> requiredKeys = null,
            HashSet<string> blockedKeys = null,
            bool allowOverwriteWater = false,
            int waterHexCap = WaterHexCap)
        {
            terrain ??= new Dictionary<string, TerrainKind>();
            objectiveKeys ??= new HashSet<string>();
            blockedKeys ??= new HashSet<string>();

            if (kind == TerrainKind.Water && !WaterPlacementAllowed(terrain, waterHexCap))
                return $"Water cap reached ({CountWaterHexes(terrain)}/{waterHexCap} hexes). No new water pieces.";

            var seen = new HashSet<string>();
            foreach (var cell in cells)
            {
                if (!HexMath.InBounds(cell, boardSize))
                    return "Piece goes off the board.";
                var key = HexMath.Key(cell.Col, cell.Row);
                if (!seen.Add(key)) continue;

                if (terrain.TryGetValue(key, out var existing))
                {
                    if (existing == kind)
                    {
                        // same-kind overlap OK
                    }
                    else if (allowOverwriteWater && existing == TerrainKind.Water &&
                             kind != TerrainKind.Water && kind != TerrainKind.Wall)
                    {
                        // small land bridge
                    }
                    else
                    {
                        return "Overlaps different terrain.";
                    }
                }

                if (blockedKeys.Contains(key))
                    return "Cannot place on a blocked hex.";
                if (requiredKeys != null && !requiredKeys.Contains(key))
                    return "Must place entirely inside your Command Radius.";
                if (objectiveKeys.Contains(key))
                    return "Cannot place on an objective.";
            }
            return null;
        }

        public static void FillEmptyHexesWithPlains(
            Dictionary<string, TerrainKind> terrain,
            int boardSize)
        {
            if (terrain == null) return;
            for (var row = 0; row < boardSize; row++)
            for (var col = 0; col < boardSize; col++)
            {
                var key = HexMath.Key(col, row);
                if (!terrain.ContainsKey(key))
                    terrain[key] = TerrainKind.Plains;
            }
        }

        public static HashSet<string> OwnCommandRadiusKeys(
            HexCoord? commander,
            int radius,
            int boardSize)
        {
            var keys = new HashSet<string>();
            if (!commander.HasValue) return keys;
            var origin = commander.Value;
            for (var col = 0; col < boardSize; col++)
            for (var row = 0; row < boardSize; row++)
            {
                var cell = new HexCoord(col, row);
                if (HexMath.Distance(origin, cell) <= radius)
                    keys.Add(HexMath.Key(col, row));
            }
            return keys;
        }

        /// <summary>Flood CR with one terrain kind. Returns error or null on success.</summary>
        public static string FloodCommandZone(
            Dictionary<string, TerrainKind> terrain,
            HexCoord commander,
            HashSet<string> ownCr,
            HashSet<string> objectiveKeys,
            TerrainKind kind)
        {
            if (!IsFloodKind(kind))
                return "That terrain type cannot flood a CR.";
            terrain ??= new Dictionary<string, TerrainKind>();
            objectiveKeys ??= new HashSet<string>();
            var commanderKey = HexMath.Key(commander.Col, commander.Row);

            foreach (var key in ownCr)
            {
                if (key == commanderKey && !MayCoverCommander(kind))
                    continue;
                if (objectiveKeys.Contains(key)) continue;
                if (terrain.TryGetValue(key, out var existing) && existing != kind)
                    return "Cannot flood over different terrain already in your CR.";
                terrain[key] = kind;
            }
            return null;
        }
    }
}
