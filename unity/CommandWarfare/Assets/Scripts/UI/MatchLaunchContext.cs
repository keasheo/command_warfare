using CommandWarfare.Core.State;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Static hand-off between MainMenu → ArmyBuilder → Battle scenes
    /// (avoids DontDestroyOnLoad for the whole HexBoard).
    /// </summary>
    public static class MatchLaunchContext
    {
        public static MatchSetupKind SetupKind = MatchSetupKind.Skirmish;
        public static ArmyBuilderMode ArmyMode = ArmyBuilderMode.Workshop;
        public static int DeployUvMax = 110;
        public static int ReserveUvMax = 60;
        public static bool RandomMap = true;
        public static string DefaultAiRace = "Dwarf";
        public static string RoomSeed;
        public static DemoArmy DraftArmy;
        public static bool HostVsAi = true;
        public static string HostName = "Host";
        public static bool PendingBattleStart;
        public static bool NetworkMode;
        public static bool OpenMatchSetupOnMenu;

        public static void ClearBattlePending()
        {
            PendingBattleStart = false;
        }

        public static void PrepareArmyBuilder(
            ArmyBuilderMode mode,
            MatchSetupKind setupKind,
            int deployUv,
            int reserveUv,
            bool randomMap,
            string aiRace,
            DemoArmy draft = null)
        {
            ArmyMode = mode;
            SetupKind = setupKind;
            DeployUvMax = deployUv;
            ReserveUvMax = reserveUv;
            RandomMap = randomMap;
            DefaultAiRace = aiRace ?? "Dwarf";
            DraftArmy = draft;
            PendingBattleStart = false;
            NetworkMode = mode == ArmyBuilderMode.NetworkSubmit;
        }

        public static void PrepareBattleFromDraft(
            DemoArmy draft,
            int deployUv,
            int reserveUv,
            bool randomMap,
            string aiRace,
            string roomSeed)
        {
            DraftArmy = draft;
            DeployUvMax = deployUv;
            ReserveUvMax = reserveUv;
            RandomMap = randomMap;
            DefaultAiRace = aiRace ?? "Dwarf";
            RoomSeed = roomSeed;
            PendingBattleStart = true;
            NetworkMode = false;
        }
    }
}
