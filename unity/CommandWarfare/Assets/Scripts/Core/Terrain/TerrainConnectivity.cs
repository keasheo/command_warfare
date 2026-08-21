using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;

namespace CommandWarfare.Core.Terrain
{
    /// <summary>Port of connectivity helpers from play/shared/terrainPieces.ts.</summary>
    public static class TerrainConnectivity
    {
        public static bool IsImpassable(TerrainKind? kind) =>
            kind is TerrainKind.Water or TerrainKind.Wall;

        public static HashSet<string> PassableReachableFrom(
            HexCoord origin,
            IReadOnlyDictionary<string, TerrainKind> terrain,
            int boardSize)
        {
            var startKey = HexMath.Key(origin.Col, origin.Row);
            var reachable = new HashSet<string>();
            if (terrain.TryGetValue(startKey, out var startKind) && IsImpassable(startKind))
                return reachable;

            var queue = new Queue<HexCoord>();
            queue.Enqueue(origin);
            reachable.Add(startKey);

            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                foreach (var n in HexMath.Neighbors(cur))
                {
                    if (!HexMath.InBounds(n, boardSize)) continue;
                    var nk = HexMath.Key(n.Col, n.Row);
                    if (reachable.Contains(nk)) continue;
                    // Missing hexes are implicit plains (sparse corner maps).
                    if (terrain.TryGetValue(nk, out var nkKind) && IsImpassable(nkKind)) continue;
                    reachable.Add(nk);
                    queue.Enqueue(n);
                }
            }
            return reachable;
        }

        public static bool SetupStayConnected(
            IReadOnlyList<HexCoord> commanders,
            IReadOnlyList<HexCoord> objectives,
            IReadOnlyDictionary<string, TerrainKind> terrain,
            int boardSize)
        {
            var anchors = new List<HexCoord>(commanders);
            anchors.AddRange(objectives);
            if (anchors.Count <= 1) return true;

            foreach (var a in anchors)
            {
                var key = HexMath.Key(a.Col, a.Row);
                if (terrain.TryGetValue(key, out var kind) && IsImpassable(kind))
                    return false;
            }

            var reachable = PassableReachableFrom(anchors[0], terrain, boardSize);
            for (var i = 1; i < anchors.Count; i++)
            {
                var key = HexMath.Key(anchors[i].Col, anchors[i].Row);
                if (!reachable.Contains(key)) return false;
            }
            return true;
        }

        public static bool CommanderHasEscapePath(
            HexCoord commander,
            IReadOnlyDictionary<string, TerrainKind> terrain,
            int boardSize,
            HashSet<string> ownCrKeys)
        {
            var startKey = HexMath.Key(commander.Col, commander.Row);
            if (terrain.TryGetValue(startKey, out var startKind) && IsImpassable(startKind))
                return false;

            var visited = new HashSet<string>();
            var queue = new Queue<HexCoord>();
            queue.Enqueue(commander);
            visited.Add(startKey);

            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                var curKey = HexMath.Key(cur.Col, cur.Row);
                if (!ownCrKeys.Contains(curKey)) return true;

                foreach (var n in HexMath.Neighbors(cur))
                {
                    if (!HexMath.InBounds(n, boardSize)) continue;
                    var nk = HexMath.Key(n.Col, n.Row);
                    if (visited.Contains(nk)) continue;
                    if (terrain.TryGetValue(nk, out var nkKind) && IsImpassable(nkKind)) continue;
                    visited.Add(nk);
                    queue.Enqueue(n);
                }
            }
            return false;
        }
    }
}
