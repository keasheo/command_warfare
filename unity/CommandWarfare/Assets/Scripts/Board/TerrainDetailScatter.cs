using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Procedural or prefab scatter props on hex tops.</summary>
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
                case TerrainKind.Forest:
                    ScatterTrees(root.transform, hexSize, rng, 3 + rng.NextInt(3), catalog);
                    break;
                case TerrainKind.Mountains:
                    ScatterPeaks(root.transform, hexSize, rng, 2 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Desert:
                    ScatterRocks(root.transform, hexSize, rng, 2, catalog);
                    break;
                case TerrainKind.Swamp:
                    ScatterReeds(root.transform, hexSize, rng, 3 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Volcanic:
                    ScatterVolcanic(root.transform, hexSize, rng, 2, catalog);
                    break;
            }
        }

        static void ScatterTrees(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.75f);
                if (catalog != null && catalog.HasForest)
                {
                    var prefab = catalog.PickTree(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.treeScaleMin, catalog.treeScaleMax, rng);
                        continue;
                    }
                }
                ScatterProceduralTree(root, p);
            }
        }

        static void ScatterPeaks(Transform root, float hexSize, SeededRng rng, int count, TerrainAssetCatalog catalog)
        {
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.65f);
                if (catalog != null && catalog.HasPeaks)
                {
                    var prefab = catalog.PickPeak(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        SpawnPrefab(root, prefab, p, 0f, catalog.peakScaleMin, catalog.peakScaleMax, rng);
                        continue;
                    }
                }
                var peak = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                peak.transform.SetParent(root, false);
                peak.transform.localPosition = new Vector3(p.x, 0.6f, p.y);
                peak.transform.localScale = new Vector3(0.35f, 1.2f, 0.35f);
                peak.GetComponent<Renderer>().sharedMaterial =
                    TerrainMaterialFactory.CreateTileInstance(new Color(0.55f, 0.54f, 0.58f));
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
                var rock = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                rock.transform.SetParent(root, false);
                rock.transform.localPosition = new Vector3(p.x, 0.15f, p.y);
                rock.transform.localScale = Vector3.one * (rng.NextFloat() * 0.25f + 0.15f);
                rock.GetComponent<Renderer>().sharedMaterial =
                    TerrainMaterialFactory.CreateTileInstance(new Color(0.62f, 0.55f, 0.42f));
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
                var reed = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                reed.transform.SetParent(root, false);
                reed.transform.localPosition = new Vector3(p.x, 0.35f, p.y);
                reed.transform.localScale = new Vector3(0.06f, 0.35f, 0.06f);
                reed.GetComponent<Renderer>().sharedMaterial =
                    TerrainMaterialFactory.CreateTileInstance(new Color(0.25f, 0.4f, 0.22f));
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
                var cone = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cone.transform.SetParent(root, false);
                cone.transform.localPosition = new Vector3(p.x, 0.25f, p.y);
                cone.transform.localScale = new Vector3(0.28f, 0.25f, 0.28f);
                cone.GetComponent<Renderer>().sharedMaterial =
                    TerrainMaterialFactory.CreateTileInstance(new Color(0.28f, 0.14f, 0.12f));
            }
        }

        static void ScatterProceduralTree(Transform root, Vector2 p)
        {
            var trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            trunk.transform.SetParent(root, false);
            trunk.transform.localPosition = new Vector3(p.x, 0.5f, p.y);
            trunk.transform.localScale = new Vector3(0.15f, 0.5f, 0.15f);
            trunk.GetComponent<Renderer>().sharedMaterial =
                TerrainMaterialFactory.CreateTileInstance(new Color(0.35f, 0.22f, 0.12f));

            var foliage = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            foliage.transform.SetParent(trunk.transform, false);
            foliage.transform.localPosition = new Vector3(0f, 1.1f, 0f);
            foliage.transform.localScale = new Vector3(1.2f, 1.4f, 1.2f);
            foliage.GetComponent<Renderer>().sharedMaterial =
                TerrainMaterialFactory.CreateTileInstance(new Color(0.18f, 0.42f, 0.22f));
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
            TerrainMaterialFactory.RecolorRenderers(go, ScatterColor(prefab));
        }

        static Color ScatterColor(GameObject prefab)
        {
            var n = prefab != null ? prefab.name.ToLowerInvariant() : "";
            if (n.Contains("tree")) return new Color(0.22f, 0.48f, 0.22f);
            if (n.Contains("peak")) return new Color(0.55f, 0.54f, 0.58f);
            if (n.Contains("rock")) return new Color(0.62f, 0.55f, 0.42f);
            if (n.Contains("reed")) return new Color(0.28f, 0.42f, 0.22f);
            if (n.Contains("volcan")) return new Color(0.35f, 0.16f, 0.12f);
            return new Color(0.4f, 0.5f, 0.35f);
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
    }
}
