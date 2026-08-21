using CommandWarfare.Core;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Semi-transparent overlays for N/S deploy wedges (2P).</summary>
    [RequireComponent(typeof(HexBoardBuilder))]
    public class DeployZoneVisualizer : MonoBehaviour
    {
        [SerializeField] bool _showSiegeBand = true;
        [SerializeField] Color _northColor = new(0.2f, 0.55f, 1f, 0.55f);
        [SerializeField] Color _southColor = new(0.95f, 0.3f, 0.22f, 0.55f);
        [SerializeField] Color _siegeColor = new(1f, 0.6f, 0.12f, 0.6f);

        HexBoardBuilder _board;
        Transform _overlayRoot;

        void Awake() => _board = GetComponent<HexBoardBuilder>();

        void OnEnable()
        {
            if (Application.isPlaying && _board != null)
                RebuildOverlay();
        }

        [ContextMenu("Rebuild Overlay")]
        public void RebuildOverlay()
        {
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            ClearChildrenNamed("DeployOverlay");

            _overlayRoot = new GameObject("DeployOverlay").transform;
            _overlayRoot.SetParent(transform, false);

            var size = _board.BoardSize;
            SpawnSeat(SeatId.N, _northColor, size);
            SpawnSeat(SeatId.S, _southColor, size);
        }

        void SpawnSeat(SeatId seat, Color zoneColor, int size)
        {
            var keys = DeployZone.WedgeKeys(seat, size);
            foreach (var key in keys)
            {
                var coord = HexMath.ParseKey(key);
                var isSiege = _showSiegeBand && DeployZone.InSiegeBand(seat, coord, size);
                SpawnOverlayHex(coord, isSiege ? _siegeColor : zoneColor, seat);
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

        void SpawnOverlayHex(HexCoord coord, Color color, SeatId seat)
        {
            var go = new GameObject($"Deploy_{seat}_{coord.Col}_{coord.Row}");
            go.transform.SetParent(_overlayRoot, false);
            go.transform.localPosition = HexMath.OddRToWorld(coord.Col, coord.Row, _board.HexSize)
                                         + Vector3.up * 0.35f;

            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = HexMeshBuilder.CreatePrism(_board.HexSize * 0.94f, 0.1f);
            renderer.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(
                color, null, 1f, 0.05f, 0f, color * 1.2f);
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            // Never block board clicks.
            var col = go.GetComponent<Collider>();
            if (col != null) Destroy(col);
        }
    }
}
