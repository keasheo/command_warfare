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
        float _hexSize = 1.0f;
        float _blockHeight = 0.72f;
        HighlightKind _highlightKind = HighlightKind.None;
        Transform _highlight;
        MeshRenderer _highlightRenderer;
        Material _highlightMat;

        static readonly System.Collections.Generic.Dictionary<int, Mesh> PrismByHeightMm = new();
        static float _cachedHexSize = -1f;
        const float WorldUvScale = 0.28f;

        public static void ClearMeshCache()
        {
            PrismByHeightMm.Clear();
            _cachedHexSize = -1f;
        }

        static Mesh GetHighlightPrism(float hexSize, float height)
        {
            if (!Mathf.Approximately(_cachedHexSize, hexSize))
            {
                PrismByHeightMm.Clear();
                _cachedHexSize = hexSize;
            }

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
            // One tint per biome for every terrain kind — contiguous regions read as one sheet.
            _baseColor = TerrainVisuals.BaseColor(terrain, 0);
            _blockHeight = TerrainVisuals.BlockHeight(terrain);
            transform.localPosition = HexMath.OddRToWorld(coord.Col, coord.Row, hexSize);

            EnsureComponents();

            // Per-tile mesh with planar world UVs. Shared local-UV meshes stamp a repeating
            // dark center on every hex; material UV offsets cannot fix that.
            if (_filter.sharedMesh != null && _filter.sharedMesh.name == "HexPrismWorld")
            {
                if (Application.isPlaying) Destroy(_filter.sharedMesh);
                else DestroyImmediate(_filter.sharedMesh);
            }
            var world = new Vector2(transform.localPosition.x, transform.localPosition.z);
            _filter.sharedMesh = HexMeshBuilder.CreatePrism(
                hexSize, _blockHeight, world, WorldUvScale, flattenTopNormals: true);
            _filter.sharedMesh.name = "HexPrismWorld";

            // Shared material per biome (no per-hex UV offset).
            _mat = TerrainMaterialFactory.CreateForTerrain(terrain, 0, catalog);
            _renderer.sharedMaterial = _mat;
            // Water mat already has the right translucent tint — don't overwrite alpha to opaque.
            // Volcanic / Mountains: albedo carries cracks / strata — keep BaseColor near-white.
            if (terrain != TerrainKind.Water)
                TerrainMaterialFactory.SetMaterialColor(_mat, DisplayTint());
            _renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _renderer.receiveShadows = false;

            if (terrain == TerrainKind.Wall)
                WallMeshBuilder.DressWallHex(transform, hexSize, _blockHeight, _baseColor);
            else if (terrain == TerrainKind.Water)
                WaterSurfaceDress.Apply(this, hexSize);

            // No hard hex outline on land — outlines make the grid obvious and fight biome fades.
            if (terrain == TerrainKind.Wall)
                EnsureHexOutline();
            else
                ClearHexOutline();

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

        void ClearHexOutline()
        {
            var existing = transform.Find("HexOutline");
            if (existing == null) return;
            if (Application.isPlaying) Destroy(existing.gameObject);
            else DestroyImmediate(existing.gameObject);
        }

        void EnsureHexOutline()
        {
            ClearHexOutline();

            // Wall outline: very thin and faint so fortifications stay readable
            // without calling out hex geometry. Sits slightly inset from the prism edge.
            var go = new GameObject("HexOutline");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = Vector3.zero;
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = HexMeshBuilder.CreateOutlineRing(_hexSize * 0.96f, _blockHeight + 0.022f, 0.018f);
            renderer.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(
                new Color(0.05f, 0.055f, 0.06f, 0.38f), null, 1f, 0.03f, 0f, Color.black);
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
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
            filter.sharedMesh = GetHighlightPrism(_hexSize * 0.98f, 0.06f);
            _highlightMat = TerrainMaterialFactory.CreateTileInstance(
                Color.white,
                null,
                1f,
                0.05f,
                0f,
                Color.black);
            TerrainMaterialFactory.MakeTransparent(_highlightMat);
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
            // Command radii stay faint so terrain stays readable underneath.
            var (fill, glow) = kind switch
            {
                HighlightKind.Selected => (new Color(1f, 0.92f, 0.25f, 0.55f), new Color(0.55f, 0.45f, 0.08f)),
                HighlightKind.Move => (new Color(0.15f, 1f, 0.55f, 0.45f), new Color(0.04f, 0.45f, 0.15f)),
                HighlightKind.Attack => (new Color(1f, 0.22f, 0.18f, 0.5f), new Color(0.55f, 0.08f, 0.04f)),
                HighlightKind.CommandRadius => (new Color(0.45f, 0.55f, 1f, 0.16f), new Color(0.08f, 0.1f, 0.22f)),
                HighlightKind.CommanderRadius => (new Color(0.85f, 0.45f, 1f, 0.14f), new Color(0.16f, 0.06f, 0.2f)),
                _ => (new Color(1f, 1f, 1f, 0.3f), Color.black),
            };
            TerrainMaterialFactory.MakeTransparent(_highlightMat);
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
            TerrainMaterialFactory.SetMaterialColor(_mat, DisplayTint() * 1.12f);
        }

        void OnMouseExit()
        {
            if (_mat == null) return;
            TerrainMaterialFactory.SetMaterialColor(_mat, DisplayTint());
        }

        /// <summary>
        /// Color multiplied with albedo. Volcanic/Mountains keep this near white so
        /// crack veins and green/brown strata in the texture stay visible.
        /// </summary>
        Color DisplayTint() => Terrain switch
        {
            TerrainKind.Volcanic => Color.Lerp(Color.white, _baseColor, 0.12f),
            TerrainKind.Mountains => Color.Lerp(Color.white, _baseColor, 0.28f),
            _ => _baseColor,
        };
    }

    public enum HighlightKind { None, Selected, Move, Attack, CommandRadius, CommanderRadius }
}
