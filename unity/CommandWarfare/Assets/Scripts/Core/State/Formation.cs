using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of play/shared/formation.ts — adjacent same-company auras.</summary>
    public static class Formation
    {
        public const int UvCap = 3;
        public const string Drill = "Formation Drill";
        public const string Guard = "Formation Guard";
        public const string March = "Formation March";

        public static bool SameCompany(UnitToken a, UnitToken b) =>
            a.Seat == b.Seat &&
            !string.IsNullOrEmpty(a.OfficerCardId) &&
            a.OfficerCardId == b.OfficerCardId;

        public static int UnitUv(CardDatabase cards, UnitToken unit)
        {
            var card = cards?.FindById(unit.CardId);
            return card != null && card.uv > 0 ? card.uv : int.MaxValue;
        }

        public static bool IsCheapUnit(CardDatabase cards, UnitToken unit) =>
            UnitUv(cards, unit) <= UvCap;

        public static int MarchBonus(GameState state, UnitToken unit, CardDatabase cards)
        {
            if (!IsCheapUnit(cards, unit)) return 0;
            return HasAdjacentProvider(state, unit, March) ? 1 : 0;
        }

        public static int DrillHitBonus(GameState state, UnitToken unit, CardDatabase cards)
        {
            if (!IsCheapUnit(cards, unit)) return 0;
            return HasAdjacentProvider(state, unit, Drill) ? 1 : 0;
        }

        public static int GuardMitigation(GameState state, UnitToken unit, CardDatabase cards)
        {
            if (!IsCheapUnit(cards, unit)) return 0;
            return HasAdjacentProvider(state, unit, Guard) ? 1 : 0;
        }

        /// <summary>Pack: melee +1 Hit while adjacent to ≥2 friendly Pack units.</summary>
        public static bool PackMeleeHitBonus(GameState state, UnitToken attacker)
        {
            if (!CombatKeywords.HasUnitAbility(attacker, "Pack")) return false;
            var origin = new HexCoord(attacker.Col, attacker.Row);
            var n = 0;
            foreach (var u in state.Units)
            {
                if (u.Id == attacker.Id || u.Seat != attacker.Seat) continue;
                if (!CombatKeywords.HasUnitAbility(u, "Pack")) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) == 1)
                    n++;
            }
            return n >= 2;
        }

        static bool HasAdjacentProvider(GameState state, UnitToken unit, string keyword)
        {
            var origin = new HexCoord(unit.Col, unit.Row);
            foreach (var m in state.Units)
            {
                if (m.Id == unit.Id || !SameCompany(m, unit)) continue;
                if (HexMath.Distance(origin, new HexCoord(m.Col, m.Row)) != 1) continue;
                if (HasFormationKeyword(m, keyword)) return true;
            }
            return false;
        }

        static bool HasFormationKeyword(UnitToken unit, string keyword)
        {
            if (HasAbilityOrKeyword(unit.Abilities, keyword)) return true;
            return HasAbilityOrKeyword(unit.Keywords, keyword);
        }

        static bool HasAbilityOrKeyword(System.Collections.Generic.List<string> list, string keyword)
        {
            if (list == null) return false;
            var needle = keyword.ToLowerInvariant();
            foreach (var entry in list)
            {
                if (string.IsNullOrEmpty(entry)) continue;
                var lower = entry.ToLowerInvariant();
                if (lower == needle || lower.StartsWith(needle + " ")) return true;
            }
            return false;
        }
    }
}
