using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Map;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Builds the odd-r hex grid with procedural terrain blocks.</summary>
    public class HexBoardBuilder : MonoBehaviour
    {
        [Header("Board")]
        [SerializeField] int _boardSize = GameConstants.BoardSize2P;
        [SerializeField] float _hexSize = 1.0f;
        [SerializeField] string _roomSeed = "dev";

        [Header("Prefabs")]
        [SerializeField] Material _terrainMaterial;
        [SerializeField] TerrainAssetCatalog _terrainCatalog;

        public int BoardSize => _boardSize;
        public float HexSize => _hexSize;
        public string RoomSeed => _roomSeed;

        public void SetRoomSeed(string roomSeed)
        {
            if (string.IsNullOrWhiteSpace(roomSeed)) return;
            _roomSeed = roomSeed.Trim();
        }

        Transform _tilesRoot;

        public event Action<HexTile> TileClicked;

        void Awake()
        {
            if (_terrainMaterial == null)
                _terrainMaterial = TerrainMaterialFactory.CreateDefault();
        }

        void Start()
        {
            // Title / menu flow owns when the board appears — do not auto-build in Start.
        }

        [ContextMenu("Rebuild Board")]
        public void Rebuild() => Rebuild(null);

        public void SetBattlefieldVisible(bool visible)
        {
            if (_tilesRoot != null)
                _tilesRoot.gameObject.SetActive(visible);
            for (var i = transform.childCount - 1; i >= 0; i--)
            {
                var child = transform.GetChild(i);
                if (child == null) continue;
                // Never leave old menu tableau props in the match scene.
                if (child.name is "MenuBackdrop3D" or "MenuBackdropBattlefield" or "MenuElements"
                    || child.name.StartsWith("BackdropHex"))
                {
                    if (Application.isPlaying) DestroyImmediate(child.gameObject);
                    else DestroyImmediate(child.gameObject);
                    continue;
                }
                if (child.name is "Tiles" or "BoardPerimeter" or "DeployOverlay" or "ObjectiveOverlay" or "UnitTokens"
                    or "DeployZones" or "Objectives" or "DeploymentZones")
                    child.gameObject.SetActive(visible);
            }
        }

        public void Rebuild(IReadOnlyDictionary<string, TerrainKind> terrainOverride)
        {
            if (_terrainMaterial == null)
                _terrainMaterial = TerrainMaterialFactory.CreateDefault();

            TerrainMaterialFactory.ClearTerrainCache();
            HexTile.ClearMeshCache();
            ClearChildrenNamed("Tiles");
            _tilesRoot = new GameObject("Tiles").transform;
            _tilesRoot.SetParent(transform, false);
            // Procedural board must not serialize into Battle.unity (that bloated/corrupted the scene).
            _tilesRoot.gameObject.hideFlags = HideFlags.DontSave;

            var terrainMap = terrainOverride != null && terrainOverride.Count > 0
                ? terrainOverride
                : RandomMapGenerator.GenerateRandomBiomeMap(
                    RandomMapGenerator.Options.For2P(_boardSize, _roomSeed));
            var mid = GameConstants.BoardMid(_boardSize);
            for (var row = 0; row < _boardSize; row++)
            {
                for (var col = 0; col < _boardSize; col++)
                {
                    var coord = new HexCoord(col, row);
                    var key = HexMath.Key(col, row);
                    var terrain = terrainMap.TryGetValue(key, out var kind)
                        ? kind
                        : SampleTerrain(col, row, mid);
                    var variant = TerrainVariant(_roomSeed, col, row);

                    var go = new GameObject($"Hex_{col}_{row}");
                    go.transform.SetParent(_tilesRoot, false);
                    var tile = go.AddComponent<HexTile>();
                    tile.Initialize(coord, terrain, variant, _hexSize, _terrainMaterial, _terrainCatalog);
                    var meshFilter = go.GetComponent<MeshFilter>();
                    if (meshFilter != null && meshFilter.sharedMesh != null)
                    {
                        var collider = go.AddComponent<MeshCollider>();
                        collider.sharedMesh = meshFilter.sharedMesh;
                    }
                    TerrainDetailScatter.Populate(tile, _hexSize, _roomSeed, tile.transform, _terrainCatalog);
                }
            }

            ApplyNeighborTransitions();
            ClearChildrenNamed("BoardPerimeter");
            BoardPerimeterSkirt.Build(transform, _boardSize, _hexSize);
            CenterBoard();
            BattleTabletopEnvironment.Ensure(_boardSize, _hexSize);
        }

        void ApplyNeighborTransitions()
        {
            if (_tilesRoot == null) return;
            // Neighbors() yields axial dirs in fixed order — map each edge wedge to that neighbor.
            for (var i = 0; i < _tilesRoot.childCount; i++)
            {
                var tile = _tilesRoot.GetChild(i).GetComponent<HexTile>();
                if (tile == null) continue;
                var edges = new TerrainKind[6];
                var ei = 0;
                foreach (var n in HexMath.Neighbors(tile.Coord))
                {
                    if (ei >= 6) break;
                    if (!HexMath.InBounds(n, _boardSize))
                    {
                        edges[ei++] = tile.Terrain;
                        continue;
                    }
                    var nt = _tilesRoot.Find($"Hex_{n.Col}_{n.Row}")?.GetComponent<HexTile>();
                    edges[ei++] = nt != null ? nt.Terrain : tile.Terrain;
                }
                while (ei < 6) edges[ei++] = tile.Terrain;

                // Apply visual edge blending (autotile overlays).
                tile.ApplyNeighborTransitions(edges, _terrainCatalog);

                // Scatter sparse neighbor-influenced props on the outer ring of the hex.
                // Creates density gradients: vegetation thins toward arid neighbors,
                // rocks/sand leak into lush biomes at borders.
                TerrainDetailScatter.PopulateEdgeTransitions(
                    tile, _hexSize, _roomSeed, edges, _terrainCatalog);
            }
        }

        void ClearChildrenNamed(string childName)
        {
            var doomed = new List<GameObject>();
            for (var i = 0; i < transform.childCount; i++)
            {
                var child = transform.GetChild(i);
                if (child != null && child.name == childName)
                    doomed.Add(child.gameObject);
            }
            foreach (var go in doomed)
                DestroyImmediate(go);
        }

        void CenterBoard()
        {
            var center = HexMath.OddRToWorld(
                GameConstants.BoardMid(_boardSize),
                GameConstants.BoardMid(_boardSize),
                _hexSize);
            transform.position = -center;
        }

        static int TerrainVariant(string roomSeed, int col, int row)
        {
            var h = HashString($"{roomSeed}:terrain3d:{col},{row}");
            return (int)(h % 5);
        }

        static uint HashString(string s)
        {
            uint h = 2166136261;
            foreach (var c in s)
            {
                h ^= c;
                h *= 16777619;
            }
            return h;
        }

        /// <summary>Simple dev terrain — banded biomes until random map port lands.</summary>
        static TerrainKind SampleTerrain(int col, int row, int mid)
        {
            var dist = Mathf.Abs(col - mid) + Mathf.Abs(row - mid);
            if (dist < 4) return TerrainKind.Plains;
            if (dist < 8) return TerrainKind.Forest;
            if ((col + row) % 11 == 0) return TerrainKind.Water;
            if (dist > 14) return TerrainKind.Mountains;
            if ((col * row) % 7 == 0) return TerrainKind.Desert;
            return TerrainKind.Plains;
        }

        public HexTile FindTile(int col, int row)
        {
            if (_tilesRoot == null) return null;
            var t = _tilesRoot.Find($"Hex_{col}_{row}");
            return t != null ? t.GetComponent<HexTile>() : null;
        }

        public void NotifyTileClicked(HexTile tile) => TileClicked?.Invoke(tile);
    }
}
