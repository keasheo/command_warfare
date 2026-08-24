using System.Collections.Generic;
using System.IO;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Builds room prefabs from Poly Haven CC0 photogrammetry furniture (realistic PBR)
    /// and wires RoomDecorCatalog. Prefer these over Kenney low-poly for the game hall.
    /// </summary>
    public static class PolyHavenRoomDecorSetup
    {
        const string ModelRoot = "Assets/Art/Environment/PolyHavenInterior";
        const string PrefabRoot = "Assets/Prefabs/Room/PolyHaven";
        const string MatRoot = "Assets/Prefabs/Room/PolyHaven/Materials";
        const string CatalogPath = "Assets/Data/RoomDecorCatalog.asset";
        const string ResourcesCatalogPath = "Assets/Resources/RoomDecorCatalog.asset";

        static readonly string[] BookcaseIds = { "GothicCabinet_01", "Shelf_01", "painted_wooden_cabinet_02" };
        static readonly string[] DeskIds = { "WoodenTable_01", "WoodenTable_02", "gothic_coffee_table", "ClassicConsole_01", "side_table_tall_01" };
        static readonly string[] ChairIds = { "WoodenChair_01", "GreenChair_01", "ArmChair_01" };
        static readonly string[] BenchIds = { "gothic_coffee_table" }; // fallback seating surface if no bench
        static readonly string[] SoftIds = { "ArmChair_01" };
        static readonly string[] AccentIds = { "GothicCommode_01", "ornate_mirror_01", "ClassicConsole_01" };
        static readonly string[] LampIds = { }; // sconces stay procedural
        static readonly string[] PlantIds = { };
        static readonly string[] RugIds = { };
        static readonly string[] BannerIds = { };

        [MenuItem("CommandWarfare/Room/Wire Poly Haven Realistic Decor")]
        public static void Wire()
        {
            EnsureFolder("Assets/Prefabs");
            EnsureFolder("Assets/Prefabs/Room");
            EnsureFolder(PrefabRoot);
            EnsureFolder(MatRoot);
            EnsureFolder("Assets/Data");
            EnsureFolder("Assets/Resources");

            var catalog = AssetDatabase.LoadAssetAtPath<RoomDecorCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoomDecorCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }

            catalog.Bookcases = BuildPrefabs("Bookcases", BookcaseIds);
            catalog.Desks = BuildPrefabs("Desks", DeskIds);
            catalog.Chairs = BuildPrefabs("Chairs", ChairIds);
            catalog.Benches = BuildPrefabs("Benches", BenchIds);
            catalog.SoftSeating = BuildPrefabs("SoftSeating", SoftIds);
            catalog.Accents = BuildPrefabs("Accents", AccentIds);
            // Keep Kenney banners/plants/lamps/rugs if already wired; don't wipe if empty PH lists
            if (catalog.Banners == null) catalog.Banners = new GameObject[0];
            if (catalog.Plants == null) catalog.Plants = new GameObject[0];
            if (catalog.Lamps == null) catalog.Lamps = new GameObject[0];
            if (catalog.Rugs == null) catalog.Rugs = new GameObject[0];

            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();

            if (AssetDatabase.LoadAssetAtPath<RoomDecorCatalog>(ResourcesCatalogPath) != null)
                AssetDatabase.DeleteAsset(ResourcesCatalogPath);
            AssetDatabase.CopyAsset(CatalogPath, ResourcesCatalogPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log(
                $"[CommandWarfare] Poly Haven decor wired — bookcases:{catalog.Bookcases.Length} " +
                $"desks:{catalog.Desks.Length} chairs:{catalog.Chairs.Length} accents:{catalog.Accents.Length}");
        }

        static GameObject[] BuildPrefabs(string folder, string[] ids)
        {
            var dir = $"{PrefabRoot}/{folder}";
            EnsureFolder(dir);
            var list = new List<GameObject>();
            foreach (var id in ids)
            {
                var fbxPath = $"{ModelRoot}/{id}/{id}.fbx";
                var source = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
                if (source == null)
                {
                    Debug.LogWarning($"[CommandWarfare] Missing Poly Haven FBX: {fbxPath}");
                    continue;
                }

                var instance = Object.Instantiate(source);
                instance.name = id;
                foreach (var col in instance.GetComponentsInChildren<Collider>(true))
                    Object.DestroyImmediate(col);
                foreach (var cam in instance.GetComponentsInChildren<Camera>(true))
                    Object.DestroyImmediate(cam);
                foreach (var light in instance.GetComponentsInChildren<Light>(true))
                    Object.DestroyImmediate(light);

                ApplyPbrMaterials(instance, id);

                var prefabPath = $"{dir}/{id}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
                Object.DestroyImmediate(instance);
                if (prefab != null)
                    list.Add(prefab);
            }
            return list.ToArray();
        }

        static void ApplyPbrMaterials(GameObject root, string id)
        {
            var texDir = $"{ModelRoot}/{id}/textures";
            var diff = FindTex(texDir, "_diff_");
            var nor = FindTex(texDir, "_nor_");
            var arm = FindTex(texDir, "_arm_");
            var rough = FindTex(texDir, "_rough");

            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            if (shader == null) return;

            var mat = new Material(shader);
            mat.name = id + "_PBR";
            if (diff != null)
            {
                mat.SetTexture("_BaseMap", diff);
                mat.SetTexture("_MainTex", diff);
                mat.color = Color.white;
                if (mat.HasProperty("_BaseColor"))
                    mat.SetColor("_BaseColor", Color.white);
            }
            if (nor != null)
            {
                mat.SetTexture("_BumpMap", nor);
                mat.EnableKeyword("_NORMALMAP");
                if (mat.HasProperty("_BumpScale"))
                    mat.SetFloat("_BumpScale", 1f);
            }
            if (arm != null)
            {
                // Poly Haven ARM: Ao / Rough / Metal packed — feed as metallic gloss map approx
                mat.SetTexture("_MetallicGlossMap", arm);
                mat.EnableKeyword("_METALLICSPECGLOSSMAP");
                if (mat.HasProperty("_Smoothness"))
                    mat.SetFloat("_Smoothness", 0.55f);
            }
            else if (rough != null)
            {
                mat.SetTexture("_MetallicGlossMap", rough);
                if (mat.HasProperty("_Smoothness"))
                    mat.SetFloat("_Smoothness", 0.45f);
            }
            else if (mat.HasProperty("_Smoothness"))
            {
                mat.SetFloat("_Smoothness", 0.35f);
            }

            var matPath = $"{MatRoot}/{id}_PBR.mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(matPath);
            if (existing != null)
                AssetDatabase.DeleteAsset(matPath);
            AssetDatabase.CreateAsset(mat, matPath);

            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                r.sharedMaterial = mat;
        }

        static Texture2D FindTex(string texDir, string token)
        {
            if (!AssetDatabase.IsValidFolder(texDir.Replace('\\', '/')))
            {
                // folder may exist on disk but not yet imported as folder asset
            }
            if (!Directory.Exists(texDir)) return null;
            foreach (var file in Directory.GetFiles(texDir))
            {
                var name = Path.GetFileName(file);
                if (name.EndsWith(".meta")) continue;
                if (!name.Contains(token) && !(token == "_diff_" && name.Contains("_diff"))) continue;
                var assetPath = file.Replace('\\', '/');
                var idx = assetPath.IndexOf("Assets/");
                if (idx >= 0) assetPath = assetPath.Substring(idx);
                return AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            }
            // fallback: any jpg
            foreach (var file in Directory.GetFiles(texDir, "*.jpg"))
            {
                var assetPath = file.Replace('\\', '/');
                var idx = assetPath.IndexOf("Assets/");
                if (idx >= 0) assetPath = assetPath.Substring(idx);
                return AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            }
            return null;
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
