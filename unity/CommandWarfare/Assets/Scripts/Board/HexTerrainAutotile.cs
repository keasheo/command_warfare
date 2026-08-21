using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Hex analog of Wang/blob autotiles: soft feathered edge bands + corner slices
    /// so neighboring biomes blend instead of hard-stamping wedges.
    /// </summary>
    public static class HexTerrainAutotile
    {
        const int FeatherSteps = 5;
        const float OuterScale = 0.97f;
        const float InnerScale = 0.38f;
        const float CornerInnerScale = 0.52f;

        // Outer → inner opacity (edge feathers).
        static readonly float[] FeatherAlpha = { 0.78f, 0.58f, 0.38f, 0.22f, 0.10f };

        public static void Apply(
            HexTile tile,
            TerrainKind[] edgeNeighborKinds,
            float hexSize,
            TerrainAssetCatalog catalog)
        {
            if (tile == null || edgeNeighborKinds == null || edgeNeighborKinds.Length != 6)
                return;

            ClearPrior(tile.transform);

            var root = new GameObject("EdgeTransitions").transform;
            root.SetParent(tile.transform, false);

            var yBase = TerrainVisuals.BlockHeight(tile.Terrain) + 0.015f;
            var r = hexSize * 0.98f;
            var self = tile.Terrain;

            // Wang edges — soft radial feathers along each differing side.
            for (var i = 0; i < 6; i++)
            {
                var neighbor = edgeNeighborKinds[i];
                if (neighbor == self) continue;

                var a0 = EdgeAngle(i);
                var a1 = EdgeAngle(i + 1);
                // Keep corner pie ownership of vertices — feather the middle 76% of the edge.
                var edgeA0 = Mathf.Lerp(a0, a1, 0.12f);
                var edgeA1 = Mathf.Lerp(a0, a1, 0.88f);

                for (var s = 0; s < FeatherSteps; s++)
                {
                    var t0 = s / (float)FeatherSteps;
                    var t1 = (s + 1) / (float)FeatherSteps;
                    var rOuter = Mathf.Lerp(r * OuterScale, r * InnerScale, t0);
                    var rInner = Mathf.Lerp(r * OuterScale, r * InnerScale, t1);
                    var y = yBase + s * 0.0015f;
                    SpawnBand(
                        root,
                        $"Edge_{i}_{neighbor}_{s}",
                        BuildAnnularWedge(rInner, rOuter, y, edgeA0, edgeA1),
                        TerrainMaterialFactory.CreateBlendOverlay(neighbor, self, tile.Variant, catalog, FeatherAlpha[s]));
                }
            }

            // Wang corners — pie slices where two adjacent edges meet.
            for (var i = 0; i < 6; i++)
            {
                var n0 = edgeNeighborKinds[i];
                var n1 = edgeNeighborKinds[(i + 1) % 6];
                var aCorner = EdgeAngle(i + 1);
                var aPrev = EdgeAngle(i);
                var aNext = EdgeAngle(i + 2);
                var aLeft = Mathf.Lerp(aPrev, aCorner, 0.72f);
                var aRight = Mathf.Lerp(aCorner, aNext, 0.28f);

                if (n0 != self && n1 != self && n0 == n1)
                {
                    SpawnCornerFan(root, tile, catalog, n0, i, aLeft, aRight, aCorner, r, yBase);
                }
                else
                {
                    if (n0 != self)
                    {
                        var mid = aCorner;
                        SpawnCornerFan(root, tile, catalog, n0, i, aLeft, mid, (aLeft + mid) * 0.5f, r, yBase);
                    }
                    if (n1 != self)
                    {
                        var mid = aCorner;
                        SpawnCornerFan(root, tile, catalog, n1, i, mid, aRight, (mid + aRight) * 0.5f, r, yBase);
                    }
                }
            }
        }

        static void SpawnCornerFan(
            Transform root,
            HexTile tile,
            TerrainAssetCatalog catalog,
            TerrainKind kind,
            int cornerIndex,
            float a0,
            float a1,
            float aTip,
            float r,
            float yBase)
        {
            // Three soft rings into the corner tip.
            float[] alphas = { 0.7f, 0.42f, 0.18f };
            for (var s = 0; s < 3; s++)
            {
                var t0 = s / 3f;
                var t1 = (s + 1) / 3f;
                var rOuter = Mathf.Lerp(r * OuterScale, r * CornerInnerScale, t0);
                var rInner = Mathf.Lerp(r * OuterScale, r * CornerInnerScale, t1);
                var y = yBase + 0.008f + s * 0.0015f;
                SpawnBand(
                    root,
                    $"Corner_{cornerIndex}_{kind}_{s}",
                    BuildCornerSlice(rInner, rOuter, y, a0, a1, aTip),
                    TerrainMaterialFactory.CreateBlendOverlay(kind, tile.Terrain, tile.Variant, catalog, alphas[s]));
            }
        }

        static void SpawnBand(Transform root, string name, Mesh mesh, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = mesh;
            renderer.sharedMaterial = mat;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static float EdgeAngle(int edgeIndex)
        {
            // Allow indices beyond 0..5 so corner lerps never wrap the wrong way.
            return Mathf.Deg2Rad * (60f * edgeIndex - 30f);
        }

        static Mesh BuildAnnularWedge(float rInner, float rOuter, float y, float a0, float a1)
        {
            var verts = new Vector3[]
            {
                new(rInner * Mathf.Cos(a0), y, rInner * Mathf.Sin(a0)),
                new(rOuter * Mathf.Cos(a0), y, rOuter * Mathf.Sin(a0)),
                new(rOuter * Mathf.Cos(a1), y, rOuter * Mathf.Sin(a1)),
                new(rInner * Mathf.Cos(a1), y, rInner * Mathf.Sin(a1)),
            };
            var uvs = new Vector2[]
            {
                new(0f, 0f), new(0f, 1f), new(1f, 1f), new(1f, 0f),
            };
            var tris = new[] { 0, 1, 2, 0, 2, 3 };
            var mesh = new Mesh { name = "HexEdgeFeather" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// Corner pie: outer arc between a0–a1, tapering toward a tip angle at rInner.
        /// </summary>
        static Mesh BuildCornerSlice(float rInner, float rOuter, float y, float a0, float a1, float aTip)
        {
            var verts = new Vector3[]
            {
                new(rInner * Mathf.Cos(aTip), y, rInner * Mathf.Sin(aTip)),
                new(rOuter * Mathf.Cos(a0), y, rOuter * Mathf.Sin(a0)),
                new(rOuter * Mathf.Cos(aTip), y, rOuter * Mathf.Sin(aTip)),
                new(rOuter * Mathf.Cos(a1), y, rOuter * Mathf.Sin(a1)),
            };
            var uvs = new Vector2[]
            {
                new(0.5f, 0f), new(0f, 1f), new(0.5f, 1f), new(1f, 1f),
            };
            var tris = new[] { 0, 1, 2, 0, 2, 3 };
            var mesh = new Mesh { name = "HexCornerSlice" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static void ClearPrior(Transform tile)
        {
            var existing = tile.Find("EdgeTransitions");
            if (existing == null) return;
            if (Application.isPlaying) Object.Destroy(existing.gameObject);
            else Object.DestroyImmediate(existing.gameObject);
        }
    }
}
