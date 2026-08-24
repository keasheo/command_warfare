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
            if (tile == null) return;

            // Parent under the hex so props die with the tile and never drift onto neighbors.
            var detailsParent = tile.transform;
            var existing = detailsParent.Find("Details");
            if (existing != null)
            {
                if (Application.isPlaying) Object.Destroy(existing.gameObject);
                else Object.DestroyImmediate(existing.gameObject);
            }

            var root = new GameObject("Details");
            root.transform.SetParent(detailsParent, false);
            root.transform.localPosition = Vector3.up * TerrainVisuals.BlockHeight(tile.Terrain);

            var seed = SeededRng.SeedFromRoomCode($"{roomSeed}:detail:{tile.Coord.Col},{tile.Coord.Row}");
            var rng = new SeededRng(seed);

            switch (tile.Terrain)
            {
                case TerrainKind.Plains:
                    // Light grass only — keep plains readable.
                    ScatterGrass(root.transform, hexSize, rng, 1 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Forest:
                    // Rim trees + sparse undergrowth — center kept clear for unit tokens.
                    ScatterTrees(root.transform, hexSize, rng, 1 + (rng.NextFloat() < 0.35f ? 1 : 0), catalog);
                    if (rng.NextFloat() < 0.4f)
                        ScatterGrass(root.transform, hexSize, rng, 1, catalog);
                    break;
                case TerrainKind.Mountains:
                    ScatterPeaks(root.transform, hexSize, rng, 1 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Desert:
                    ScatterRocks(root.transform, hexSize, rng, 2 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Volcanic:
                    // Subtle ash/cinder — was completely bare.
                    ScatterVolcanicDetails(root.transform, hexSize, rng, catalog);
                    break;
                case TerrainKind.Swamp:
                    // ~33% fewer reeds than prior 3–5 (now 2–3).
                    ScatterReeds(root.transform, hexSize, rng, 2 + rng.NextInt(2), catalog);
                    break;
                case TerrainKind.Wall:
                    if (catalog != null && catalog.HasWalls)
                        ScatterWallProps(root.transform, hexSize, rng, catalog);
                    break;
            }
        }

        static void ScatterVolcanicDetails(Transform root, float hexSize, SeededRng rng, TerrainAssetCatalog catalog)
        {
            // 1–2 small dark-gray basalt rocks / cinders.
            var count = 1 + (rng.NextFloat() < 0.45f ? 1 : 0);
            for (var i = 0; i < count; i++)
            {
                var p = RandomInHex(rng, hexSize * 0.62f);
                if (catalog != null && catalog.HasRocks)
                {
                    var prefab = catalog.PickRock(rng.NextInt(9999));
                    if (prefab != null)
                    {
                        var go = SpawnPrefab(root, prefab, p, 0f, 0.28f, 0.48f, rng);
                        TintRenderers(go, new Color(0.22f, 0.2f, 0.21f), 0.75f);
                        continue;
                    }
                }
                var sz = 0.07f + rng.NextFloat() * 0.08f;
                var rock = CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, sz * 0.35f, p.y),
                    Vector3.one * sz,
                    new Color(0.22f, 0.2f, 0.21f));
                rock.transform.localRotation = Quaternion.Euler(
                    rng.NextFloat() * 25f, rng.NextFloat() * 360f, rng.NextFloat() * 25f);
            }

            // Occasional low ash patch (flat dark-gray disc).
            if (rng.NextFloat() < 0.55f)
            {
                var p = RandomInHex(rng, hexSize * 0.55f);
                CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, 0.004f, p.y),
                    new Vector3(0.1f + rng.NextFloat() * 0.08f, 0.004f, 0.1f + rng.NextFloat() * 0.08f),
                    new Color(0.2f, 0.19f, 0.2f));
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
                        var go = SpawnPrefab(root, prefab, p, 0f, catalog.peakScaleMin, catalog.peakScaleMax, rng);
                        // Light gray with green / light-brown mountain character.
                        var tint = Color.Lerp(
                            new Color(0.62f, 0.66f, 0.56f),
                            new Color(0.72f, 0.6f, 0.46f),
                            rng.NextFloat());
                        TintRenderers(go, tint, 0.62f);
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
            // ~30% shorter than prior 0.9–1.6 height budget.
            var h = (0.9f + rng.NextFloat() * 0.7f) * 0.7f;
            var baseW = 0.55f + rng.NextFloat() * 0.35f;
            // Light brown foothills → green-gray mid → light gray peak → pale tip.
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.35f, p.y),
                new Vector3(baseW, h * 0.35f, baseW),
                new Color(0.7f, 0.58f, 0.44f));
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.75f, p.y),
                new Vector3(baseW * 0.62f, h * 0.28f, baseW * 0.62f),
                new Color(0.58f, 0.64f, 0.52f));
            CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 1.05f, p.y),
                new Vector3(baseW * 0.32f, h * 0.18f, baseW * 0.32f),
                new Color(0.78f, 0.78f, 0.76f));
            CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, h * 1.22f, p.y),
                Vector3.one * (baseW * 0.28f),
                new Color(0.9f, 0.91f, 0.9f));
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

        static GameObject SpawnPrefab(
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
            return go;
        }

        static void TintRenderers(GameObject go, Color tint, float strength)
        {
            if (go == null) return;
            strength = Mathf.Clamp01(strength);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (r == null) continue;
                var shared = r.sharedMaterial;
                if (shared == null) continue;

                Color src = Color.white;
                if (shared.HasProperty("_BaseColor"))
                    src = shared.GetColor("_BaseColor");
                else if (shared.HasProperty("_Color"))
                    src = shared.GetColor("_Color");

                var blended = Color.Lerp(src, tint, strength);
                var block = new MaterialPropertyBlock();
                r.GetPropertyBlock(block);
                if (shared.HasProperty("_BaseColor"))
                    block.SetColor("_BaseColor", blended);
                if (shared.HasProperty("_Color"))
                    block.SetColor("_Color", blended);
                r.SetPropertyBlock(block);
            }
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

        #region Edge Transition Scatter

        /// <summary>
        /// Places sparse neighbor-influenced props on the outer ring of a hex based on each edge's
        /// neighbor terrain. Creates density gradients: thick vegetation thins toward arid neighbors,
        /// rocky/sandy elements leak into lush biomes at borders.
        /// </summary>
        public static void PopulateEdgeTransitions(
            HexTile tile,
            float hexSize,
            string roomSeed,
            TerrainKind[] edgeNeighborKinds,
            TerrainAssetCatalog catalog = null)
        {
            if (tile == null || edgeNeighborKinds == null || edgeNeighborKinds.Length != 6)
                return;

            // Volcanic: no scatter at all per design.
            if (tile.Terrain == TerrainKind.Volcanic)
                return;

            var detailsParent = tile.transform.Find("Details");
            if (detailsParent == null)
            {
                detailsParent = new GameObject("Details").transform;
                detailsParent.SetParent(tile.transform, false);
                detailsParent.localPosition = Vector3.up * TerrainVisuals.BlockHeight(tile.Terrain);
            }

            // Find or create EdgeScatter child under Details.
            var existing = detailsParent.Find("EdgeScatter");
            if (existing != null)
            {
                if (Application.isPlaying) Object.Destroy(existing.gameObject);
                else Object.DestroyImmediate(existing.gameObject);
            }

            var edgeRoot = new GameObject("EdgeScatter");
            edgeRoot.transform.SetParent(detailsParent, false);
            edgeRoot.transform.localPosition = Vector3.zero;

            var seed = SeededRng.SeedFromRoomCode($"{roomSeed}:edgescatter:{tile.Coord.Col},{tile.Coord.Row}");
            var rng = new SeededRng(seed);
            var self = tile.Terrain;

            // Process each of the 6 hex edges.
            for (var edge = 0; edge < 6; edge++)
            {
                var neighbor = edgeNeighborKinds[edge];
                if (neighbor == self) continue;

                // Compute the angular wedge for this edge (pointy-top hex).
                var edgeAngle = EdgeAngleDeg(edge);
                var halfSpan = 30f; // Each edge spans 60° centered on edgeAngle.

                // Determine what props to scatter based on the self→neighbor transition.
                var recipe = GetTransitionRecipe(self, neighbor);
                if (recipe.count == 0) continue;

                // Edge seed for determinism.
                var edgeSeed = unchecked(seed ^ (uint)(edge * 83492791));
                var edgeRng = new SeededRng(edgeSeed);

                for (var i = 0; i < recipe.count; i++)
                {
                    var p = RandomInEdgeWedge(edgeRng, hexSize, edgeAngle, halfSpan);
                    SpawnTransitionProp(edgeRoot.transform, p, recipe, edgeRng, catalog);
                }
            }
        }

        /// <summary>Returns the center angle (degrees) for edge index (0-5), pointy-top orientation.</summary>
        static float EdgeAngleDeg(int edgeIndex) => 60f * edgeIndex - 30f;

        /// <summary>
        /// Returns a random point in the outer rim of the hex, constrained to a wedge around the
        /// given center angle. Used to place edge-transition props near the boundary facing a neighbor.
        /// </summary>
        static Vector2 RandomInEdgeWedge(SeededRng rng, float hexSize, float centerAngleDeg, float halfSpanDeg)
        {
            // Outer 25% of hex radius — the "edge zone".
            var innerR = hexSize * 0.72f;
            var outerR = hexSize * 0.92f;

            for (var attempt = 0; attempt < 32; attempt++)
            {
                // Random angle within wedge.
                var angleDeg = centerAngleDeg + (rng.NextFloat() * 2f - 1f) * halfSpanDeg;
                var angleRad = angleDeg * Mathf.Deg2Rad;

                // Random radius in the edge zone.
                var r = Mathf.Lerp(innerR, outerR, rng.NextFloat());

                var x = r * Mathf.Cos(angleRad);
                var z = r * Mathf.Sin(angleRad);

                // Verify still inside hex bounds (flat-to-flat distance check).
                if (IsInsideHex(x, z, hexSize * 0.97f))
                    return new Vector2(x, z);
            }

            // Fallback: center of the wedge at mid-radius.
            var fallbackR = (innerR + outerR) * 0.5f;
            var fallbackA = centerAngleDeg * Mathf.Deg2Rad;
            return new Vector2(fallbackR * Mathf.Cos(fallbackA), fallbackR * Mathf.Sin(fallbackA));
        }

        /// <summary>Point-in-hex test for pointy-top hex with given circumradius.</summary>
        static bool IsInsideHex(float x, float z, float radius)
        {
            // Pointy-top hex: inscribed radius = radius * sqrt(3)/2.
            var inradius = radius * 0.866f;
            // Quick AABB reject.
            if (Mathf.Abs(x) > radius || Mathf.Abs(z) > inradius)
                return false;
            // Full hex containment (using axial symmetry).
            var ax = Mathf.Abs(x);
            var az = Mathf.Abs(z);
            return az <= inradius && ax <= radius && (ax * 0.5f + az * 0.866f) <= inradius;
        }

        #region Transition Recipes

        struct TransitionRecipe
        {
            public int count;
            public TransitionPropKind[] propKinds;
            public float scaleMin;
            public float scaleMax;
        }

        enum TransitionPropKind
        {
            SmallGrass,      // Thin grass tufts.
            SmallRock,       // Pebbles / small stones.
            DeadTuft,        // Dry/dead vegetation stub.
            SandPatch,       // Flat sand-colored disc.
            SoilPatch,       // Dirt patch.
            ThinTree,        // Small/young tree at edge.
            Reed,            // Swamp reed/cattail.
            ShoreRock,       // Water-edge rock.
            FoamPatch,       // Subtle white disc for shore foam.
            Rubble,          // Wall rubble/stone debris.
            AshPatch,        // Dark volcanic ash disc.
            MossClump,       // Mossy rock/clump.
        }

        /// <summary>
        /// Determines what to scatter at the edge based on the self→neighbor terrain transition.
        /// Returns sparse counts (1-3) to keep edges subtle.
        /// </summary>
        static TransitionRecipe GetTransitionRecipe(TerrainKind self, TerrainKind neighbor)
        {
            // ─────────────────────────────────────────────────────────────────
            // FOREST edges: vegetation thins toward arid neighbors.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Forest)
            {
                return neighbor switch
                {
                    TerrainKind.Desert => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.DeadTuft, TransitionPropKind.SmallRock, TransitionPropKind.SandPatch },
                        scaleMin = 0.4f, scaleMax = 0.7f
                    },
                    TerrainKind.Plains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallGrass, TransitionPropKind.ThinTree },
                        scaleMin = 0.5f, scaleMax = 0.8f
                    },
                    TerrainKind.Swamp => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.MossClump, TransitionPropKind.Reed },
                        scaleMin = 0.5f, scaleMax = 0.85f
                    },
                    TerrainKind.Water => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.Reed },
                        scaleMin = 0.4f, scaleMax = 0.7f
                    },
                    TerrainKind.Mountains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallRock, TransitionPropKind.ThinTree },
                        scaleMin = 0.45f, scaleMax = 0.75f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.AshPatch, TransitionPropKind.DeadTuft },
                        scaleMin = 0.4f, scaleMax = 0.6f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.SmallRock },
                        scaleMin = 0.35f, scaleMax = 0.6f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // DESERT edges: sand/rocks leak into lush neighbors.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Desert)
            {
                return neighbor switch
                {
                    TerrainKind.Forest => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallGrass, TransitionPropKind.DeadTuft, TransitionPropKind.SoilPatch },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Plains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallGrass, TransitionPropKind.SoilPatch },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Swamp => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.SoilPatch, TransitionPropKind.DeadTuft },
                        scaleMin = 0.4f, scaleMax = 0.6f
                    },
                    TerrainKind.Water => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.SandPatch },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Mountains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallRock, TransitionPropKind.SandPatch },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.AshPatch, TransitionPropKind.SmallRock },
                        scaleMin = 0.35f, scaleMax = 0.55f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.SandPatch },
                        scaleMin = 0.35f, scaleMax = 0.6f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // PLAINS edges: grass thins, shared elements appear.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Plains)
            {
                return neighbor switch
                {
                    TerrainKind.Forest => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ThinTree, TransitionPropKind.SmallGrass },
                        scaleMin = 0.5f, scaleMax = 0.8f
                    },
                    TerrainKind.Desert => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.DeadTuft, TransitionPropKind.SandPatch, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Swamp => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Reed, TransitionPropKind.MossClump },
                        scaleMin = 0.5f, scaleMax = 0.75f
                    },
                    TerrainKind.Water => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.Reed },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Mountains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallRock, TransitionPropKind.SmallGrass },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.AshPatch, TransitionPropKind.DeadTuft },
                        scaleMin = 0.35f, scaleMax = 0.55f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.SmallRock },
                        scaleMin = 0.35f, scaleMax = 0.6f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // SWAMP edges: reeds and moss spread outward.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Swamp)
            {
                return neighbor switch
                {
                    TerrainKind.Forest => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ThinTree, TransitionPropKind.MossClump },
                        scaleMin = 0.5f, scaleMax = 0.8f
                    },
                    TerrainKind.Plains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallGrass, TransitionPropKind.Reed },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Desert => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.DeadTuft, TransitionPropKind.SoilPatch },
                        scaleMin = 0.4f, scaleMax = 0.6f
                    },
                    TerrainKind.Water => new TransitionRecipe
                    {
                        count = 3, propKinds = new[] { TransitionPropKind.Reed, TransitionPropKind.FoamPatch },
                        scaleMin = 0.5f, scaleMax = 0.8f
                    },
                    TerrainKind.Mountains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallRock, TransitionPropKind.MossClump },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.AshPatch },
                        scaleMin = 0.35f, scaleMax = 0.5f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.MossClump },
                        scaleMin = 0.35f, scaleMax = 0.6f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // WATER edges: shore rocks and subtle foam cues.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Water)
            {
                return neighbor switch
                {
                    TerrainKind.Forest or TerrainKind.Plains or TerrainKind.Swamp => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.FoamPatch, TransitionPropKind.Reed },
                        scaleMin = 0.4f, scaleMax = 0.7f
                    },
                    TerrainKind.Desert => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.SandPatch },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Mountains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.SmallRock },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.AshPatch },
                        scaleMin = 0.35f, scaleMax = 0.55f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.ShoreRock },
                        scaleMin = 0.35f, scaleMax = 0.6f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // MOUNTAINS edges: rocks and sparse alpine vegetation.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Mountains)
            {
                return neighbor switch
                {
                    TerrainKind.Forest => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ThinTree, TransitionPropKind.SmallRock },
                        scaleMin = 0.45f, scaleMax = 0.7f
                    },
                    TerrainKind.Plains => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SmallGrass, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Desert => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.SandPatch, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Water => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.ShoreRock, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Swamp => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.MossClump, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    TerrainKind.Volcanic => new TransitionRecipe
                    {
                        count = 1, propKinds = new[] { TransitionPropKind.AshPatch, TransitionPropKind.SmallRock },
                        scaleMin = 0.35f, scaleMax = 0.55f
                    },
                    TerrainKind.Wall => new TransitionRecipe
                    {
                        count = 2, propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.SmallRock },
                        scaleMin = 0.4f, scaleMax = 0.65f
                    },
                    _ => default,
                };
            }

            // ─────────────────────────────────────────────────────────────────
            // WALL edges: rubble and stone lip scatter.
            // ─────────────────────────────────────────────────────────────────
            if (self == TerrainKind.Wall)
            {
                // Walls get rubble at every non-wall edge.
                if (neighbor != TerrainKind.Wall)
                {
                    return new TransitionRecipe
                    {
                        count = 3,
                        propKinds = new[] { TransitionPropKind.Rubble, TransitionPropKind.SmallRock },
                        scaleMin = 0.35f,
                        scaleMax = 0.65f
                    };
                }
            }

            return default;
        }

        #endregion

        #region Prop Spawning

        static void SpawnTransitionProp(
            Transform root,
            Vector2 p,
            TransitionRecipe recipe,
            SeededRng rng,
            TerrainAssetCatalog catalog)
        {
            if (recipe.propKinds == null || recipe.propKinds.Length == 0)
                return;

            var kind = recipe.propKinds[rng.NextInt(recipe.propKinds.Length)];
            var scale = Mathf.Lerp(recipe.scaleMin, recipe.scaleMax, rng.NextFloat());
            var yRot = rng.NextFloat() * 360f;

            switch (kind)
            {
                case TransitionPropKind.SmallGrass:
                    SpawnSmallGrass(root, p, scale, yRot, rng, catalog);
                    break;
                case TransitionPropKind.SmallRock:
                    SpawnSmallRock(root, p, scale, yRot, rng, catalog);
                    break;
                case TransitionPropKind.DeadTuft:
                    SpawnDeadTuft(root, p, scale, yRot, rng);
                    break;
                case TransitionPropKind.SandPatch:
                    SpawnGroundPatch(root, p, scale, new Color(0.92f, 0.82f, 0.58f, 0.6f));
                    break;
                case TransitionPropKind.SoilPatch:
                    SpawnGroundPatch(root, p, scale, new Color(0.45f, 0.32f, 0.22f, 0.55f));
                    break;
                case TransitionPropKind.ThinTree:
                    SpawnThinTree(root, p, scale, yRot, rng, catalog);
                    break;
                case TransitionPropKind.Reed:
                    SpawnReed(root, p, scale, yRot, rng, catalog);
                    break;
                case TransitionPropKind.ShoreRock:
                    SpawnShoreRock(root, p, scale, yRot, rng, catalog);
                    break;
                case TransitionPropKind.FoamPatch:
                    SpawnGroundPatch(root, p, scale * 0.8f, new Color(0.95f, 0.98f, 1f, 0.35f));
                    break;
                case TransitionPropKind.Rubble:
                    SpawnRubble(root, p, scale, yRot, rng);
                    break;
                case TransitionPropKind.AshPatch:
                    SpawnGroundPatch(root, p, scale, new Color(0.12f, 0.1f, 0.1f, 0.5f));
                    break;
                case TransitionPropKind.MossClump:
                    SpawnMossClump(root, p, scale, yRot, rng);
                    break;
            }
        }

        static void SpawnSmallGrass(Transform root, Vector2 p, float scale, float yRot, SeededRng rng, TerrainAssetCatalog catalog)
        {
            if (catalog != null && catalog.HasGrass)
            {
                var prefab = catalog.PickGrass(rng.NextInt(9999));
                if (prefab != null)
                {
                    SpawnPrefab(root, prefab, p, 0f, scale * 0.6f, scale * 0.8f, rng);
                    return;
                }
            }
            // Fallback: thin procedural grass tuft.
            var h = 0.08f + rng.NextFloat() * 0.06f;
            var go = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.5f, p.y),
                new Vector3(0.04f * scale, h, 0.04f * scale),
                new Color(0.35f, 0.55f, 0.28f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 8f - 4f, yRot, rng.NextFloat() * 8f - 4f);
        }

        static void SpawnSmallRock(Transform root, Vector2 p, float scale, float yRot, SeededRng rng, TerrainAssetCatalog catalog)
        {
            if (catalog != null && catalog.HasRocks)
            {
                var prefab = catalog.PickRock(rng.NextInt(9999));
                if (prefab != null)
                {
                    SpawnPrefab(root, prefab, p, 0f, scale * 0.35f, scale * 0.55f, rng);
                    return;
                }
            }
            // Fallback: small procedural rock.
            var sz = 0.08f + rng.NextFloat() * 0.06f;
            var go = CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, sz * 0.4f * scale, p.y),
                Vector3.one * (sz * scale),
                new Color(0.55f, 0.5f, 0.45f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 30f, yRot, rng.NextFloat() * 30f);
        }

        static void SpawnDeadTuft(Transform root, Vector2 p, float scale, float yRot, SeededRng rng)
        {
            var h = 0.06f + rng.NextFloat() * 0.04f;
            var go = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.5f, p.y),
                new Vector3(0.03f * scale, h * scale, 0.03f * scale),
                new Color(0.55f, 0.45f, 0.3f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 15f - 7f, yRot, rng.NextFloat() * 15f - 7f);
        }

        static void SpawnGroundPatch(Transform root, Vector2 p, float scale, Color color)
        {
            // Flat disc on ground — subtle color overlay.
            var go = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, 0.005f, p.y),
                new Vector3(0.12f * scale, 0.005f, 0.12f * scale),
                color);
            // Make it transparent.
            var r = go.GetComponent<Renderer>();
            if (r != null && r.sharedMaterial != null)
                TerrainMaterialFactory.MakeTransparent(r.sharedMaterial);
        }

        static void SpawnThinTree(Transform root, Vector2 p, float scale, float yRot, SeededRng rng, TerrainAssetCatalog catalog)
        {
            if (catalog != null && catalog.HasForest)
            {
                var prefab = catalog.PickTree(rng.NextInt(9999));
                if (prefab != null)
                {
                    SpawnPrefab(root, prefab, p, 0f, scale * 0.5f, scale * 0.7f, rng);
                    return;
                }
            }
            // Fallback: thin procedural sapling.
            var trunkH = 0.1f + rng.NextFloat() * 0.08f;
            var trunk = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, trunkH * 0.5f * scale, p.y),
                new Vector3(0.025f * scale, trunkH * scale, 0.025f * scale),
                new Color(0.4f, 0.28f, 0.15f));
            trunk.transform.localRotation = Quaternion.Euler(0f, yRot, 0f);

            CreatePrim(PrimitiveType.Sphere, trunk.transform, new Vector3(0f, 0.8f, 0f),
                new Vector3(0.5f + rng.NextFloat() * 0.2f, 0.5f + rng.NextFloat() * 0.15f, 0.5f + rng.NextFloat() * 0.2f),
                new Color(0.22f + rng.NextFloat() * 0.08f, 0.42f + rng.NextFloat() * 0.1f, 0.2f));
        }

        static void SpawnReed(Transform root, Vector2 p, float scale, float yRot, SeededRng rng, TerrainAssetCatalog catalog)
        {
            if (catalog != null && catalog.HasReeds)
            {
                var prefab = catalog.PickReed(rng.NextInt(9999));
                if (prefab != null)
                {
                    SpawnPrefab(root, prefab, p, 0f, scale * 0.5f, scale * 0.7f, rng);
                    return;
                }
            }
            // Fallback: thin procedural reed.
            var h = 0.18f + rng.NextFloat() * 0.1f;
            var go = CreatePrim(PrimitiveType.Cylinder, root, new Vector3(p.x, h * 0.5f * scale, p.y),
                new Vector3(0.02f * scale, h * scale, 0.02f * scale),
                new Color(0.3f, 0.42f, 0.25f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 6f - 3f, yRot, rng.NextFloat() * 6f - 3f);
        }

        static void SpawnShoreRock(Transform root, Vector2 p, float scale, float yRot, SeededRng rng, TerrainAssetCatalog catalog)
        {
            if (catalog != null && catalog.HasRocks)
            {
                var prefab = catalog.PickRock(rng.NextInt(9999));
                if (prefab != null)
                {
                    SpawnPrefab(root, prefab, p, 0f, scale * 0.4f, scale * 0.6f, rng);
                    return;
                }
            }
            // Fallback: wet-looking small rock.
            var sz = 0.1f + rng.NextFloat() * 0.08f;
            var go = CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, sz * 0.35f * scale, p.y),
                Vector3.one * (sz * scale),
                new Color(0.38f, 0.4f, 0.42f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 25f, yRot, rng.NextFloat() * 25f);
        }

        static void SpawnRubble(Transform root, Vector2 p, float scale, float yRot, SeededRng rng)
        {
            // 2-3 small stone fragments.
            var count = 2 + (rng.NextInt(2));
            for (var i = 0; i < count; i++)
            {
                var offset = new Vector2((rng.NextFloat() - 0.5f) * 0.06f, (rng.NextFloat() - 0.5f) * 0.06f);
                var sz = (0.04f + rng.NextFloat() * 0.04f) * scale;
                var go = CreatePrim(PrimitiveType.Cube, root,
                    new Vector3(p.x + offset.x, sz * 0.4f, p.y + offset.y),
                    new Vector3(sz, sz * 0.7f, sz * (0.8f + rng.NextFloat() * 0.4f)),
                    new Color(0.52f, 0.5f, 0.48f));
                go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 20f, yRot + rng.NextFloat() * 40f, rng.NextFloat() * 20f);
            }
        }

        static void SpawnMossClump(Transform root, Vector2 p, float scale, float yRot, SeededRng rng)
        {
            var sz = 0.07f + rng.NextFloat() * 0.05f;
            var go = CreatePrim(PrimitiveType.Sphere, root, new Vector3(p.x, sz * 0.3f * scale, p.y),
                new Vector3(sz * scale, sz * 0.6f * scale, sz * scale),
                new Color(0.18f, 0.35f, 0.15f));
            go.transform.localRotation = Quaternion.Euler(rng.NextFloat() * 10f, yRot, rng.NextFloat() * 10f);
        }

        #endregion

        #endregion
    }
}
