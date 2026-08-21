using System.Collections.Generic;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Builds room-decor prefabs from Kenney Furniture Kit + Castle Kit (CC0)
    /// and wires RoomDecorCatalog. Same pipeline as terrain scatter.
    /// </summary>
    public static class KenneyRoomDecorSetup
    {
        const string FurnFbx = "Assets/Art/Environment/KenneyFurnitureKit/Models";
        const string CastleFbx = "Assets/Art/Environment/KenneyCastleKit/Models";
        const string PrefabRoot = "Assets/Prefabs/Room/Kenney";
        const string CatalogPath = "Assets/Data/RoomDecorCatalog.asset";
        const string ResourcesCatalogPath = "Assets/Resources/RoomDecorCatalog.asset";

        static readonly string[] BookcaseNames =
            { "bookcaseOpen", "bookcaseOpenLow", "bookcaseClosedWide" };
        static readonly string[] DeskNames = { "desk", "sideTable", "sideTableDrawers", "tableCoffee" };
        static readonly string[] ChairNames = { "chair", "chairDesk" };
        static readonly string[] BenchNames = { "bench" };
        static readonly string[] PlantNames = { "pottedPlant", "plantSmall1", "plantSmall2" };
        static readonly string[] LampNames = { "lampRoundFloor", "lampSquareFloor" };
        static readonly string[] RugNames = { "rugRectangle", "rugRound" };
        static readonly string[] SoftNames = { "loungeSofa", "loungeChair" };
        static readonly string[] BannerNames =
            { "flag-banner-long", "flag-banner-short", "flag-wide", "flag-pennant", "flag" };
        static readonly string[] AccentNames = { "books", "bear", "cabinetBedDrawerTable", "door", "wall-pillar" };

        [MenuItem("CommandWarfare/Room/Wire Kenney Room Decor")]
        public static void Wire()
        {
            EnsureFolder("Assets/Prefabs");
            EnsureFolder("Assets/Prefabs/Room");
            EnsureFolder(PrefabRoot);
            EnsureFolder("Assets/Data");
            EnsureFolder("Assets/Resources");

            var catalog = AssetDatabase.LoadAssetAtPath<RoomDecorCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<RoomDecorCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }

            catalog.Bookcases = BuildPrefabs("Bookcases", BookcaseNames, FurnFbx);
            catalog.Desks = BuildPrefabs("Desks", DeskNames, FurnFbx);
            catalog.Chairs = BuildPrefabs("Chairs", ChairNames, FurnFbx);
            catalog.Benches = BuildPrefabs("Benches", BenchNames, FurnFbx);
            catalog.Plants = BuildPrefabs("Plants", PlantNames, FurnFbx);
            catalog.Lamps = BuildPrefabs("Lamps", LampNames, FurnFbx);
            catalog.Rugs = BuildPrefabs("Rugs", RugNames, FurnFbx);
            catalog.SoftSeating = BuildPrefabs("SoftSeating", SoftNames, FurnFbx);
            catalog.Banners = BuildPrefabs("Banners", BannerNames, CastleFbx);
            catalog.Accents = BuildPrefabs("Accents", AccentNames, FurnFbx, CastleFbx);

            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();

            // Runtime-friendly copy for Resources.Load
            var existing = AssetDatabase.LoadAssetAtPath<RoomDecorCatalog>(ResourcesCatalogPath);
            if (existing != null)
                AssetDatabase.DeleteAsset(ResourcesCatalogPath);
            AssetDatabase.CopyAsset(CatalogPath, ResourcesCatalogPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log(
                $"[CommandWarfare] Room decor wired — bookcases:{catalog.Bookcases.Length} " +
                $"desks:{catalog.Desks.Length} banners:{catalog.Banners.Length} " +
                $"plants:{catalog.Plants.Length}");
        }

        static GameObject[] BuildPrefabs(string folder, string[] names, params string[] fbxRoots)
        {
            var dir = $"{PrefabRoot}/{folder}";
            EnsureFolder(dir);
            var list = new List<GameObject>();
            foreach (var name in names)
            {
                string fbxPath = null;
                foreach (var root in fbxRoots)
                {
                    var candidate = $"{root}/{name}.fbx";
                    if (AssetDatabase.LoadAssetAtPath<GameObject>(candidate) != null)
                    {
                        fbxPath = candidate;
                        break;
                    }
                }

                if (fbxPath == null)
                {
                    Debug.LogWarning($"[CommandWarfare] Missing room FBX: {name}");
                    continue;
                }

                var source = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
                if (source == null)
                {
                    Debug.LogWarning($"[CommandWarfare] Could not load FBX: {fbxPath}");
                    continue;
                }

                var instance = Object.Instantiate(source);
                instance.name = name;
                StripCamerasAndLights(instance);
                var prefabPath = $"{dir}/{name}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
                Object.DestroyImmediate(instance);
                if (prefab != null)
                    list.Add(prefab);
            }
            return list.ToArray();
        }

        static void StripCamerasAndLights(GameObject go)
        {
            foreach (var c in go.GetComponentsInChildren<Camera>(true))
                Object.DestroyImmediate(c);
            foreach (var l in go.GetComponentsInChildren<Light>(true))
                Object.DestroyImmediate(l);
            foreach (var col in go.GetComponentsInChildren<Collider>(true))
                Object.DestroyImmediate(col);
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
