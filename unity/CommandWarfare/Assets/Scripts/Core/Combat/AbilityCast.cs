using System;
using System.Collections.Generic;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of play/shared/abilityCast.ts — spend resolution for ability casting.</summary>
    public static class AbilityCast
    {
        public enum AbilityPool { None, CommanderAp, CommanderCc, CompanyAp }

        public readonly struct AbilitySpend
        {
            public AbilityPool Pool { get; }
            public int Amount { get; }
            public string Error { get; }

            public bool HasError => Error != null;

            public static AbilitySpend Ok(AbilityPool pool, int amount) =>
                new(pool, amount, null);

            public static AbilitySpend Fail(string error) =>
                new(AbilityPool.None, 0, error);

            AbilitySpend(AbilityPool pool, int amount, string error)
            {
                Pool = pool;
                Amount = amount;
                Error = error;
            }
        }

        public readonly struct AbilityDef
        {
            public string Name { get; }
            public string Type { get; }
            public string Cost { get; }
            public int CostAmount { get; }
            public string CostResource { get; }
            public string UsedBy { get; }

            public AbilityDef(
                string name,
                string type,
                string cost,
                int costAmount,
                string costResource,
                string usedBy)
            {
                Name = name;
                Type = type;
                Cost = cost;
                CostAmount = costAmount;
                CostResource = costResource;
                UsedBy = usedBy;
            }
        }

        static readonly Dictionary<string, string> EffectAliases = new()
        {
            ["Pack Mark"] = "Alpha Mark",
            ["Harden Decree"] = "Harden Order",
            ["Siege Repair"] = "Repair",
            ["Raise Host"] = "Raise Thrall",
            ["Overdrive Pulse"] = "Overdrive",
        };

        public static string ResolveEffectName(string abilityName) =>
            EffectAliases.TryGetValue(abilityName, out var alias) ? alias : abilityName;

        public static bool IsPassive(AbilityDef def)
        {
            var kind = (def.Type ?? "").Trim();
            var cost = (def.Cost ?? "").Trim().ToLowerInvariant();
            return kind == "Passive" || cost == "passive";
        }

        public static bool IsUltimate(AbilityDef def)
        {
            var kind = (def.Type ?? "").Trim();
            var cost = (def.Cost ?? "").Trim().ToLowerInvariant();
            return kind == "Ultimate" || cost == "ultimate";
        }

        public static bool CasterMayUse(AbilityDef def, UnitKind casterKind)
        {
            if (IsPassive(def)) return false;
            var usedBy = (def.UsedBy ?? "").Trim();
            if (casterKind == UnitKind.Commander)
                return IsUltimate(def) || usedBy == "Commander";
            if (casterKind == UnitKind.Officer)
                return !IsUltimate(def) && !CostsCc(def) &&
                       (usedBy == "Officer" || usedBy == "Both");
            return !IsUltimate(def) && !CostsCc(def) &&
                   (string.IsNullOrEmpty(usedBy) || usedBy == "Unit" || usedBy == "Both");
        }

        public static AbilitySpend SpendForCaster(AbilityDef def, UnitKind casterKind)
        {
            if (IsPassive(def)) return AbilitySpend.Fail("Passives are always on.");
            if (IsUltimate(def)) return AbilitySpend.Ok(AbilityPool.None, 0);

            var amount = Math.Max(0, def.CostAmount);
            if (CostsCc(def))
            {
                if (casterKind != UnitKind.Commander)
                    return AbilitySpend.Fail("CC abilities are commander-only.");
                return AbilitySpend.Ok(AbilityPool.CommanderCc, Math.Max(1, amount > 0 ? amount : 1));
            }

            var resource = (def.CostResource ?? "").Trim().ToUpperInvariant();
            var costText = (def.Cost ?? "").ToUpperInvariant();
            if (resource == "AP" || costText.Contains("AP"))
            {
                var n = Math.Max(1, amount > 0 ? amount : 1);
                return casterKind == UnitKind.Commander
                    ? AbilitySpend.Ok(AbilityPool.CommanderAp, n)
                    : AbilitySpend.Ok(AbilityPool.CompanyAp, n);
            }

            return AbilitySpend.Fail("Ability has no spendable cost.");
        }

        static bool CostsCc(AbilityDef def)
        {
            if ((def.CostResource ?? "").Trim().ToUpperInvariant() == "CC") return true;
            var upper = (def.Cost ?? "").ToUpperInvariant();
            if (!upper.Contains("CC") || upper.Contains("COMPANY")) return false;
            return upper.Contains("CC");
        }
    }
}
