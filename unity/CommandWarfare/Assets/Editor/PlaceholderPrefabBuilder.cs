using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Builds primitive placeholder prefabs and wires them into Terrain/Unit catalogs
    /// until Asset Store meshes are assigned.
    /// </summary>
    public static class PlaceholderPrefabBuilder
    {
        const string PrefabRoot = "Assets/Prefabs/Generated";
        const string TerrainCatalogPath = "Assets/Data/TerrainAssetCatalog.asset";
        const string UnitCatalogPath = "Assets/Data/UnitAssetCatalog.asset";

        [MenuItem("CommandWarfare/Generate Placeholder Prefabs")]
        public static void Generate()
        {
            EnsureFolder("Assets/Prefabs");
            EnsureFolder(PrefabRoot);

            var tree = SavePrimitivePrefab("CW_Tree", PrimitiveType.Cylinder, new Color(0.2f, 0.45f, 0.2f), new Vector3(0.4f, 0.9f, 0.4f));
            var peak = SavePrimitivePrefab("CW_Peak", PrimitiveType.Cylinder, new Color(0.5f, 0.5f, 0.55f), new Vector3(0.5f, 1.2f, 0.5f));
            var rock = SavePrimitivePrefab("CW_Rock", PrimitiveType.Sphere, new Color(0.62f, 0.55f, 0.42f), new Vector3(0.45f, 0.3f, 0.45f));
            var reed = SavePrimitivePrefab("CW_Reed", PrimitiveType.Cylinder, new Color(0.28f, 0.42f, 0.22f), new Vector3(0.08f, 0.55f, 0.08f));
            var volcanic = SavePrimitivePrefab("CW_Volcanic", PrimitiveType.Cylinder, new Color(0.32f, 0.14f, 0.1f), new Vector3(0.4f, 0.45f, 0.4f));

            var commander = SavePrimitivePrefab("CW_Commander", PrimitiveType.Cylinder, new Color(0.85f, 0.75f, 0.35f), new Vector3(0.7f, 0.25f, 0.7f));
            var officer = SavePrimitivePrefab("CW_Officer", PrimitiveType.Capsule, new Color(0.75f, 0.55f, 0.25f), new Vector3(0.5f, 0.4f, 0.5f));
            var unit = SavePrimitivePrefab("CW_Unit", PrimitiveType.Capsule, new Color(0.55f, 0.6f, 0.7f), new Vector3(0.42f, 0.35f, 0.42f));

            var human = SavePrimitivePrefab("CW_Human", PrimitiveType.Capsule, new Color(0.35f, 0.55f, 0.85f), new Vector3(0.42f, 0.35f, 0.42f));
            var dwarf = SavePrimitivePrefab("CW_Dwarf", PrimitiveType.Capsule, new Color(0.75f, 0.45f, 0.25f), new Vector3(0.42f, 0.32f, 0.42f));
            var elf = SavePrimitivePrefab("CW_Elf", PrimitiveType.Capsule, new Color(0.35f, 0.75f, 0.45f), new Vector3(0.4f, 0.38f, 0.4f));
            var undead = SavePrimitivePrefab("CW_Undead", PrimitiveType.Capsule, new Color(0.55f, 0.7f, 0.55f), new Vector3(0.42f, 0.35f, 0.42f));
            var demon = SavePrimitivePrefab("CW_Demon", PrimitiveType.Capsule, new Color(0.75f, 0.2f, 0.25f), new Vector3(0.44f, 0.36f, 0.44f));
            var dragon = SavePrimitivePrefab("CW_Dragon", PrimitiveType.Capsule, new Color(0.85f, 0.35f, 0.15f), new Vector3(0.5f, 0.4f, 0.5f));
            var beast = SavePrimitivePrefab("CW_Beastfolk", PrimitiveType.Capsule, new Color(0.65f, 0.5f, 0.3f), new Vector3(0.44f, 0.34f, 0.44f));
            var lizard = SavePrimitivePrefab("CW_Lizardmen", PrimitiveType.Capsule, new Color(0.25f, 0.65f, 0.4f), new Vector3(0.42f, 0.34f, 0.42f));
            var construct = SavePrimitivePrefab("CW_Construct", PrimitiveType.Capsule, new Color(0.55f, 0.55f, 0.6f), new Vector3(0.45f, 0.36f, 0.45f));

            HexBoardBootstrap.CreateAssetCatalogs();
            var terrain = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>(TerrainCatalogPath);
            var units = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>(UnitCatalogPath);

            if (terrain != null)
            {
                var so = new SerializedObject(terrain);
                AssignArray(so, "treePrefabs", tree);
                AssignArray(so, "peakPrefabs", peak);
                AssignArray(so, "rockPrefabs", rock);
                AssignArray(so, "reedPrefabs", reed);
                AssignArray(so, "volcanicPrefabs", volcanic);
                so.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(terrain);
            }

            if (units != null)
            {
                var so = new SerializedObject(units);
                so.FindProperty("commanderPrefab").objectReferenceValue = commander;
                so.FindProperty("officerPrefab").objectReferenceValue = officer;
                so.FindProperty("unitPrefab").objectReferenceValue = unit;
                so.FindProperty("humanUnitPrefab").objectReferenceValue = human;
                so.FindProperty("dwarfUnitPrefab").objectReferenceValue = dwarf;
                so.FindProperty("elfUnitPrefab").objectReferenceValue = elf;
                so.FindProperty("undeadUnitPrefab").objectReferenceValue = undead;
                so.FindProperty("demonUnitPrefab").objectReferenceValue = demon;
                so.FindProperty("dragonUnitPrefab").objectReferenceValue = dragon;
                so.FindProperty("beastfolkUnitPrefab").objectReferenceValue = beast;
                so.FindProperty("lizardmenUnitPrefab").objectReferenceValue = lizard;
                so.FindProperty("constructUnitPrefab").objectReferenceValue = construct;
                so.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(units);
            }

            AssetDatabase.SaveAssets();
            Debug.Log("[CommandWarfare] Generated placeholder prefabs under Assets/Prefabs/Generated and assigned catalogs.");
        }

        static void AssignArray(SerializedObject so, string field, GameObject prefab)
        {
            var prop = so.FindProperty(field);
            if (prop == null || !prop.isArray) return;
            prop.arraySize = 1;
            prop.GetArrayElementAtIndex(0).objectReferenceValue = prefab;
        }

        static GameObject SavePrimitivePrefab(string name, PrimitiveType type, Color color, Vector3 scale)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.localScale = scale;
            var col = go.GetComponent<Collider>();
            if (col != null) Object.DestroyImmediate(col);
            var renderer = go.GetComponent<Renderer>();
            if (renderer != null)
            {
                var mat = TerrainMaterialFactory.CreateTileInstance(color);
                var matPath = $"{PrefabRoot}/{name}.mat";
                AssetDatabase.CreateAsset(mat, matPath);
                renderer.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>(matPath);
            }

            var path = $"{PrefabRoot}/{name}.prefab";
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            return prefab;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = path.Substring(0, path.LastIndexOf('/'));
            var leaf = path.Substring(path.LastIndexOf('/') + 1);
            AssetDatabase.CreateFolder(parent, leaf);
        }
    }
}
