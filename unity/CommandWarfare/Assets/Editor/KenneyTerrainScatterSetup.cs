using System.Collections.Generic;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Builds scatter prefabs from the bundled Kenney Nature Kit (CC0) FBX models
    /// and wires them into TerrainAssetCatalog. Kenney FBX embeds cyan/pastel materials
    /// in URP, so we remap to a local green/brown/stone/lava palette on the prefabs.
    /// </summary>
    public static class KenneyTerrainScatterSetup
    {
        const string FbxRoot = "Assets/Art/Environment/KenneyNatureKit/Models/FBX format";
        const string PrefabRoot = "Assets/Prefabs/Terrain/Kenney";
        const string MatRoot = "Assets/Prefabs/Terrain/Kenney/Materials";
        const string CatalogPath = "Assets/Data/TerrainAssetCatalog.asset";

        static readonly string[] TreeNames =
        {
            "tree_pineTallA", "tree_pineTallB", "tree_pineTallC", "tree_pineTallD",
            "tree_pineTallA_detailed", "tree_pineTallB_detailed",
            "tree_pineDefaultA", "tree_pineDefaultB",
            "tree_pineRoundA", "tree_pineRoundC", "tree_pineRoundE",
            "tree_detailed", "tree_detailed_dark",
            "tree_oak", "tree_oak_dark",
            "tree_tall", "tree_tall_dark",
            "tree_default", "tree_simple",
            "tree_pineSmallA", "tree_pineSmallC",
        };

        static readonly string[] GrassNames =
        {
            "grass_large", "grass_leafs", "grass_leafsLarge",
            "flower_yellowA", "flower_yellowB", "flower_purpleA", "flower_redA",
            "plant_bushSmall", "plant_flatShort",
        };

        static readonly string[] RockNames =
        {
            "rock_smallA", "rock_smallB", "rock_smallC", "rock_smallD", "rock_smallE", "rock_smallF",
            "rock_smallFlatA", "rock_smallFlatB", "rock_smallFlatC",
            "stone_smallA", "stone_smallB", "stone_smallC", "stone_smallFlatA",
        };

        static readonly string[] PeakNames =
        {
            "rock_largeA", "rock_largeB", "rock_largeC", "rock_tallA", "rock_tallB",
            "stone_largeA", "stone_largeB", "stone_tallA", "stone_tallB", "stone_tallC",
        };

        static readonly string[] ReedNames =
        {
            "plant_bush", "plant_bushDetailed", "plant_bushLarge", "plant_flatTall",
            "mushroom_tan", "mushroom_tanGroup", "mushroom_red", "mushroom_redGroup",
            "grass_leafsLarge", "plant_bushTriangle",
        };

        static readonly string[] VolcanicSourceRocks =
        {
            "rock_smallA", "rock_smallC", "rock_smallE",
            "rock_largeA", "rock_largeC", "rock_tallA",
            "stone_smallA", "stone_smallC", "stone_tallA",
        };

        static Dictionary<string, Material> _palette;

        [MenuItem("CommandWarfare/Terrain/Wire Kenney Nature Scatter")]
        public static void Wire()
        {
            EnsureFolder("Assets/Prefabs");
            EnsureFolder("Assets/Prefabs/Terrain");
            EnsureFolder(PrefabRoot);
            EnsureFolder(MatRoot);

            _palette = BuildPalette();

            var trees = BuildPrefabs("Trees", TreeNames);
            var grass = BuildPrefabs("Grass", GrassNames);
            var rocks = BuildPrefabs("Rocks", RockNames);
            var peaks = BuildPrefabs("Peaks", PeakNames);
            var reeds = BuildPrefabs("Swamp", ReedNames);
            var volcanic = BuildVolcanicPrefabs();

            var catalog = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>(CatalogPath);
            if (catalog == null)
            {
                Debug.LogError($"[CommandWarfare] Missing {CatalogPath}");
                return;
            }

            var so = new SerializedObject(catalog);
            AssignArray(so, "treePrefabs", trees);
            AssignArray(so, "grassPrefabs", grass);
            AssignArray(so, "rockPrefabs", rocks);
            AssignArray(so, "peakPrefabs", peaks);
            AssignArray(so, "reedPrefabs", reeds);
            AssignArray(so, "volcanicPrefabs", volcanic);

            so.FindProperty("treeScaleMin").floatValue = 1.15f;
            so.FindProperty("treeScaleMax").floatValue = 1.6f;
            so.FindProperty("grassScaleMin").floatValue = 0.7f;
            so.FindProperty("grassScaleMax").floatValue = 1.15f;
            so.FindProperty("rockScaleMin").floatValue = 0.55f;
            so.FindProperty("rockScaleMax").floatValue = 1.0f;
            so.FindProperty("peakScaleMin").floatValue = 0.7f;
            so.FindProperty("peakScaleMax").floatValue = 1.15f;
            so.FindProperty("reedScaleMin").floatValue = 0.75f;
            so.FindProperty("reedScaleMax").floatValue = 1.2f;
            so.FindProperty("volcanicScaleMin").floatValue = 0.65f;
            so.FindProperty("volcanicScaleMax").floatValue = 1.15f;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log(
                $"[CommandWarfare] Kenney scatter wired — trees:{trees.Count} grass:{grass.Count} " +
                $"rocks:{rocks.Count} peaks:{peaks.Count} swamp:{reeds.Count} volcanic:{volcanic.Count}");
        }

        static Dictionary<string, Material> BuildPalette()
        {
            var d = new Dictionary<string, Material>
            {
                ["leaf"] = MakeMat("CW_LeafGreen", new Color(0.26f, 0.52f, 0.24f)),
                ["leafDark"] = MakeMat("CW_LeafDark", new Color(0.16f, 0.38f, 0.2f)),
                ["leafFall"] = MakeMat("CW_LeafFall", new Color(0.72f, 0.42f, 0.18f)),
                ["bark"] = MakeMat("CW_Bark", new Color(0.42f, 0.28f, 0.16f)),
                ["barkDark"] = MakeMat("CW_BarkDark", new Color(0.28f, 0.17f, 0.11f)),
                ["stone"] = MakeMat("CW_Stone", new Color(0.48f, 0.47f, 0.49f)),
                ["stoneDark"] = MakeMat("CW_StoneDark", new Color(0.32f, 0.31f, 0.33f)),
                ["dirt"] = MakeMat("CW_Dirt", new Color(0.5f, 0.38f, 0.24f)),
                ["flowerYellow"] = MakeMat("CW_FlowerYellow", new Color(0.9f, 0.78f, 0.22f)),
                ["flowerPurple"] = MakeMat("CW_FlowerPurple", new Color(0.55f, 0.32f, 0.75f)),
                ["flowerRed"] = MakeMat("CW_FlowerRed", new Color(0.85f, 0.25f, 0.28f)),
                ["mushroomRed"] = MakeMat("CW_MushroomRed", new Color(0.75f, 0.2f, 0.18f)),
                ["mushroomTan"] = MakeMat("CW_MushroomTan", new Color(0.72f, 0.62f, 0.42f)),
                ["lavaDark"] = MakeMat("LavaRockDark", new Color(0.12f, 0.1f, 0.11f), new Color(0.55f, 0.12f, 0.02f), 0.35f),
                ["lavaGlow"] = MakeMat("LavaRockGlow", new Color(0.18f, 0.08f, 0.04f), new Color(1.2f, 0.35f, 0.05f), 1.4f),
                ["lavaCrust"] = MakeMat("LavaRockCrust", new Color(0.22f, 0.14f, 0.12f), new Color(0.7f, 0.18f, 0.04f), 0.55f),
            };
            return d;
        }

        static Material MakeMat(string name, Color albedo, Color? emission = null, float emissionStrength = 0f)
        {
            var path = $"{MatRoot}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit")
                             ?? Shader.Find("Standard")
                             ?? Shader.Find("Diffuse");
                mat = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(mat, path);
                mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            }

            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", albedo);
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", albedo);
            mat.color = albedo;
            if (emission.HasValue && mat.HasProperty("_EmissionColor"))
            {
                mat.EnableKeyword("_EMISSION");
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
                mat.SetColor("_EmissionColor", emission.Value * emissionStrength);
            }

            EditorUtility.SetDirty(mat);
            return mat;
        }

        static Material Remap(Material src)
        {
            if (src == null) return _palette["leaf"];
            var n = src.name.ToLowerInvariant();
            if (n.Contains("leaf") || n == "grass")
            {
                if (n.Contains("fall")) return _palette["leafFall"];
                if (n.Contains("dark")) return _palette["leafDark"];
                return _palette["leaf"];
            }

            if (n.Contains("wood") || n.Contains("bark"))
                return n.Contains("dark") ? _palette["barkDark"] : _palette["bark"];
            if (n.Contains("stone") || n.Contains("rock") || n.Contains("cliff") || n.Contains("dirt"))
                return n.Contains("dark") ? _palette["stoneDark"] : _palette["stone"];
            if (n.Contains("purple")) return _palette["flowerPurple"];
            if (n.Contains("yellow")) return _palette["flowerYellow"];
            if (n.Contains("red") && n.Contains("mushroom")) return _palette["mushroomRed"];
            if (n.Contains("mushroom") || n.Contains("tan")) return _palette["mushroomTan"];
            if (n.Contains("red")) return _palette["flowerRed"];
            return _palette["leaf"];
        }

        static List<GameObject> BuildPrefabs(string folder, IEnumerable<string> names)
        {
            var dest = $"{PrefabRoot}/{folder}";
            EnsureFolder(dest);
            var list = new List<GameObject>();
            foreach (var name in names)
            {
                var fbxPath = $"{FbxRoot}/{name}.fbx";
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
                if (model == null)
                {
                    Debug.LogWarning($"[CommandWarfare] Missing Kenney FBX: {fbxPath}");
                    continue;
                }

                var instance = Object.Instantiate(model);
                instance.name = name;
                StripColliders(instance);
                NormalizePivotToGround(instance);
                RemapMaterials(instance);

                var prefabPath = $"{dest}/{name}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
                Object.DestroyImmediate(instance);
                if (prefab != null) list.Add(prefab);
            }

            return list;
        }

        static List<GameObject> BuildVolcanicPrefabs()
        {
            var dest = $"{PrefabRoot}/Volcanic";
            EnsureFolder(dest);
            var mats = new[] { _palette["lavaDark"], _palette["lavaGlow"], _palette["lavaCrust"] };

            var list = new List<GameObject>();
            for (var i = 0; i < VolcanicSourceRocks.Length; i++)
            {
                var name = VolcanicSourceRocks[i];
                var fbxPath = $"{FbxRoot}/{name}.fbx";
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
                if (model == null) continue;

                var instance = Object.Instantiate(model);
                instance.name = $"lava_{name}";
                StripColliders(instance);
                NormalizePivotToGround(instance);
                ApplyMaterialRecursive(instance, mats[i % mats.Length]);

                var prefabPath = $"{dest}/lava_{name}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
                Object.DestroyImmediate(instance);
                if (prefab != null) list.Add(prefab);
            }

            return list;
        }

        static void RemapMaterials(GameObject go)
        {
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var shared = r.sharedMaterials;
                for (var i = 0; i < shared.Length; i++)
                    shared[i] = Remap(shared[i]);
                r.sharedMaterials = shared;
            }
        }

        static void ApplyMaterialRecursive(GameObject go, Material mat)
        {
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                r.sharedMaterial = mat;
        }

        static void NormalizePivotToGround(GameObject root)
        {
            root.transform.position = Vector3.zero;
            root.transform.rotation = Quaternion.identity;
            root.transform.localScale = Vector3.one;

            var renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return;

            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);

            var lift = -bounds.min.y;
            if (Mathf.Abs(lift) < 0.0001f) return;
            foreach (Transform child in root.transform)
                child.position += Vector3.up * lift;
        }

        static void StripColliders(GameObject go)
        {
            foreach (var col in go.GetComponentsInChildren<Collider>(true))
                Object.DestroyImmediate(col);
        }

        static void AssignArray(SerializedObject so, string field, List<GameObject> prefabs)
        {
            var prop = so.FindProperty(field);
            if (prop == null || !prop.isArray) return;
            prop.arraySize = prefabs.Count;
            for (var i = 0; i < prefabs.Count; i++)
                prop.GetArrayElementAtIndex(i).objectReferenceValue = prefabs[i];
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parts = path.Split('/');
            var cur = parts[0];
            for (var i = 1; i < parts.Length; i++)
            {
                var next = $"{cur}/{parts[i]}";
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }
    }
}
