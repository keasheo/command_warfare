using System;
using System.Collections.Generic;
using CommandWarfare.Data;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of play/shared/damageTypes.ts — type matchup bonus damage.</summary>
    public static class DamageTypes
    {
        public readonly struct BonusRule
        {
            public string[] AttackerTags { get; }
            public string[] DefenderTags { get; }
            public int BonusDamage { get; }

            public BonusRule(string[] attackerTags, string[] defenderTags, int bonusDamage)
            {
                AttackerTags = attackerTags;
                DefenderTags = defenderTags;
                BonusDamage = bonusDamage;
            }
        }

        /// <summary>Intentionally empty until card tags are audited (matches TS stub).</summary>
        public static readonly BonusRule[] Rules = Array.Empty<BonusRule>();

        public static List<string> TagsFrom(CardDefinition card)
        {
            var tags = new List<string>();
            if (card == null) return tags;
            if (!string.IsNullOrEmpty(card.primaryType)) tags.Add(card.primaryType);
            if (!string.IsNullOrEmpty(card.secondaryType)) tags.Add(card.secondaryType);
            if (card.keywords != null)
                tags.AddRange(card.keywords);
            return tags;
        }

        public static List<string> TagsFrom(UnitTokenSnapshot snap)
        {
            var tags = new List<string>();
            if (snap.PrimaryType != null) tags.Add(snap.PrimaryType);
            if (snap.SecondaryType != null) tags.Add(snap.SecondaryType);
            if (snap.Keywords != null)
                tags.AddRange(snap.Keywords);
            return tags;
        }

        public static int Bonus(IReadOnlyList<string> attackerTags, IReadOnlyList<string> defenderTags)
        {
            if (Rules.Length == 0 || attackerTags == null || defenderTags == null) return 0;

            var atk = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var def = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in attackerTags) atk.Add(t);
            foreach (var t in defenderTags) def.Add(t);

            var bonus = 0;
            foreach (var rule in Rules)
            {
                var atkHit = false;
                foreach (var t in rule.AttackerTags)
                {
                    if (atk.Contains(t)) { atkHit = true; break; }
                }
                if (!atkHit) continue;

                var defHit = false;
                foreach (var t in rule.DefenderTags)
                {
                    if (def.Contains(t)) { defHit = true; break; }
                }
                if (defHit) bonus += rule.BonusDamage;
            }
            return bonus;
        }
    }

    /// <summary>Minimal card fields for damage type tagging without full catalog lookup.</summary>
    public readonly struct UnitTokenSnapshot
    {
        public string PrimaryType { get; }
        public string SecondaryType { get; }
        public IReadOnlyList<string> Keywords { get; }

        public UnitTokenSnapshot(string primaryType, string secondaryType, IReadOnlyList<string> keywords)
        {
            PrimaryType = primaryType;
            SecondaryType = secondaryType;
            Keywords = keywords;
        }
    }
}
