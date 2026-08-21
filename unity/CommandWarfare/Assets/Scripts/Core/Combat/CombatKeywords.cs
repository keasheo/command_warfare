using System;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of hasUnitAbility from play/shared/combatResolve.ts.</summary>
    public static class CombatKeywords
    {
        public static bool HasUnitAbility(UnitToken unit, string name)
        {
            if (unit == null || string.IsNullOrEmpty(name)) return false;
            var needle = name.ToLowerInvariant();

            if (unit.Abilities != null)
            {
                foreach (var a in unit.Abilities)
                {
                    if (!string.IsNullOrEmpty(a) && a.ToLowerInvariant() == needle)
                        return true;
                }
            }

            if (!string.IsNullOrEmpty(unit.Ultimate) && unit.Ultimate.ToLowerInvariant() == needle)
                return true;

            if (unit.Keywords != null)
            {
                foreach (var k in unit.Keywords)
                {
                    if (string.IsNullOrEmpty(k)) continue;
                    var lower = k.ToLowerInvariant();
                    if (lower == needle || lower.StartsWith(needle + " ", StringComparison.Ordinal))
                        return true;
                }
            }

            return false;
        }

        public static bool HasScout(UnitToken unit) => HasUnitAbility(unit, "Scout");
        public static bool HasTrample(UnitToken unit) => HasUnitAbility(unit, "Trample");
        public static bool HasBlast(UnitToken unit) => HasUnitAbility(unit, "Blast");
        public static bool HasCleave(UnitToken unit) => HasUnitAbility(unit, "Cleave");
        public static bool HasGuard(UnitToken unit) => HasUnitAbility(unit, "Guard");
        public static bool HasOverpenetrate(UnitToken unit) => HasUnitAbility(unit, "Overpenetrate");
        public static bool HasPiercing(UnitToken unit) => HasUnitAbility(unit, "Piercing");
        public static bool HasPoison(UnitToken unit) => HasUnitAbility(unit, "Poison");
        public static bool HasFear(UnitToken unit) => HasUnitAbility(unit, "Fear") || unit.TerrorFear;
        public static bool HasSlow(UnitToken unit) => HasUnitAbility(unit, "Slow");
        public static bool HasFrenzy(UnitToken unit) => HasUnitAbility(unit, "Frenzy");
        public static bool HasFlanking(UnitToken unit) => HasUnitAbility(unit, "Flanking");
        public static bool HasDefender(UnitToken unit) => HasUnitAbility(unit, "Defender");
        public static bool IsSiege(UnitToken unit) => HasUnitAbility(unit, "Siege");

        /// <summary>MultiStrike X → attack count (default 1). Parses keyword like "MultiStrike 2".</summary>
        public static int MultiStrikeCount(UnitToken unit)
        {
            if (unit?.Keywords == null) return 1;
            foreach (var k in unit.Keywords)
            {
                if (string.IsNullOrEmpty(k)) continue;
                if (!k.StartsWith("MultiStrike", System.StringComparison.OrdinalIgnoreCase)) continue;
                var tail = k.Length > 11 ? k[11..].Trim() : "";
                if (int.TryParse(tail, out var n) && n > 0) return n;
                return 2;
            }
            return HasUnitAbility(unit, "MultiStrike") ? 2 : 1;
        }
    }
}
