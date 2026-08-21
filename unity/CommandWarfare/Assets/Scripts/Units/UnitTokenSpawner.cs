using System.Collections.Generic;
using System.Linq;
using CommandWarfare.Board;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>Places demo unit tokens in a seat deploy wedge for visual testing.</summary>
    [RequireComponent(typeof(HexBoardBuilder))]
    public class UnitTokenSpawner : MonoBehaviour
    {
        [SerializeField] SeatId _seat = SeatId.N;
        [SerializeField] bool _spawnOnStart = false;

        HexBoardBuilder _board;
        Transform _tokensRoot;

        void Awake() => _board = GetComponent<HexBoardBuilder>();

        void Start()
        {
            if (_spawnOnStart) SpawnDemoArmy();
        }

        [ContextMenu("Spawn Demo Army")]
        public void SpawnDemoArmy()
        {
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            if (_tokensRoot != null)
                DestroyImmediate(_tokensRoot.gameObject);

            _tokensRoot = new GameObject("UnitTokens").transform;
            _tokensRoot.SetParent(transform, false);

            var size = _board.BoardSize;
            var keys = DeployZone.WedgeKeys(_seat, size)
                .Select(HexMath.ParseKey)
                .Where(c => IsLand(c))
                .OrderBy(c => c.Row)
                .ThenBy(c => c.Col)
                .ToList();

            if (keys.Count == 0) return;

            var idx = 0;
            SpawnToken(keys[idx++], UnitKind.Commander, SeatColors.Label(_seat, UnitKind.Commander));
            for (var o = 0; o < 2 && idx < keys.Count; o++)
                SpawnToken(keys[idx++], UnitKind.Officer, "O");
            for (var u = 0; u < 6 && idx < keys.Count; u++)
                SpawnToken(keys[idx++], UnitKind.Unit, "U");
        }

        bool IsLand(HexCoord coord)
        {
            // Avoid water tiles — in dev, terrain is on HexTile children; fall back to row/col heuristic.
            var tile = FindTile(coord);
            return tile == null || tile.Terrain != TerrainKind.Water;
        }

        HexTile FindTile(HexCoord coord)
        {
            var tiles = transform.Find("Tiles");
            if (tiles == null) return null;
            var name = $"Hex_{coord.Col}_{coord.Row}";
            var t = tiles.Find(name);
            return t != null ? t.GetComponent<HexTile>() : null;
        }

        void SpawnToken(HexCoord coord, UnitKind kind, string label)
        {
            var tile = FindTile(coord);
            var height = tile != null ? TerrainVisuals.BlockHeight(tile.Terrain) : 0.72f;
            var world = transform.TransformPoint(
                HexMath.OddRToWorld(coord.Col, coord.Row, _board.HexSize)
                + Vector3.up * (height + 0.2f));

            var go = new GameObject($"Token_{label}_{coord.Col}_{coord.Row}");
            go.transform.SetParent(_tokensRoot, false);
            go.transform.position = world;
            var view = go.AddComponent<UnitTokenView>();
            view.Bind(label, SeatColors.Fill(_seat), kind);
        }
    }
}
