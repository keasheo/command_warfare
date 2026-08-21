using CommandWarfare.Core.Terrain;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of terrain hit/defense helpers from play/shared/terrainPieces.ts.</summary>
    public static class TerrainCombatRules
    {
        public const int FavoredHitBonus = 1;
        public const int FavoredDamageBonus = 1;

        public static bool FavoredGrantsHitBonus(TerrainKind? terrain) =>
            terrain is TerrainKind.Plains or TerrainKind.Desert;

        public static bool ForestRangedHitPenalty(
            TerrainKind? defenderTerrain,
            TerrainKind? attackerTerrain,
            bool attackerHasForestFavored,
            int dist)
        {
            if (dist < 2 || defenderTerrain != TerrainKind.Forest) return false;
            if (attackerHasForestFavored && attackerTerrain == TerrainKind.Forest) return false;
            return true;
        }

        public static bool MountainsDefenseHitPenalty(
            TerrainKind? defenderTerrain,
            TerrainKind? attackerTerrain) =>
            defenderTerrain == TerrainKind.Mountains && attackerTerrain != TerrainKind.Mountains;

        public static bool SwampBlocksFlanking(
            TerrainKind? defenderTerrain,
            TerrainKind? attackerTerrain) =>
            defenderTerrain == TerrainKind.Swamp && attackerTerrain != TerrainKind.Swamp;

        public static bool DesertBlocksEvade(TerrainKind? defenderTerrain) =>
            defenderTerrain == TerrainKind.Desert;

        public static bool FavoredGrantsGuard(TerrainKind? terrain) =>
            terrain == TerrainKind.Swamp;

        public static bool FavoredGrantsMoveBonus(TerrainKind? terrain) =>
            terrain == TerrainKind.Water;
    }
}
