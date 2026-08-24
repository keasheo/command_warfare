using CommandWarfare.Board;
using CommandWarfare.Data;
using CommandWarfare.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    public static class HexBoardBootstrap
    {
        const string CardsJsonPath = "Assets/Data/cards-unity.json";
        const string AbilitiesJsonPath = "Assets/Data/abilities-unity.json";
        const string AliasesJsonPath = "Assets/Data/commanderEffectAliases.json";
        const string QuickPickArmiesPath = "Assets/Data/quick-pick-armies-unity.json";
        const string RulebookJsonPath = "Assets/Data/rulebook-unity.json";

        [MenuItem("CommandWarfare/Bootstrap Skirmish Scene")]
        public static void BootstrapSkirmishScene()
        {
            var boardGo = GameObject.Find("HexBoard");
            if (boardGo == null)
            {
                boardGo = new GameObject("HexBoard");
                if (!Application.isPlaying)
                    Undo.RegisterCreatedObjectUndo(boardGo, "Create HexBoard");
            }

            EnsureComponent<HexBoardBuilder>(boardGo);
            EnsureComponent<BoardInputController>(boardGo);
            EnsureComponent<DeployZoneVisualizer>(boardGo);
            EnsureComponent<ObjectiveVisualizer>(boardGo);
            EnsureComponent<BoardGameController>(boardGo);
            EnsureComponent<SkirmishHud>(boardGo);
            EnsureComponent<SkirmishAi>(boardGo);

            var netClient = EnsureComponent<PlaySocketClient>(boardGo);
            var netBridge = EnsureComponent<PlayNetworkBridge>(boardGo);
            var netHud = EnsureComponent<PlayNetworkHud>(boardGo);
            netBridge.NetworkMode = false;
            netHud.enabled = false;

            WireTextAsset(netHud, "_quickPickArmiesJson", QuickPickArmiesPath,
                "npm run export:unity:armies");

            var flow = EnsureComponent<CommandWarfare.UI.GameFlowController>(boardGo);
            EnsureComponent<CommandWarfare.UI.MenuBackdrop3D>(boardGo);
            WireTextAsset(flow, "_rulebookJson", RulebookJsonPath,
                "node unity/CommandWarfare/scripts/exportRulebookJson.mjs");
            WireTextAsset(flow, "_quickPickArmiesJson", QuickPickArmiesPath, null);

            var controller = boardGo.GetComponent<BoardGameController>();
            var json = AssetDatabase.LoadAssetAtPath<TextAsset>(CardsJsonPath);
            if (json != null)
            {
                var so = new SerializedObject(controller);
                so.FindProperty("_cardsJson").objectReferenceValue = json;
                // Clear stale empty CardDatabase.asset so runtime rebuilds from JSON.
                so.FindProperty("_cardDatabase").objectReferenceValue = null;
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            else
            {
                Debug.LogWarning($"[CommandWarfare] Missing {CardsJsonPath}. Run: node unity/CommandWarfare/scripts/exportCardsJson.mjs");
            }

            WireTextAsset(controller, "_abilitiesJson", AbilitiesJsonPath,
                "node unity/CommandWarfare/scripts/exportAbilitiesJson.mjs");
            WireTextAsset(controller, "_abilityAliasesJson", AliasesJsonPath, null);

            var terrainCatalog = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>("Assets/Data/TerrainAssetCatalog.asset");
            var unitCatalog = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>("Assets/Data/UnitAssetCatalog.asset");
            if (terrainCatalog == null || unitCatalog == null)
            {
                CreateAssetCatalogs();
                terrainCatalog = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>("Assets/Data/TerrainAssetCatalog.asset");
                unitCatalog = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>("Assets/Data/UnitAssetCatalog.asset");
            }
            if (unitCatalog != null && unitCatalog.unitPrefab == null)
            {
                PlaceholderPrefabBuilder.Generate();
                unitCatalog = AssetDatabase.LoadAssetAtPath<UnitAssetCatalog>("Assets/Data/UnitAssetCatalog.asset");
                terrainCatalog = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>("Assets/Data/TerrainAssetCatalog.asset");
            }

            var builder = boardGo.GetComponent<HexBoardBuilder>();
            {
                var so = new SerializedObject(builder);
                so.FindProperty("_terrainCatalog").objectReferenceValue = terrainCatalog;
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            {
                var so = new SerializedObject(controller);
                so.FindProperty("_unitCatalog").objectReferenceValue = unitCatalog;
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            {
                var so = new SerializedObject(flow);
                so.FindProperty("_unitCatalog").objectReferenceValue = unitCatalog;
                so.ApplyModifiedPropertiesWithoutUndo();
            }

            var cam = Camera.main;
            if (cam != null)
            {
                var ctrl = cam.GetComponent<BoardCameraController>();
                if (ctrl == null)
                    ctrl = Application.isPlaying
                        ? cam.gameObject.AddComponent<BoardCameraController>()
                        : Undo.AddComponent<BoardCameraController>(cam.gameObject);
                ctrl.SetTarget(boardGo.transform);
                cam.transform.position = new Vector3(40f, 55f, -40f);
                cam.transform.LookAt(boardGo.transform);
                cam.farClipPlane = 800f;
            }

            boardGo.GetComponent<HexBoardBuilder>().Rebuild();
            boardGo.GetComponent<DeployZoneVisualizer>().RebuildOverlay();
            // Ensure BoardGameController can resolve HexBoardBuilder before edit-mode token sync.
            var boardBuilder = boardGo.GetComponent<HexBoardBuilder>();
            if (boardBuilder != null && controller != null)
            {
                controller.RestartSkirmish();
            }

            flow.EnterTitle();

            if (!Application.isPlaying)
                EditorSceneManager.MarkSceneDirty(UnityEngine.SceneManagement.SceneManager.GetActiveScene());
            Debug.Log("[CommandWarfare] Scene bootstrapped — Title screen ready. Prefer opening Assets/Scenes/MainMenu (Build index 0). Use CommandWarfare/Create Game Scenes if missing.");
        }

        [MenuItem("CommandWarfare/Create Asset Catalogs")]
        public static void CreateAssetCatalogs()
        {
            CreateCatalog<TerrainAssetCatalog>("Assets/Data/TerrainAssetCatalog.asset");
            CreateCatalog<UnitAssetCatalog>("Assets/Data/UnitAssetCatalog.asset");
            AssetDatabase.SaveAssets();
            Debug.Log("[CommandWarfare] Created TerrainAssetCatalog + UnitAssetCatalog under Assets/Data/");
        }

        static void CreateCatalog<T>(string path) where T : ScriptableObject
        {
            if (AssetDatabase.LoadAssetAtPath<T>(path) != null) return;
            var asset = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(asset, path);
        }

        static void WireTextAsset(Component target, string field, string path, string exportHint)
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
            if (asset == null)
            {
                if (exportHint != null)
                    Debug.LogWarning($"[CommandWarfare] Missing {path}. Run: {exportHint}");
                return;
            }
            var so = new SerializedObject(target);
            so.FindProperty(field).objectReferenceValue = asset;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void WireTextAsset(BoardGameController controller, string field, string path, string exportHint) =>
            WireTextAsset((Component)controller, field, path, exportHint);

        static T EnsureComponent<T>(GameObject go) where T : Component
        {
            var c = go.GetComponent<T>();
            if (c != null) return c;
            if (Application.isPlaying)
                return go.AddComponent<T>();
            return Undo.AddComponent<T>(go);
        }
    }
}
