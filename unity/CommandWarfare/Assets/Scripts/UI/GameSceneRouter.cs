using UnityEngine;
using UnityEngine.SceneManagement;

namespace CommandWarfare.UI
{
    /// <summary>Loads the three game scenes (MainMenu / ArmyBuilder / Battle).</summary>
    public static class GameSceneRouter
    {
        public static void LoadMainMenu()
        {
            MatchLaunchContext.ClearBattlePending();
            Load(GameSceneIds.MainMenu);
        }

        public static void LoadArmyBuilder() => Load(GameSceneIds.ArmyBuilder);

        public static void LoadBattle() => Load(GameSceneIds.Battle);

        public static bool IsBattleScene =>
            SceneManager.GetActiveScene().name == GameSceneIds.Battle;

        public static bool IsArmyBuilderScene =>
            SceneManager.GetActiveScene().name == GameSceneIds.ArmyBuilder;

        public static bool IsMainMenuScene
        {
            get
            {
                var n = SceneManager.GetActiveScene().name;
                return n == GameSceneIds.MainMenu || n == "SampleScene";
            }
        }

        static void Load(string sceneName)
        {
            if (Application.CanStreamedLevelBeLoaded(sceneName))
            {
                SceneManager.LoadScene(sceneName, LoadSceneMode.Single);
                return;
            }

            // Editor play from SampleScene before build settings are updated.
            Debug.LogWarning(
                $"[CommandWarfare] Scene '{sceneName}' is not in Build Settings — staying in current scene.");
        }
    }
}
