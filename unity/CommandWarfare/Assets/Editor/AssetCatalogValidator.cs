using System.IO;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>Validates Unity data exports + placeholder catalogs for the asset pipeline.</summary>
    public static class AssetCatalogValidator
    {
        static readonly string[] RequiredJson =
        {
            "Assets/Data/cards-unity.json",
            "Assets/Data/abilities-unity.json",
            "Assets/Data/keywords-unity.json",
            "Assets/Data/quick-pick-armies-unity.json",
            "Assets/Data/commanderEffectAliases.json",
            "Assets/Data/rulebook-unity.json",
        };

        [MenuItem("CommandWarfare/Validate Asset Catalogs")]
        public static void Validate()
        {
            var ok = true;
            ok &= ValidateJsonExports();

            var terrain = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>("Assets/Data/TerrainAssetCatalog.asset");
            var units = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>("Assets/Data/UnitAssetCatalog.asset");

            if (terrain == null)
            {
                Debug.LogWarning("[CommandWarfare] Missing Assets/Data/TerrainAssetCatalog.asset — run Create Asset Catalogs.");
                ok = false;
            }
            else
                LogTerrainCatalog(terrain);

            if (terrain != null)
            {
                var albedo = terrain.AssignedAlbedoCount();
                Debug.Log(albedo > 0
                    ? $"[CommandWarfare] Terrain albedo textures assigned: {albedo}/8"
                    : "[CommandWarfare] No terrain albedo textures — run Generate Procedural Terrain Textures (or assign art).");
            }

            if (units == null)
            {
                Debug.LogWarning("[CommandWarfare] Missing Assets/Data/UnitAssetCatalog.asset — run Create Asset Catalogs.");
                ok = false;
            }
            else
                ok &= LogUnitCatalog(units);

            // Smoke-load cards JSON into a runtime database.
            var cardsJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Data/cards-unity.json");
            if (cardsJson != null)
            {
                var db = CardJsonLoader.BuildDatabase(cardsJson);
                var count = db?.All?.Count ?? 0;
                if (count == 0)
                {
                    Debug.LogError("[CommandWarfare] cards-unity.json loaded but CardDatabase is empty.");
                    ok = false;
                }
                else
                    Debug.Log($"[CommandWarfare] CardJsonLoader OK — {count} cards.");
            }

            Debug.Log(ok
                ? "[CommandWarfare] Asset pipeline validation passed."
                : "[CommandWarfare] Asset pipeline validation found issues — see logs above.");
        }

        static bool ValidateJsonExports()
        {
            var ok = true;
            foreach (var path in RequiredJson)
            {
                var abs = Path.GetFullPath(path);
                var text = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
                if (text == null || string.IsNullOrWhiteSpace(text.text))
                {
                    Debug.LogError($"[CommandWarfare] Missing/empty export: {path}");
                    ok = false;
                }
                else
                    Debug.Log($"[CommandWarfare] Export OK: {path} ({text.text.Length} chars)");
            }
            return ok;
        }

        static void LogTerrainCatalog(TerrainAssetCatalog catalog)
        {
            var trees = catalog.treePrefabs?.Length ?? 0;
            var peaks = catalog.peakPrefabs?.Length ?? 0;
            var rocks = catalog.rockPrefabs?.Length ?? 0;
            var reeds = catalog.reedPrefabs?.Length ?? 0;
            var volcanic = catalog.volcanicPrefabs?.Length ?? 0;
            Debug.Log($"[CommandWarfare] TerrainAssetCatalog — trees:{trees} peaks:{peaks} rocks:{rocks} reeds:{reeds} volcanic:{volcanic}" +
                      ((trees + peaks + rocks + reeds + volcanic) == 0
                          ? " (all empty — procedural scatter fallback)"
                          : ""));
        }

        static bool LogUnitCatalog(UnitAssetCatalog catalog)
        {
            var missing = 0;
            missing += LogSlot("commanderPrefab", catalog.commanderPrefab);
            missing += LogSlot("officerPrefab", catalog.officerPrefab);
            missing += LogSlot("unitPrefab", catalog.unitPrefab);
            if (missing == 0)
            {
                Debug.Log("[CommandWarfare] UnitAssetCatalog fully assigned.");
                return true;
            }
            Debug.LogWarning($"[CommandWarfare] UnitAssetCatalog: {missing} core slot(s) empty — procedural tokens used.");
            return true; // empty slots are warned, not hard-fail (procedural fallback OK)
        }

        static int LogSlot(string name, Object prefab)
        {
            if (prefab != null) return 0;
            Debug.Log($"  · {name} — (empty)");
            return 1;
        }
    }
}
