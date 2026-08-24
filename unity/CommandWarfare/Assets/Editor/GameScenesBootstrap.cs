using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Creates MainMenu / ArmyBuilder / Battle scenes from SampleScene and wires Build Settings.
    /// </summary>
    public static class GameScenesBootstrap
    {
        const string ScenesFolder = "Assets/Scenes";
        const string SamplePath = "Assets/Scenes/SampleScene.unity";
        const string MainMenuPath = "Assets/Scenes/MainMenu.unity";
        const string ArmyBuilderPath = "Assets/Scenes/ArmyBuilder.unity";
        const string BattlePath = "Assets/Scenes/Battle.unity";

        [MenuItem("CommandWarfare/Create Game Scenes (MainMenu / ArmyBuilder / Battle)")]
        public static void CreateGameScenes()
        {
            if (!File.Exists(Path.GetFullPath(SamplePath)))
            {
                Debug.LogError($"[CommandWarfare] Missing {SamplePath}. Open/bootstrapsample first.");
                return;
            }

            EnsureDirectory(ScenesFolder);
            DuplicateScene(SamplePath, MainMenuPath);
            DuplicateScene(SamplePath, ArmyBuilderPath);
            DuplicateScene(SamplePath, BattlePath);
            AssetDatabase.Refresh();

            // MainMenu / ArmyBuilder: hide battlefield at edit time so the scene opens clean.
            ConfigureMenuScene(MainMenuPath, startAtTitle: true);
            ConfigureMenuScene(ArmyBuilderPath, startAtTitle: false);
            ConfigureBattleScene(BattlePath);

            SetBuildSettings();
            AssetDatabase.SaveAssets();
            Debug.Log(
                "[CommandWarfare] Created MainMenu, ArmyBuilder, Battle. Build Settings updated — MainMenu is index 0.");
        }

        static void EnsureDirectory(string assetPath)
        {
            var full = Path.GetFullPath(assetPath);
            if (!Directory.Exists(full))
                Directory.CreateDirectory(full);
        }

        static void DuplicateScene(string source, string dest)
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(dest) != null)
            {
                AssetDatabase.DeleteAsset(dest);
            }
            if (!AssetDatabase.CopyAsset(source, dest))
                Debug.LogError($"[CommandWarfare] Failed to copy {source} → {dest}");
        }

        static void ConfigureMenuScene(string path, bool startAtTitle)
        {
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            var board = GameObject.Find("HexBoard");
            if (board != null)
            {
                var builder = board.GetComponent<CommandWarfare.Board.HexBoardBuilder>();
                builder?.SetBattlefieldVisible(false);
                var flow = board.GetComponent<CommandWarfare.UI.GameFlowController>();
                if (flow != null && startAtTitle)
                    flow.EnterTitle();
            }
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
        }

        static void ConfigureBattleScene(string path)
        {
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            // Leave HexBoard wired; GameFlowController.Start applies MatchLaunchContext.
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
        }

        static void SetBuildSettings()
        {
            var scenes = new[]
            {
                new EditorBuildSettingsScene(MainMenuPath, true),
                new EditorBuildSettingsScene(ArmyBuilderPath, true),
                new EditorBuildSettingsScene(BattlePath, true),
                // Keep SampleScene available for legacy / smoke tests.
                new EditorBuildSettingsScene(SamplePath, true),
            };
            EditorBuildSettings.scenes = scenes;
        }
    }
}
