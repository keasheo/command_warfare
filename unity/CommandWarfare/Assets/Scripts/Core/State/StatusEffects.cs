using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of play/shared/statusEffects.ts (subset used in skirmish).</summary>
    public static class StatusEffects
    {
        public static bool UnitHasFearless(UnitToken unit) =>
            CombatDamage.HasAbility(unit, "Fearless") || unit.TempFearless;

        public static bool UnitHasFearPenalty(UnitToken unit) =>
            (unit.Fear || unit.TerrorFear) && !UnitHasFearless(unit);

        public static bool CanGainFear(UnitToken unit) => !UnitHasFearless(unit);

        /// <summary>Movement budget after Slow (−1, minimum 0).</summary>
        public static int EffectiveMoveBudget(UnitToken unit, int remaining)
        {
            if (unit.Rooted || unit.BonePrisoned) return 0;
            var slowPenalty = unit.Slow ? 1 : 0;
            return System.Math.Max(0, remaining - slowPenalty);
        }

        /// <summary>Mark Slow for consumption when this company activation ends.</summary>
        public static void MarkSlowForActivation(UnitToken unit)
        {
            if (unit == null) return;
            unit.SlowPendingClear = unit.Slow;
        }

        /// <summary>Clear Slow that was pending at the end of company activation.</summary>
        public static void ClearConsumedSlow(UnitToken unit)
        {
            if (unit == null || !unit.SlowPendingClear) return;
            unit.Slow = false;
            unit.SlowPendingClear = false;
        }

        /// <summary>Statuses cleared at round refresh (matches TS clearRoundStatuses — Slow persists).</summary>
        public static void ClearRoundStatuses(UnitToken unit)
        {
            unit.Fear = false;
            unit.TempFearless = false;
            unit.Rooted = false;
            unit.BonePrisoned = false;
            unit.TerrorFear = false;
            unit.Unyielding = false;
            unit.AssaultMarked = false;
            unit.SpectralStrike = false;
            unit.NullPulsed = false;
            unit.Counterattack = false;
            unit.SlowPendingClear = false;
            // Slow itself clears only via ClearConsumedSlow after activation.
        }
    }
}
