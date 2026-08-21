using System;
using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of favored-terrain helpers from play/shared/terrainPieces.ts + combatResolve.ts.</summary>
    public static class FavoredTerrain
    {
        static readonly Dictionary<string, TerrainKind> RaceDefaults = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Human"] = TerrainKind.Plains,
            ["Construct"] = TerrainKind.Plains,
            ["Beastfolk"] = TerrainKind.Forest,
            ["Elf"] = TerrainKind.Forest,
            ["Dragon"] = TerrainKind.Volcanic,
            ["Demon"] = TerrainKind.Volcanic,
            ["Undead"] = TerrainKind.Swamp,
            ["Lizardman"] = TerrainKind.Swamp,
            ["Lizardmen"] = TerrainKind.Swamp,
            ["Dwarf"] = TerrainKind.Mountains,
        };

        static readonly Dictionary<TerrainKind, string> KeywordNames = new()
        {
            [TerrainKind.Plains] = "Open Ground",
            [TerrainKind.Forest] = "Woodwalker",
            [TerrainKind.Swamp] = "Bogstrider",
            [TerrainKind.Desert] = "Duneborn",
            [TerrainKind.Volcanic] = "Ashborn",
            [TerrainKind.Mountains] = "Mountainborn",
            [TerrainKind.Water] = "Deepwalker",
            [TerrainKind.Wall] = "Wallbreaker",
        };

        static readonly Dictionary<string, TerrainKind> KeywordToTerrain = BuildKeywordLookup();

        static Dictionary<string, TerrainKind> BuildKeywordLookup()
        {
            var map = new Dictionary<string, TerrainKind>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in KeywordNames)
                map[kv.Value] = kv.Key;
            return map;
        }

        public static TerrainKind? RaceDefault(string race) =>
            !string.IsNullOrEmpty(race) && RaceDefaults.TryGetValue(race, out var t) ? t : null;

        public static string KeywordFor(TerrainKind terrain) =>
            KeywordNames.TryGetValue(terrain, out var name) ? name : null;

        public static bool UnitHasBonus(
            string race,
            IReadOnlyList<string> keywords,
            TerrainKind? terrain,
            string favoredTerrainSlug)
        {
            if (!terrain.HasValue) return false;

            if (!string.IsNullOrWhiteSpace(favoredTerrainSlug) &&
                ParseKind(favoredTerrainSlug) == terrain.Value)
                return true;

            if (keywords != null)
            {
                foreach (var k in keywords)
                {
                    if (string.IsNullOrEmpty(k)) continue;
                    if (KeywordToTerrain.TryGetValue(k, out var kwTerrain) && kwTerrain == terrain.Value)
                        return true;
                }
            }

            var raceDefault = RaceDefault(race);
            return raceDefault.HasValue && raceDefault.Value == terrain.Value;
        }

        public static bool UnitHasBonus(UnitToken unit, CardDefinition card, TerrainKind? terrain)
        {
            if (unit == null) return false;
            var race = !string.IsNullOrEmpty(unit.Race) ? unit.Race : card?.race;
            var favored = card?.favoredTerrain;
            return UnitHasBonus(race, unit.Keywords, terrain, favored);
        }

        public static bool Matches(CardDefinition card, TerrainKind terrain) =>
            card != null &&
            !string.IsNullOrWhiteSpace(card.favoredTerrain) &&
            ParseKind(card.favoredTerrain) == terrain;

        public static bool GrantsHitBonus(UnitToken unit, CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue &&
            TerrainCombatRules.FavoredGrantsHitBonus(terrain) &&
            UnitHasBonus(unit, card, terrain);

        public static bool GrantsDamageBonus(UnitToken unit, CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue &&
            terrain.Value == TerrainKind.Volcanic &&
            UnitHasBonus(unit, card, terrain);

        public static bool GrantsHardenBonus(UnitToken unit, CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue &&
            terrain.Value == TerrainKind.Mountains &&
            UnitHasBonus(unit, card, terrain);

        public static bool GrantsGuard(UnitToken unit, CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue &&
            TerrainCombatRules.FavoredGrantsGuard(terrain) &&
            UnitHasBonus(unit, card, terrain);

        public static int MoveBonus(UnitToken unit, CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue &&
            TerrainCombatRules.FavoredGrantsMoveBonus(terrain) &&
            UnitHasBonus(unit, card, terrain)
                ? 1
                : 0;

        public static int MoveBonus(GameState state, UnitToken unit, CardDatabase cards)
        {
            if (state == null || unit == null) return 0;
            var key = HexMath.Key(unit.Col, unit.Row);
            var terrain = state.Terrain != null && state.Terrain.TryGetValue(key, out var t)
                ? t
                : TerrainKind.Plains;
            var card = cards?.FindById(unit.CardId);
            return MoveBonus(unit, card, terrain);
        }

        /// <summary>Legacy card-only match (explicit favoredTerrain field).</summary>
        public static bool GrantsHitBonus(CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue && Matches(card, terrain.Value) &&
            TerrainCombatRules.FavoredGrantsHitBonus(terrain);

        public static bool GrantsDamageBonus(CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue && Matches(card, terrain.Value) &&
            terrain.Value == TerrainKind.Volcanic;

        public static bool GrantsHardenBonus(CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue && Matches(card, terrain.Value) &&
            terrain.Value == TerrainKind.Mountains;

        public static bool GrantsGuard(CardDefinition card, TerrainKind? terrain) =>
            terrain.HasValue && Matches(card, terrain.Value) &&
            TerrainCombatRules.FavoredGrantsGuard(terrain);

        public static TerrainKind? ParseKind(string slug)
        {
            if (string.IsNullOrWhiteSpace(slug)) return null;
            return slug.Trim().ToLowerInvariant() switch
            {
                "plains" => TerrainKind.Plains,
                "forest" => TerrainKind.Forest,
                "swamp" => TerrainKind.Swamp,
                "desert" => TerrainKind.Desert,
                "water" => TerrainKind.Water,
                "wall" => TerrainKind.Wall,
                "volcanic" => TerrainKind.Volcanic,
                "mountains" => TerrainKind.Mountains,
                _ => null,
            };
        }

        public static bool HasForestFavored(UnitToken unit, CardDefinition card) =>
            UnitHasBonus(unit, card, TerrainKind.Forest);

        public static bool HasForestFavored(CardDefinition card) =>
            Matches(card, TerrainKind.Forest);
    }
}
