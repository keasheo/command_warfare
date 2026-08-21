using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.State;
using CommandWarfare.Data;

namespace CommandWarfare.Core.Deploy
{
    /// <summary>Port of play/shared/siege.ts — Siege ID + deploy caps.</summary>
    public static class SiegeRules
    {
        public static bool IsSiegeCard(string primaryType, IReadOnlyList<string> keywords)
        {
            if (!string.IsNullOrEmpty(primaryType) &&
                string.Equals(primaryType, "Siege", StringComparison.OrdinalIgnoreCase))
                return true;
            if (keywords == null) return false;
            foreach (var k in keywords)
            {
                if (string.IsNullOrEmpty(k)) continue;
                var lower = k.ToLowerInvariant();
                if (lower == "siege" || lower.StartsWith("siege ", StringComparison.Ordinal))
                    return true;
            }
            return false;
        }

        public static bool IsSiegeCard(CardDefinition card) =>
            card != null && IsSiegeCard(card.primaryType, card.keywords);

        public static int CountDeploySiege(DemoArmy army, Dictionary<string, BattleBucket> loadout)
        {
            if (army?.Companies == null || loadout == null) return 0;
            var n = 0;
            foreach (var co in army.Companies)
            {
                if (co?.OfficerId == null) continue;
                if (!loadout.TryGetValue(co.OfficerId, out var bucket) || bucket != BattleBucket.Deploy)
                    continue;
                if (co.Units == null) continue;
                foreach (var u in co.Units)
                {
                    if (IsSiegeCard(u)) n++;
                }
            }
            return n;
        }

        public static string ValidateDeploySiegeCap(DemoArmy army, Dictionary<string, BattleBucket> loadout)
        {
            var n = CountDeploySiege(army, loadout);
            if (n > GameConstants.MaxDeploySiege)
                return $"Deploy may include at most {GameConstants.MaxDeploySiege} Siege units (have {n}).";
            return null;
        }
    }
}
