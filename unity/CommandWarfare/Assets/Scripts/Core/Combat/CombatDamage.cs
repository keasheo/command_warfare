using System;
using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of damage application from play/shared/combatResolve.ts.</summary>
    public static class CombatDamage
    {
        public static int EffectiveDamage(UnitToken unit)
        {
            var baseDmg = unit.Damage ?? 0;
            if (CombatKeywords.HasUnitAbility(unit, "Adaptive Attack") && unit.ToughnessCurrent != null)
                baseDmg = unit.ToughnessCurrent.Value;
            return Math.Max(0, baseDmg + unit.TempDamage);
        }

        public static int StrikeDamage(StrikeContext ctx)
        {
            if (ctx.StrikeDamageOverride is > 0)
                return ctx.StrikeDamageOverride.Value;

            var dmg = EffectiveDamage(ctx.Attacker);
            if (ctx.Defender.AssaultMarked) dmg += 1;
            if (CombatKeywords.HasUnitAbility(ctx.Attacker, "Charge") &&
                !CombatKeywords.HasDefender(ctx.Attacker) &&
                ctx.Attacker.ActivationCol != null &&
                ctx.Attacker.ActivationRow != null)
            {
                var moved = HexMath.Distance(
                    new HexCoord(ctx.Attacker.ActivationCol.Value, ctx.Attacker.ActivationRow.Value),
                    new HexCoord(ctx.Attacker.Col, ctx.Attacker.Row));
                if (moved >= 2) dmg += 1;
            }

            if (ctx.FavoredTerrainDamage)
                dmg += TerrainCombatRules.FavoredDamageBonus;

            if (ctx.FortifiedTarget && CombatKeywords.IsSiege(ctx.Attacker))
                dmg += 1;

            dmg += CombatResolve.DamageTypeBonus(ctx.AttackerTags, ctx.DefenderTags);
            return dmg;
        }

        public static DamageResult ApplyIncomingDamage(DamageContext ctx, int raw)
        {
            var defender = ctx.Defender;
            if (defender.Unyielding && raw > 0)
            {
                return new DamageResult(0, raw, false, false, true);
            }

            var dmg = Math.Max(0, raw);
            var before = dmg;
            var piercing = ctx.Attacker != null && CombatKeywords.HasPiercing(ctx.Attacker);

            var harden = Math.Max(defender.Harden, HardenFromKeywords(defender));
            if (ctx.MountainsFavoredHarden) harden += 1;
            if (ctx.FortifiedHex) harden += 1;

            if (harden > 0 && !piercing)
                dmg = ReduceDamageFloor(dmg, harden);
            if (CombatKeywords.HasDefender(defender) && ctx.Attacker?.SpectralStrike != true)
                dmg = ReduceDamageFloor(dmg, 1);
            if (ctx.ShieldwallAdjacent)
                dmg = ReduceDamageFloor(dmg, 1);
            if (ctx.FormationGuard > 0)
                dmg = ReduceDamageFloor(dmg, ctx.FormationGuard);
            if (raw > 0 && dmg > 0) dmg = Math.Max(1, dmg);

            return new DamageResult(dmg, Math.Max(0, before - dmg), ctx.FortifiedHex, piercing, false);
        }

        public static int TrampleLeftoverDamage(int strikeDamageAmount, int defenderHpBefore) =>
            Math.Max(0, strikeDamageAmount - defenderHpBefore);

        static int ReduceDamageFloor(int dmg, int amount)
        {
            if (dmg <= 0) return 0;
            return Math.Max(1, dmg - amount);
        }

        static int HardenFromKeywords(UnitToken unit)
        {
            var max = 0;
            foreach (var k in unit.Keywords ?? new List<string>())
            {
                if (k.StartsWith("Harden", StringComparison.OrdinalIgnoreCase))
                {
                    var tail = k.Length > 6 ? k[6..].Trim() : "";
                    if (int.TryParse(tail, out var n)) max = Math.Max(max, n);
                    else max = Math.Max(max, 1);
                }
            }
            return max;
        }

        public static bool HasAbility(UnitToken unit, string ability) =>
            CombatKeywords.HasUnitAbility(unit, ability);
    }

    public readonly struct StrikeContext
    {
        public UnitToken Attacker { get; }
        public UnitToken Defender { get; }
        public int? StrikeDamageOverride { get; }
        public bool FavoredTerrainDamage { get; }
        public bool FortifiedTarget { get; }
        public IReadOnlyList<string> AttackerTags { get; }
        public IReadOnlyList<string> DefenderTags { get; }

        public StrikeContext(
            UnitToken attacker,
            UnitToken defender,
            bool favoredTerrainDamage = false,
            int? strikeDamageOverride = null,
            IReadOnlyList<string> attackerTags = null,
            IReadOnlyList<string> defenderTags = null,
            bool fortifiedTarget = false)
        {
            Attacker = attacker;
            Defender = defender;
            FavoredTerrainDamage = favoredTerrainDamage;
            StrikeDamageOverride = strikeDamageOverride;
            AttackerTags = attackerTags ?? Array.Empty<string>();
            DefenderTags = defenderTags ?? Array.Empty<string>();
            FortifiedTarget = fortifiedTarget;
        }
    }

    public readonly struct DamageContext
    {
        public UnitToken Defender { get; }
        public UnitToken Attacker { get; }
        public bool FortifiedHex { get; }
        public bool MountainsFavoredHarden { get; }
        public int FormationGuard { get; }
        public bool ShieldwallAdjacent { get; }

        public DamageContext(
            UnitToken defender,
            UnitToken attacker = null,
            bool fortifiedHex = false,
            bool mountainsFavoredHarden = false,
            int formationGuard = 0,
            bool shieldwallAdjacent = false)
        {
            Defender = defender;
            Attacker = attacker;
            FortifiedHex = fortifiedHex;
            MountainsFavoredHarden = mountainsFavoredHarden;
            FormationGuard = formationGuard;
            ShieldwallAdjacent = shieldwallAdjacent;
        }
    }

    public readonly struct DamageResult
    {
        public int Dealt { get; }
        public int Mitigated { get; }
        public bool Fortified { get; }
        public bool Piercing { get; }
        public bool UnyieldingBlocked { get; }

        public DamageResult(int dealt, int mitigated, bool fortified, bool piercing, bool unyieldingBlocked)
        {
            Dealt = dealt;
            Mitigated = mitigated;
            Fortified = fortified;
            Piercing = piercing;
            UnyieldingBlocked = unyieldingBlocked;
        }
    }
}
