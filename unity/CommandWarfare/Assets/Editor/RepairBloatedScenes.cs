using System.IO;
using CommandWarfare.Board;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Rebuilds lean MainMenu / ArmyBuilder / Battle / SampleScene after procedural
    /// board geometry was accidentally serialized into the .unity files (40MB+ YAML,
    /// truncated Battle.unity, "Transform child can't be loaded" spam).
    /// </summary>
    public static class RepairBloatedScenes
    {
        const string BattlePath = "Assets/Scenes/Battle.unity";
        const string MainMenuPath = "Assets/Scenes/MainMenu.unity";
        const string ArmyBuilderPath = "Assets/Scenes/ArmyBuilder.unity";
        const string SamplePath = "Assets/Scenes/SampleScene.unity";

        [MenuItem("CommandWarfare/Repair Bloated Scenes (rebuild lean)")]
        public static void RepairAll()
        {
            if (!EditorUtility.DisplayDialog(
                    "Repair Bloated Scenes",
                    "This strips serialized board geometry from Battle and copies a lean " +
                    "scene to SampleScene / MainMenu / ArmyBuilder.\n\n" +
                    "Unsaved scene changes will be lost. Continue?",
                    "Rebuild",
                    "Cancel"))
                return;

            RepairAllSilent();
        }

        /// <summary>Same as menu item without confirmation dialog (for automation).</summary>
        public static void RepairAllSilent()
        {
            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                Debug.LogError("[CommandWarfare] Exit Play Mode before repairing scenes.");
                return;
            }

            WriteLeanBattleFromScratch();
            PropagateFromBattle();

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(MainMenuPath, true),
                new EditorBuildSettingsScene(ArmyBuilderPath, true),
                new EditorBuildSettingsScene(BattlePath, true),
                new EditorBuildSettingsScene(SamplePath, true),
            };

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            EditorSceneManager.OpenScene(BattlePath, OpenSceneMode.Single);
            Debug.Log("[CommandWarfare] Lean scenes rebuilt. Open Battle and use Rebuild Board if needed.");
        }

        static void WriteLeanBattleFromScratch()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            HexBoardBootstrap.BootstrapSkirmishScene();
            ParkDirectionalLights();
            StripGeneratedBoardArtifacts();
            EnsureCleanCombatFx();

            if (File.Exists(Path.GetFullPath(BattlePath)))
                AssetDatabase.DeleteAsset(BattlePath);

            EditorSceneManager.SaveScene(scene, BattlePath);
            Debug.Log($"[CommandWarfare] Wrote lean {BattlePath} ({new FileInfo(Path.GetFullPath(BattlePath)).Length} bytes)");
        }

        static void PropagateFromBattle()
        {
            var battleFull = Path.GetFullPath(BattlePath);
            File.Copy(battleFull, Path.GetFullPath(SamplePath), true);
            File.Copy(battleFull, Path.GetFullPath(ArmyBuilderPath), true);
            File.Copy(battleFull, Path.GetFullPath(MainMenuPath), true);
            AssetDatabase.Refresh();

            ConfigureMenuScene(ArmyBuilderPath, startAtTitle: false);
            ConfigureMenuScene(MainMenuPath, startAtTitle: true);
        }

        static void ConfigureMenuScene(string path, bool startAtTitle)
        {
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            var board = GameObject.Find("HexBoard");
            if (board != null)
            {
                board.GetComponent<HexBoardBuilder>()?.SetBattlefieldVisible(false);
                var flow = board.GetComponent<CommandWarfare.UI.GameFlowController>();
                if (flow != null && startAtTitle)
                    flow.EnterTitle();
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
        }

        static void ParkDirectionalLights()
        {
            foreach (var light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light == null || light.type != LightType.Directional) continue;
                light.transform.position = new Vector3(-40f, 60f, -40f);
                light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
                light.intensity = 1.15f;
            }
        }

        static void StripGeneratedBoardArtifacts()
        {
            var room = GameObject.Find(BattleTabletopEnvironment.RootName);
            if (room != null)
                Object.DestroyImmediate(room);

            var board = GameObject.Find("HexBoard");
            if (board == null) return;

            for (var i = board.transform.childCount - 1; i >= 0; i--)
            {
                var child = board.transform.GetChild(i);
                if (child == null) continue;
                var n = child.name;
                var generated = (n is "Tiles" or "BoardPerimeter" or "DeployOverlay" or "ObjectiveOverlay"
                        or "UnitTokens" or "DeployZones" or "Objectives" or "DeploymentZones"
                        or "MenuBackdrop3D" or "MenuBackdropBattlefield" or "MenuElements")
                    || n.StartsWith("BackdropHex");
                if (generated)
                    Object.DestroyImmediate(child.gameObject);
            }
        }

        static void EnsureCleanCombatFx()
        {
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (t == null || t.parent != null || t.name != "CombatFx") continue;
                Object.DestroyImmediate(t.gameObject);
            }

            new GameObject("CombatFx");
        }
    }
}
