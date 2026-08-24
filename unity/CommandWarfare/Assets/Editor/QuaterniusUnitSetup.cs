using System.IO;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Builds race unit prefabs from Quaternius CC0 FBX under Art/Units/Quaternius
    /// and wires UnitAssetCatalog. Constructs stay procedural (no mesh assigned).
    /// </summary>
    public static class QuaterniusUnitSetup
    {
        const string ArtRoot = "Assets/Art/Units/Quaternius";
        const string PrefabRoot = "Assets/Prefabs/Units";
        const string CatalogPath = "Assets/Data/UnitAssetCatalog.asset";

        [MenuItem("Command Warfare/Units/Wire Quaternius Race Models")]
        public static void Wire()
        {
            EnsureFolder("Assets/Prefabs");
            EnsureFolder(PrefabRoot);
            AssetDatabase.Refresh();

            var human = MakePrefab("Human", FirstFbx($"{ArtRoot}/Human"));
            var humanCmd = MakePrefab("HumanCommander", FirstFbx($"{ArtRoot}/HumanCmd")) ?? human;
            var humanOff = MakePrefab("HumanOfficer", FirstFbx($"{ArtRoot}/HumanOff")) ?? human;
            var dwarf = MakePrefab("Dwarf", FirstFbx($"{ArtRoot}/Dwarf"));
            var elf = MakePrefab("Elf", FirstFbx($"{ArtRoot}/Elf"));
            var elfCmd = MakePrefab("ElfCommander", FirstFbx($"{ArtRoot}/ElfCmd")) ?? elf;
            var undead = MakePrefab("Undead", FirstFbx($"{ArtRoot}/Undead"));
            var demon = MakePrefab("Demon", FirstFbx($"{ArtRoot}/Demon"));
            var dragon = MakePrefab("Dragon", FirstFbx($"{ArtRoot}/Dragon"));
            var beast = MakePrefab("Beastfolk", FirstFbx($"{ArtRoot}/Beastfolk"));
            var lizard = MakePrefab("Lizardman", FirstFbx($"{ArtRoot}/Lizardman"));

            var catalog = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>(CatalogPath);
            if (catalog == null)
            {
                Debug.LogError($"[CommandWarfare] Missing {CatalogPath}");
                return;
            }

            var so = new SerializedObject(catalog);
            Set(so, "humanUnitPrefab", human);
            Set(so, "humanCommanderPrefab", humanCmd);
            Set(so, "humanOfficerPrefab", humanOff);
            Set(so, "dwarfUnitPrefab", dwarf);
            Set(so, "dwarfCommanderPrefab", dwarf);
            Set(so, "dwarfOfficerPrefab", dwarf);
            Set(so, "elfUnitPrefab", elf);
            Set(so, "elfCommanderPrefab", elfCmd);
            Set(so, "elfOfficerPrefab", elf);
            Set(so, "undeadUnitPrefab", undead);
            Set(so, "undeadCommanderPrefab", undead);
            Set(so, "demonUnitPrefab", demon);
            Set(so, "demonCommanderPrefab", demon);
            Set(so, "dragonUnitPrefab", dragon);
            Set(so, "beastfolkUnitPrefab", beast);
            Set(so, "lizardmenUnitPrefab", lizard);
            // Constructs stay null → MiniFigureBuilder procedural look.
            Set(so, "constructUnitPrefab", null);
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();

            Debug.Log(
                "[CommandWarfare] Wired Quaternius race models into UnitAssetCatalog. " +
                "Constructs remain procedural. Re-enter play / rebuild tokens to see them.");
        }

        static void Set(SerializedObject so, string prop, Object value)
        {
            var p = so.FindProperty(prop);
            if (p != null) p.objectReferenceValue = value;
        }

        static string FirstFbx(string folder)
        {
            if (!AssetDatabase.IsValidFolder(folder) && !Directory.Exists(
                    Path.Combine(Directory.GetCurrentDirectory(), folder.Replace('/', Path.DirectorySeparatorChar))))
                return null;
            var guids = AssetDatabase.FindAssets("t:Model", new[] { folder });
            foreach (var g in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(g);
                if (path.EndsWith(".fbx", System.StringComparison.OrdinalIgnoreCase) ||
                    path.EndsWith(".obj", System.StringComparison.OrdinalIgnoreCase))
                    return path;
            }
            // Fallback filesystem scan before Unity finishes importing.
            var abs = Path.GetFullPath(folder);
            if (!Directory.Exists(abs)) return null;
            foreach (var f in Directory.GetFiles(abs, "*.fbx", SearchOption.AllDirectories))
            {
                var rel = "Assets" + f.Substring(Application.dataPath.Length).Replace('\\', '/');
                return rel;
            }
            return null;
        }

        static GameObject MakePrefab(string name, string modelPath)
        {
            if (string.IsNullOrEmpty(modelPath))
            {
                Debug.LogWarning($"[CommandWarfare] No model for {name}");
                return null;
            }

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null)
            {
                Debug.LogWarning($"[CommandWarfare] Could not load {modelPath}");
                return null;
            }

            var instance = Object.Instantiate(model);
            instance.name = name;
            // Feet on origin; strip colliders so board raycasts hit the token capsule.
            foreach (var col in instance.GetComponentsInChildren<Collider>(true))
                Object.DestroyImmediate(col);

            var prefabPath = $"{PrefabRoot}/{name}.prefab";
            var prefab = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
            Object.DestroyImmediate(instance);
            return prefab;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parts = path.Split('/');
            var cur = parts[0];
            for (var i = 1; i < parts.Length; i++)
            {
                var next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }
    }
}
