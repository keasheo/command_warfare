using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Gold overlay on objective-zone hexes.</summary>
    [RequireComponent(typeof(HexBoardBuilder))]
    public class ObjectiveVisualizer : MonoBehaviour
    {
        [SerializeField] Color _neutral = new(0.95f, 0.82f, 0.25f, 0.45f);
        [SerializeField] Color _north = new(0.3f, 0.55f, 0.95f, 0.5f);
        [SerializeField] Color _south = new(0.85f, 0.35f, 0.25f, 0.5f);

        HexBoardBuilder _board;
        Transform _overlayRoot;
        BoardGameController _game;

        void Awake()
        {
            _board = GetComponent<HexBoardBuilder>();
            _game = GetComponent<BoardGameController>();
        }

        void OnEnable()
        {
            if (_game != null) _game.TurnChanged += Rebuild;
            // Rebuild when shown again after menu (Start alone misses ForceSelect→Deploy).
            if (Application.isPlaying) Rebuild();
        }

        void OnDisable()
        {
            if (_game != null) _game.TurnChanged -= Rebuild;
        }

        void Start() => Rebuild();

        public void Rebuild()
        {
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            ClearChildrenNamed("ObjectiveOverlay");
            _overlayRoot = null;

            var state = _game != null ? _game.State : null;
            if (state?.Objectives == null || state.Objectives.Count == 0) return;

            _overlayRoot = new GameObject("ObjectiveOverlay").transform;
            _overlayRoot.SetParent(transform, false);

            foreach (var obj in state.Objectives)
            {
                var color = obj.Controller switch
                {
                    SeatId.N => _north,
                    SeatId.S => _south,
                    _ => _neutral,
                };
                foreach (var hex in ObjectiveSystem.ZoneHexes(obj))
                {
                    if (!HexMath.InBounds(hex, state.BoardSize)) continue;
                    SpawnOverlayHex(hex, color);
                }
            }
        }

        void ClearChildrenNamed(string childName)
        {
            var doomed = new System.Collections.Generic.List<GameObject>();
            for (var i = 0; i < transform.childCount; i++)
            {
                var child = transform.GetChild(i);
                if (child != null && child.name == childName)
                    doomed.Add(child.gameObject);
            }
            foreach (var go in doomed)
            {
                if (Application.isPlaying) Destroy(go);
                else DestroyImmediate(go);
            }
        }

        void SpawnOverlayHex(HexCoord coord, Color color)
        {
            var go = new GameObject($"Obj_{coord.Col}_{coord.Row}");
            go.transform.SetParent(_overlayRoot, false);
            go.transform.localPosition = HexMath.OddRToWorld(coord.Col, coord.Row, _board.HexSize)
                                         + Vector3.up * 0.4f;
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = HexMeshBuilder.CreatePrism(_board.HexSize * 0.9f, 0.1f);
            renderer.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(
                color, null, 1f, 0.05f, 0f, color * 1.1f);
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var col = go.GetComponent<Collider>();
            if (col != null) Destroy(col);
        }
    }
}
