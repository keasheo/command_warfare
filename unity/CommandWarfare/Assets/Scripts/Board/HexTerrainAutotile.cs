using System.Collections.Generic;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Soft neighbor bleed only. Same-biome edges are left alone so contiguous
    /// regions stay one continuous sheet (world UVs + shared mats handle that).
    /// No welds / dark seam rims — those caused repeating hex-edge shading.
    /// </summary>
    public static class HexTerrainAutotile
    {
        const int EdgeSegs = 10;
        const int FadeLayers = 3;
        const float UvScale = 0.28f;

        static readonly float[] LayerDepthOuter = { 0.00f, 0.10f, 0.22f };
        static readonly float[] LayerDepthInner = { 0.10f, 0.22f, 0.36f };
        static readonly float[] LayerStrength = { 0.88f, 0.52f, 0.22f };
        static readonly float[] LayerWave = { 0.055f, 0.08f, 0.07f };

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

            var height = TerrainVisuals.BlockHeight(tile.Terrain);
            var yBase = height + 0.012f;
            var r = hexSize;
            var self = tile.Terrain;
            var seed = unchecked(tile.Coord.Col * 73856093 ^ tile.Coord.Row * 19349663);
            const int variant = 0;
            var world = new Vector2(tile.transform.position.x, tile.transform.position.z);

            for (var i = 0; i < 6; i++)
            {
                var neighbor = edgeNeighborKinds[i];
                // Same biome: no overlay — continuous sheet via world UVs + overlapping tops.
                if (neighbor == self) continue;

                EdgeEndpoints(r, i, out var p0, out var p1);
                var outward = EdgeOutward(i);
                var edgeSeed = unchecked(seed ^ (i * 83492791));
                var over0 = p0 + outward * (r * 0.045f);
                var over1 = p1 + outward * (r * 0.045f);

                for (var layer = 0; layer < FadeLayers; layer++)
                {
                    SpawnBand(
                        root,
                        $"Fade_{i}_{neighbor}_{layer}",
                        BuildEdgeStrip(
                            over0, over1, outward, r, world,
                            LayerDepthOuter[layer],
                            LayerDepthInner[layer],
                            yBase + layer * 0.0018f,
                            edgeSeed + layer * 17,
                            LayerWave[layer]),
                        TerrainMaterialFactory.CreateBlendOverlay(
                            neighbor, self, variant, catalog, LayerStrength[layer]));
                }

                // Soft lobes of neighbor bleeding inland (irregular, not circular rings).
                SpawnLobes(root, tile, catalog, neighbor, i, over0, over1, outward, r, world, yBase, edgeSeed);

                // Shore foam along water↔land edges.
                if (self == TerrainKind.Water || neighbor == TerrainKind.Water)
                {
                    var foamY = Mathf.Max(yBase, TerrainVisuals.WaterBlockHeight + 0.045f);
                    SpawnBand(
                        root,
                        $"Foam_{i}",
                        BuildEdgeStrip(over0, over1, outward, r, world, 0.0f, 0.09f, foamY, edgeSeed + 7, 0.04f),
                        TerrainMaterialFactory.CreateWaterFoam(self == TerrainKind.Water ? 0.38f : 0.28f));
                }

                // Side face only where biomes differ — matches neighbor so cuts aren't self-colored walls.
                SpawnBand(
                    root,
                    $"Side_{i}_{neighbor}",
                    BuildSideFace(over0, over1, height, world),
                    TerrainMaterialFactory.CreateBlendOverlay(neighbor, self, variant, catalog, 0.75f));
            }

            for (var i = 0; i < 6; i++)
            {
                var n0 = edgeNeighborKinds[i];
                var n1 = edgeNeighborKinds[(i + 1) % 6];
                if (n0 == self && n1 == self) continue;
                if (n0 != self && n1 != self && n0 != n1)
                {
                    SpawnCornerWedge(root, tile, catalog, n0, r, world, i, yBase, seed, towardNext: false);
                    SpawnCornerWedge(root, tile, catalog, n1, r, world, i, yBase, seed ^ 0x55, towardNext: true);
                }
                else
                {
                    var kind = n0 != self ? n0 : n1;
                    SpawnCornerWedge(root, tile, catalog, kind, r, world, i, yBase, seed,
                        towardNext: n1 != self && n0 == self);
                }
            }
        }

        static void SpawnLobes(
            Transform root,
            HexTile tile,
            TerrainAssetCatalog catalog,
            TerrainKind neighbor,
            int edgeIndex,
            Vector3 p0,
            Vector3 p1,
            Vector3 outward,
            float r,
            Vector2 world,
            float yBase,
            int edgeSeed)
        {
            var count = 1 + (int)(Hash01(edgeSeed, 3) * 1.8f);
            for (var t = 0; t < count; t++)
            {
                var tSeed = unchecked(edgeSeed ^ (t * 31337));
                var along = 0.22f + Hash01(tSeed, 0) * 0.56f;
                var width = 0.11f + Hash01(tSeed, 1) * 0.14f;
                var depth = 0.18f + Hash01(tSeed, 2) * 0.2f;
                var half = width * 0.5f;
                var q0 = Vector3.Lerp(p0, p1, Mathf.Clamp01(along - half));
                var q1 = Vector3.Lerp(p0, p1, Mathf.Clamp01(along + half));

                SpawnBand(
                    root,
                    $"Lobe_{edgeIndex}_{t}",
                    BuildEdgeStrip(q0, q1, outward, r, world, 0.03f, depth, yBase + 0.006f, tSeed, 0.09f),
                    TerrainMaterialFactory.CreateBlendOverlay(
                        neighbor, tile.Terrain, 0, catalog, 0.45f + Hash01(tSeed, 4) * 0.2f));
            }
        }

        static void SpawnCornerWedge(
            Transform root,
            HexTile tile,
            TerrainAssetCatalog catalog,
            TerrainKind kind,
            float r,
            Vector2 world,
            int cornerIndex,
            float yBase,
            int seed,
            bool towardNext)
        {
            var aCorner = EdgeAngle(cornerIndex + 1);
            var corner = new Vector3(r * Mathf.Cos(aCorner), 0f, r * Mathf.Sin(aCorner));
            var alongPrev = new Vector3(r * Mathf.Cos(EdgeAngle(cornerIndex)), 0f, r * Mathf.Sin(EdgeAngle(cornerIndex)));
            var alongNext = new Vector3(r * Mathf.Cos(EdgeAngle(cornerIndex + 2)), 0f, r * Mathf.Sin(EdgeAngle(cornerIndex + 2)));

            var tA = towardNext ? 0.48f : 0.3f;
            var tB = towardNext ? 0.3f : 0.48f;
            var pA = Vector3.Lerp(corner, alongPrev, tA);
            var pB = Vector3.Lerp(corner, alongNext, tB);
            var inward = (-(pA + pB) * 0.5f);
            if (inward.sqrMagnitude < 0.0001f) inward = -corner;
            inward.Normalize();
            var depth = r * (0.22f + Hash01(seed + cornerIndex, 8) * 0.1f);
            var pIn = corner + inward * depth;
            pIn.x += (Hash01(seed, cornerIndex * 3) - 0.5f) * r * 0.08f;
            pIn.z += (Hash01(seed, cornerIndex * 3 + 1) - 0.5f) * r * 0.08f;

            var outward = corner.normalized;
            pA += outward * (r * 0.035f);
            pB += outward * (r * 0.035f);
            corner += outward * (r * 0.035f);

            SpawnBand(
                root,
                $"Corner_{cornerIndex}_{kind}",
                BuildTri(pA, corner, pB, pIn, yBase + 0.003f, world),
                TerrainMaterialFactory.CreateBlendOverlay(kind, tile.Terrain, 0, catalog, 0.58f));
        }

        static void SpawnBand(Transform root, string name, Mesh mesh, Material mat)
        {
            if (mesh == null || mat == null) return;
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            var filter = go.AddComponent<MeshFilter>();
            var renderer = go.AddComponent<MeshRenderer>();
            filter.sharedMesh = mesh;
            renderer.sharedMaterial = mat;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static float EdgeAngle(int edgeIndex) =>
            Mathf.Deg2Rad * (60f * edgeIndex - 30f);

        static Vector3 EdgeOutward(int edgeIndex)
        {
            var mid = Mathf.Deg2Rad * (60f * edgeIndex);
            return new Vector3(Mathf.Cos(mid), 0f, Mathf.Sin(mid));
        }

        static void EdgeEndpoints(float radius, int edgeIndex, out Vector3 p0, out Vector3 p1)
        {
            var a0 = EdgeAngle(edgeIndex);
            var a1 = EdgeAngle(edgeIndex + 1);
            p0 = new Vector3(radius * Mathf.Cos(a0), 0f, radius * Mathf.Sin(a0));
            p1 = new Vector3(radius * Mathf.Cos(a1), 0f, radius * Mathf.Sin(a1));
        }

        static Mesh BuildEdgeStrip(
            Vector3 p0,
            Vector3 p1,
            Vector3 outward,
            float r,
            Vector2 world,
            float depthOuter,
            float depthInner,
            float y,
            int seed,
            float waveAmp)
        {
            var inland = -outward;
            var verts = new List<Vector3>((EdgeSegs + 1) * 2);
            var uvs = new List<Vector2>((EdgeSegs + 1) * 2);
            var tris = new List<int>(EdgeSegs * 6);

            for (var s = 0; s <= EdgeSegs; s++)
            {
                var t = s / (float)EdgeSegs;
                var along = Vector3.Lerp(p0, p1, t);

                var n1 = Hash01(seed, s);
                var n2 = Hash01(seed ^ unchecked((int)0x9E3779B9), s * 3 + 1);
                var wave = (n1 - 0.5f) * 2f * waveAmp;
                wave += (n2 - 0.5f) * waveAmp * 0.65f;
                wave += Mathf.Sin(t * Mathf.PI * 2.1f + (seed & 7)) * waveAmp * 0.4f;
                if (n1 > 0.8f) wave += waveAmp * 1.3f;
                if (n1 < 0.16f) wave -= waveAmp * 0.7f;

                var dOut = depthOuter * r + wave * r * 0.2f;
                var dIn = Mathf.Max(dOut + 0.015f * r, depthInner * r + wave * r);

                var vOuter = along + inland * dOut;
                var vInner = along + inland * dIn;
                vOuter.y = y;
                vInner.y = y;

                verts.Add(vInner);
                verts.Add(vOuter);
                uvs.Add(new Vector2((world.x + vInner.x) * UvScale, (world.y + vInner.z) * UvScale));
                uvs.Add(new Vector2((world.x + vOuter.x) * UvScale, (world.y + vOuter.z) * UvScale));
            }

            for (var s = 0; s < EdgeSegs; s++)
            {
                var i = s * 2;
                tris.Add(i);
                tris.Add(i + 1);
                tris.Add(i + 3);
                tris.Add(i);
                tris.Add(i + 3);
                tris.Add(i + 2);
            }

            var mesh = new Mesh { name = "BiomeEdgeStrip" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            var normals = mesh.normals;
            for (var i = 0; i < normals.Length; i++)
                normals[i] = Vector3.up;
            mesh.normals = normals;
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildSideFace(Vector3 p0, Vector3 p1, float height, Vector2 world)
        {
            var yBottom = 0.02f;
            var yTop = height + 0.01f;
            var verts = new[]
            {
                new Vector3(p0.x, yBottom, p0.z),
                new Vector3(p1.x, yBottom, p1.z),
                new Vector3(p1.x, yTop, p1.z),
                new Vector3(p0.x, yTop, p0.z),
            };
            var uvs = new[]
            {
                new Vector2((world.x + p0.x) * UvScale, (world.y + p0.z) * UvScale),
                new Vector2((world.x + p1.x) * UvScale, (world.y + p1.z) * UvScale),
                new Vector2((world.x + p1.x) * UvScale, (world.y + p1.z) * UvScale),
                new Vector2((world.x + p0.x) * UvScale, (world.y + p0.z) * UvScale),
            };
            var tris = new[] { 0, 1, 2, 0, 2, 3 };
            var mesh = new Mesh { name = "BiomeSideFace" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildTri(Vector3 a, Vector3 b, Vector3 c, Vector3 inland, float y, Vector2 world)
        {
            var verts = new[]
            {
                new Vector3(a.x, y, a.z),
                new Vector3(b.x, y, b.z),
                new Vector3(c.x, y, c.z),
                new Vector3(inland.x, y, inland.z),
            };
            var uvs = new[]
            {
                new Vector2((world.x + a.x) * UvScale, (world.y + a.z) * UvScale),
                new Vector2((world.x + b.x) * UvScale, (world.y + b.z) * UvScale),
                new Vector2((world.x + c.x) * UvScale, (world.y + c.z) * UvScale),
                new Vector2((world.x + inland.x) * UvScale, (world.y + inland.z) * UvScale),
            };
            var tris = new[] { 0, 1, 3, 1, 2, 3 };
            var mesh = new Mesh { name = "BiomeCornerWedge" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            var normals = mesh.normals;
            for (var i = 0; i < normals.Length; i++)
                normals[i] = Vector3.up;
            mesh.normals = normals;
            mesh.RecalculateBounds();
            return mesh;
        }

        static float Hash01(int seed, int i)
        {
            unchecked
            {
                var n = (uint)(seed * 747796405 + i * 2891336453);
                n = (n ^ (n >> 16)) * 0x45d9f3bu;
                n = (n ^ (n >> 16)) * 0x45d9f3bu;
                n ^= n >> 16;
                return (n & 0xFFFFFFu) / 16777215f;
            }
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
