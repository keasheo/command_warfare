using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Procedural or prefab scatter props on hex tops (no colliders — never block hex clicks).</summary>
    public static class TerrainDetailScatter
    {
        public static void Populate(
            HexTile tile,
            float hexSize,
            string roomSeed,
            Transform parent,
            TerrainAssetCatalog catalog = null)
        {
            var root = new GameObject("Details");
            root.transform.SetParent(parent, false);
            root.transform.localPosition = tile.transform.localPosition + Vector3.up * TerrainVisuals.BlockHeight(tile.Terrain);

            var seed = SeededRng.SeedFromRoomCode($"{roomSeed}:detail:{tile.Coord.Col},{tile.Coord.Row}");
            var rng = new SeededRng(seed);

            switch (tile.Terrain)
            {
                case TerrainKind.Plains:
                    ScatterGrass(root.transform, hexSize, rng, 2 + rng.NextInt(3), catalog);
                    break;
                case TerrainKind.Forest:
                    // Rim trees + light undergrowth — center kept clear for unit tokens.
                    ScatterTrees(root.transform, hexSize, rng, 1 + rng.NextInt(2), catalog);
                    ScatterGrass(root.transform, hexSize, rng, rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Mountains:
                    ScatterPeaks(root.transform, hexSize, rng, 1 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Desert:
                    ScatterRocks(root.transform, hexSize, rng, 2 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Swamp:
                    ScatterReeds(root.transform, hexSize, rng, 3 + rng.NextInt(3), catalog);
                    break;
                case TerrainKind.Volcanic:
                    ScatterVolcanic(root.transform, hexSize, rng, 2, catalog);
                    break;
                case TerrainKind.Wall:
                    if (catalog != null && catalog.HasWalls)
                        ScatterWallProps(root.transform, hexSize, rng, catalog);
                    break;
            }
        }

        static void ScatterGrass(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.72f);
                if (catalog != null && catalog.HasGrass)
                {
                    var prefab = catalog.PickGrass(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.grassScaleMin, catalog.grassScaleMax, rng);
                        continue;
                    }
                }
                CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, 0.12f, p.y),
                    new Vector3(0.08f + rng.NextFloat() * 0.06f, 0.12f, 0.08f + rng.NextFloat() * 0.06f),
                    new Color(0.28f, 0.55f, 0.22f));
            }
        }

        static void ScatterTrees(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            // Push trees toward the rim so miniatures remain visible in the center.
            var inner = hexSize * 0.42f;
            var outer = hexSize * 0.82f;
            // Readable Kenney trees while keeping hex centers usable for tokens.
            var scaleMin = catalog != null ? Mathf.Clamp(catalog.treeScaleMin, 0.85f, 1.25f) : 0.95f;
            var scaleMax = catalog != null ? Mathf.Clamp(catalog.treeScaleMax, scaleMin, 1.4f) : 1.25f;

            for (var i = 0; i < count; i++)
            {
                var p = RandomInHexRing(rng, inner, outer);
                if (catalog != null && catalog.HasForest)
                {
                    var prefab = catalog.PickTree(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, scaleMin, scaleMax, rng);
                        continue;
                    }
                }
                ScatterProceduralTree(root, p, rng);
            }
        }

        static void ScatterPeaks(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.55f);
                if (catalog != null && catalog.HasPeaks)
                {
                    var prefab = catalog.PickPeak(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.peakScaleMin, catalog.peakScaleMax, rng);
                        continue;
                    }
                }
                ScatterProceduralMountain(root, p, rng);
            }
        }

        static void ScatterRocks(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.7f);
                if (catalog != null && catalog.HasRocks)
                {
                    var prefab = catalog.PickRock(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.rockScaleMin, catalog.rockScaleMax, rng);
                        continue;
                    }
                }
                var rock = CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, 0.15f, p.y),
                    Vector3.one * (rng.NextFloat() * 0.28f + 0.14f),
                    new Color(0.62f, 0.55f, 0.42f));
                rock.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 40f, rng.NextFloat() * 360f, rng.NextFloat() * 40f);
            }
        }

        static void ScatterReeds(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.7f);
                if (catalog != null && catalog.HasReeds)
                {
                    var prefab = catalog.PickReed(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.reedScaleMin, catalog.reedScaleMax, rng);
                        continue;
                    }
                }
                CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, 0.35f, p.y),
                    new Vector3(0.06f, 0.35f, 0.06f),
                    new Color(0.25f, 0.4f, 0.22f));
            }
        }

        static void ScatterVolcanic(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.6f);
                if (catalog != null && catalog.HasVolcanic)
                {
                    var prefab = catalog.PickVolcanic(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.volcanicScaleMin, catalog.volcanicScaleMax, rng);
                        continue;
                    }
                }
                CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, 0.25f, p.y),
                    new Vector3(0.28f, 0.25f, 0.28f),
                    new Color(0.28f, 0.14f, 0.12f));
            }
        }

        static void ScatterWallProps(Transform root, float hexSize, SeededRng rng, TerrainAssetCatalog catalog)
        {
            var prefab = catalog.PickWall(rng.NextInt(9999));
            if (prefab == null) return;
            SpawnPrefab(root, prefab, Vector2.zero, 0f, catalog.wallScaleMin, catalog.wallScaleMax, rng);
        }

        static void ScatterProceduralTree(Transform root, Vector2 p, SeededRng rng)
        {
            var trunkH = 0.18f + rng.NextFloat() * 0.16f;
            var trunk = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, trunkH, p.y),
                new Vector3(0.06f + rng.NextFloat() * 0.03f, trunkH, 0.06f + rng.NextFloat() * 0.03f),
                new Color(0.35f, 0.22f, 0.12f));

            CreatePrim(PrimitiveType.Sphere, trunk.transform, new Vector3(0f, 1.0f, 0f),
                new Vector3(0.75f + rng.NextFloat() * 0.25f, 0.8f + rng.NextFloat() * 0.2f, 0.75f + rng.NextFloat() * 0.25f),
                new Color(0.16f + rng.NextFloat() * 0.08f, 0.38f + rng.NextFloat() * 0.12f, 0.18f));
        }

        static void ScatterProceduralMountain(Transform root, Vector2 p, SeededRng rng)
        {
            var h = 0.9f + rng.NextFloat() * 0.7f;
            var baseW = 0.55f + rng.NextFloat() * 0.35f;
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.35f, p.y),
                new Vector3(baseW, h * 0.35f, baseW),
                new Color(0.48f, 0.47f, 0.52f));
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.75f, p.y),
                new Vector3(baseW * 0.62f, h * 0.28f, baseW * 0.62f),
                new Color(0.55f, 0.54f, 0.58f));
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 1.05f, p.y),
                new Vector3(baseW * 0.32f, h * 0.18f, baseW * 0.32f),
                new Color(0.72f, 0.72f, 0.76f));
            CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, h * 1.22f, p.y),
                Vector3.one * (baseW * 0.28f),
                new Color(0.92f, 0.93f, 0.95f));
        }

        static GameObject CreatePrim(
            PrimitiveType type,
            Transform parent,
            Vector3 localPos,
            Vector3 localScale,
            Color color)
        {
            var go = GameObject.CreatePrimitive(type);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            StripColliders(go);
            var r = go.GetComponent<Renderer>();
            if (r != null)
            {
                r.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(color);
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            return go;
        }

        static void SpawnPrefab(
            Transform root,
            GameObject prefab,
            Vector2 p,
            float y,
            float scaleMin,
            float scaleMax,
            SeededRng rng)
        {
            var go = Object.Instantiate(prefab, root);
            go.transform.localPosition = new Vector3(p.x, y, p.y);
            var s = Mathf.Lerp(scaleMin, scaleMax, rng.NextFloat());
            go.transform.localScale = Vector3.one * s;
            go.transform.localRotation = Quaternion.Euler(0f, rng.NextFloat() * 360f, 0f);
            StripColliders(go);
            // Keep authored Kenney / Asset Store materials — do not flatten to solid color.
        }

        static void StripColliders(GameObject go)
        {
            foreach (var col in go.GetComponentsInChildren<Collider>(true))
            {
                if (Application.isPlaying) Object.Destroy(col);
                else Object.DestroyImmediate(col);
            }
        }

        static Vector2 RandomInHex(SeededRng rng, float radius)
        {
            for (var i = 0; i < 24; i++)
            {
                var x = (rng.NextFloat() * 2f - 1f) * radius;
                var z = (rng.NextFloat() * 2f - 1f) * radius;
                if (x * x + z * z < radius * radius * 0.77f)
                    return new Vector2(x, z);
            }
            return Vector2.zero;
        }

        static Vector2 RandomInHexRing(SeededRng rng, float minRadius, float maxRadius)
        {
            for (var i = 0; i < 32; i++)
            {
                var x = (rng.NextFloat() * 2f - 1f) * maxRadius;
                var z = (rng.NextFloat() * 2f - 1f) * maxRadius;
                var d2 = x * x + z * z;
                var min2 = minRadius * minRadius;
                var max2 = maxRadius * maxRadius * 0.85f;
                if (d2 >= min2 && d2 <= max2)
                    return new Vector2(x, z);
            }
            // Fallback: push out along a random angle.
            var a = rng.NextFloat() * Mathf.PI * 2f;
            var r = (minRadius + maxRadius) * 0.5f;
            return new Vector2(Mathf.Cos(a) * r, Mathf.Sin(a) * r);
        }
    }
}
