namespace CommandWarfare.Core
{
    /// <summary>Gameplay constants ported from play/shared/constants.ts.</summary>
    public static class GameConstants
    {
        public const int BoardSize2P = 35;
        public const int BoardSize4P = 39;
        public const int DeployZoneDepth = 8;
        public const int DeployZoneWidth = 13;
        public const int SiegeDeployDepth = 4;
        public const int MaxDeploySiege = 5;
        public const int DefaultOfficerCommandRadius = 4;
        public const int DefaultCommanderCommandRadius = 7;
        /// <summary>Command Cards spent when activating an officer's company (battleSim OFFICER_ACTIVATE_CC).</summary>
        public const int OfficerActivateCcCost = 1;
        public const int ScoutCrExtension = 3;
        public const int MaxRounds = 15;
        public const int VpPerObjective = 2;
        public const int ArmyUvMax = 220;
        public const int DeployUvMax = 110;
        public const int ReserveUvMax = 60;
        public const int TerrainLandDropsPerSize = 3;

        public static int BoardSizeForPlayers(int maxPlayers) =>
            maxPlayers == 2 ? BoardSize2P : BoardSize4P;

        public static int BoardMid(int boardSize) => (boardSize - 1) / 2;
    }
}
