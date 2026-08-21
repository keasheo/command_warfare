using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class HexTile : MonoBehaviour
    {
        public HexCoord Coord { get; private set; }
        public TerrainKind Terrain { get; private set; }
        public int Variant { get; private set; }

        MeshRenderer _renderer;
        MeshFilter _filter;
        Color _baseColor;
        Material _mat;
        float _hexSize = 1.85f;
        float _blockHeight = 0.72f;
        HighlightKind _highlightKind = HighlightKind.None;
        Transform _highlight;
        MeshRenderer _highlightRenderer;
        Material _highlightMat;

        static readonly System.Collections.Generic.Dictionary<int, Mesh> PrismByHeightMm = new();

        static Mesh GetPrism(float hexSize, float height)
        {
            var key = Mathf.RoundToInt(height * 1000f);
            if (!PrismByHeightMm.TryGetValue(key, out var mesh))
            {
                mesh = HexMeshBuilder.CreatePrism(hexSize, height);
                PrismByHeightMm[key] = mesh;
            }
            return mesh;
        }

        public void Initialize(
            HexCoord coord,
            TerrainKind terrain,
            int variant,
            float hexSize,
            Material _,
            TerrainAssetCatalog catalog = null)
        {
            Coord = coord;
            Terrain = terrain;
            Variant = variant;
            _hexSize = hexSize;
            _baseColor = TerrainVisuals.BaseColor(terrain, variant);
            _blockHeight = TerrainVisuals.BlockHeight(terrain);
            transform.localPosition = HexMath.OddRToWorld(coord.Col, coord.Row, hexSize);

            EnsureComponents();

            _filter.sharedMesh = GetPrism(hexSize, _blockHeight);
            TerrainMaterialFactory.UvJitterForHex(coord.Col, coord.Row, out var uvOffset, out var uvRot);
            _mat = TerrainMaterialFactory.CreateForTerrain(terrain, variant, catalog, uvOffset, uvRot);
            _renderer.sharedMaterial = _mat;
            TerrainMaterialFactory.SetMaterialColor(_mat, _baseColor);

            if (terrain == TerrainKind.Wall)
                WallMeshBuilder.DressWallHex(transform, hexSize, _blockHeight, _baseColor);

            EnsureHexOutline();

            // Keep any prior overlay in sync after rebuild.
            if (_highlight != null)
                PositionHighlight();
        }

        /// <summary>Tilemap-style edge transitions from the six neighbor biomes (edge order = HexMath.Neighbors).</summary>
        public void ApplyNeighborTransitions(
            TerrainKind[] edgeNeighborKinds,
            TerrainAssetCatalog catalog)
        {
            HexTerrainAutotile.Apply(this, edgeNeighborKinds, _hexSize, catalog);
        }

        void EnsureHexOutline()
        {
            var existing = transform.Find("HexOutline");
            if (existing != null)
            {
                if (Application.isPlaying) Destroy(existing.gameObject);
                else DestroyImmediate(existing.gameObject);
            }

            var go = new GameObject("HexOutline");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = Vector3.zero;
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = HexMeshBuilder.CreateOutlineRing(_hexSize * 0.985f, _blockHeight + 0.028f, 0.028f);
            renderer.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(
                new Color(0.07f, 0.08f, 0.09f, 0.55f), null, 1f, 0.05f, 0f, Color.black);
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var col = go.GetComponent<Collider>();
            if (col != null) DestroyImmediate(col);
        }

        void EnsureComponents()
        {
            _filter = GetComponent<MeshFilter>();
            if (_filter == null)
                _filter = gameObject.AddComponent<MeshFilter>();

            _renderer = GetComponent<MeshRenderer>();
            if (_renderer == null)
                _renderer = gameObject.AddComponent<MeshRenderer>();
        }

        public void SetHighlight(HighlightKind kind)
        {
            _highlightKind = kind;
            if (kind == HighlightKind.None)
            {
                if (_highlight != null)
                    _highlight.gameObject.SetActive(false);
                return;
            }

            EnsureHighlightOverlay();
            _highlight.gameObject.SetActive(true);
            PositionHighlight();
            ApplyHighlightVisual(kind);
        }

        public void ClearHighlight()
        {
            _highlightKind = HighlightKind.None;
            if (_highlight != null)
                _highlight.gameObject.SetActive(false);
        }

        void EnsureHighlightOverlay()
        {
            if (_highlight != null) return;

            var go = new GameObject("Highlight");
            _highlight = go.transform;
            _highlight.SetParent(transform, false);

            var filter = go.AddComponent<MeshFilter>();
            _highlightRenderer = go.AddComponent<MeshRenderer>();
            // Thin hex prism floating above the block — not a material tint under scatter.
            filter.sharedMesh = HexMeshBuilder.CreatePrism(_hexSize * 0.98f, 0.06f);
            _highlightMat = TerrainMaterialFactory.CreateTileInstance(
                Color.white,
                null,
                1f,
                0.05f,
                0f,
                Color.white);
            _highlightRenderer.sharedMaterial = _highlightMat;
            _highlightRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _highlightRenderer.receiveShadows = false;

            var col = go.GetComponent<Collider>();
            if (col != null) DestroyImmediate(col);
        }

        void PositionHighlight()
        {
            if (_highlight == null) return;
            // Sit above the terrain block and typical detail scatter.
            _highlight.localPosition = new Vector3(0f, _blockHeight + 0.22f, 0f);
        }

        void ApplyHighlightVisual(HighlightKind kind)
        {
            if (_highlightMat == null) return;
            var (fill, glow) = kind switch
            {
                HighlightKind.Selected => (new Color(1f, 0.92f, 0.25f, 1f), new Color(1.4f, 1.1f, 0.2f)),
                HighlightKind.Move => (new Color(0.15f, 1f, 0.55f, 1f), new Color(0.1f, 1.6f, 0.5f)),
                HighlightKind.Attack => (new Color(1f, 0.22f, 0.18f, 1f), new Color(1.6f, 0.2f, 0.1f)),
                HighlightKind.CommandRadius => (new Color(0.45f, 0.55f, 1f, 1f), new Color(0.35f, 0.45f, 1.4f)),
                HighlightKind.CommanderRadius => (new Color(0.85f, 0.45f, 1f, 1f), new Color(1.1f, 0.35f, 1.4f)),
                _ => (Color.white, Color.black),
            };
            TerrainMaterialFactory.SetMaterialColor(_highlightMat, fill);
            if (_highlightMat.HasProperty("_EmissionColor"))
            {
                _highlightMat.EnableKeyword("_EMISSION");
                _highlightMat.SetColor("_EmissionColor", glow);
            }
        }

        void OnMouseEnter()
        {
            // Hover only when not already highlighted — overlay owns selection feedback.
            if (_highlightKind != HighlightKind.None || _mat == null) return;
            TerrainMaterialFactory.SetMaterialColor(_mat, _baseColor * 1.12f);
        }

        void OnMouseExit()
        {
            if (_mat == null) return;
            TerrainMaterialFactory.SetMaterialColor(_mat, _baseColor);
        }
    }

    public enum HighlightKind { None, Selected, Move, Attack, CommandRadius, CommanderRadius }
}
