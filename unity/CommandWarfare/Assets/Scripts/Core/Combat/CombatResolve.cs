using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;

namespace CommandWarfare.Core.Combat
{
    /// <summary>Port of play/shared/combatResolve.ts — core to-hit and damage helpers.</summary>
    public static class CombatResolve
    {
        static readonly Dictionary<int, int> HitNeedByDistance = new()
        {
            { 1, 7 }, { 2, 8 }, { 3, 9 }, { 4, 10 },
        };

        public const int HitNeedMin = 5;
        public const int HitNeedMax = 11;

        public static int BaseHitNeedForDistance(int dist) =>
            HitNeedByDistance.TryGetValue(dist, out var need) ? need : HitNeedMax;

        public static (int, int) RollHitDice(SeededRng rng) =>
            (1 + rng.NextInt(6), 1 + rng.NextInt(6));

        public static int RollHitSum(SeededRng rng)
        {
            var (a, b) = RollHitDice(rng);
            return a + b;
        }

        public static bool RollHits(int hitNeed, SeededRng rng) =>
            RollHitSum(rng) >= hitNeed;

        public static HitNeedBreakdown BuildHitNeedBreakdown(int dist, IEnumerable<HitNeedModifier> modifiers)
        {
            var baseNeed = BaseHitNeedForDistance(dist);
            var list = new List<HitNeedModifier>(modifiers ?? Array.Empty<HitNeedModifier>());
            var raw = baseNeed;
            foreach (var m in list) raw += m.Delta;
            var finalNeed = Math.Max(HitNeedMin, Math.Min(HitNeedMax, raw));
            return new HitNeedBreakdown(baseNeed, list, finalNeed);
        }

        /// <summary>Terrain-aware hit need — subset of buildHitNeedBreakdown from combatResolve.ts.</summary>
        public static HitNeedBreakdown BuildHitNeedBreakdown(HitNeedContext ctx)
        {
            var mods = new List<HitNeedModifier>();
            if (ctx.AttackerFear)
                mods.Add(new HitNeedModifier("Fear", 1));
            if (ctx.DefenderEvadeActive && !TerrainCombatRules.DesertBlocksEvade(ctx.DefenderTerrain))
                mods.Add(new HitNeedModifier("Evade", 1));
            if (TerrainCombatRules.MountainsDefenseHitPenalty(ctx.DefenderTerrain, ctx.AttackerTerrain))
                mods.Add(new HitNeedModifier("Mountains", 1));
            if (TerrainCombatRules.ForestRangedHitPenalty(
                    ctx.DefenderTerrain, ctx.AttackerTerrain, ctx.AttackerForestFavored, ctx.Distance))
                mods.Add(new HitNeedModifier("Forest", 1));
            if (ctx.FavoredTerrainHit)
                mods.Add(new HitNeedModifier("Favored", -TerrainCombatRules.FavoredHitBonus));
            if (ctx.Distance == 1 && ctx.Flanking && !TerrainCombatRules.SwampBlocksFlanking(ctx.DefenderTerrain, ctx.AttackerTerrain))
                mods.Add(new HitNeedModifier("Flanking", -1));
            if (ctx.FormationDrill)
                mods.Add(new HitNeedModifier("Formation Drill", -1));
            if (ctx.Distance == 1 && ctx.PackBonus)
                mods.Add(new HitNeedModifier("Pack", -1));
            return BuildHitNeedBreakdown(ctx.Distance, mods);
        }

        public static int DamageTypeBonus(IReadOnlyList<string> attackerTags, IReadOnlyList<string> defenderTags) =>
            DamageTypes.Bonus(attackerTags, defenderTags);

        public static AttackPreview PreviewAttack(AttackContext ctx)
        {
            if (ctx.Attacker.Seat == ctx.Defender.Seat)
                return AttackPreview.Illegal("Cannot attack allies.");
            if (ctx.Attacker.BonePrisoned)
                return AttackPreview.Illegal("Bone Prison — cannot attack this round.");
            if (ctx.Defender.ToughnessCurrent == null)
                return AttackPreview.Illegal("Target has no Toughness.");

            var trampleCont = ctx.Attacker.TrampleLeftoverDamage > 0 ||
                              (ctx.StrikeContext?.StrikeDamageOverride is > 0);
            var frenzyBonus = ctx.Attacker.FrenzyAttackPending;
            if (ctx.Attacker.Kind == UnitKind.Commander)
            {
                if (ctx.Attacker.AttackedThisRound && !trampleCont && !frenzyBonus)
                    return AttackPreview.Illegal("Commander already attacked this round.");
            }
            else if (ctx.Attacker.AttackedThisTurn && !trampleCont && !frenzyBonus)
            {
                return AttackPreview.Illegal("Already attacked this turn (1 attack per unit).");
            }

            var dist = HexMath.Distance(
                new HexCoord(ctx.Attacker.Col, ctx.Attacker.Row),
                new HexCoord(ctx.Defender.Col, ctx.Defender.Row));
            var range = Math.Max(1, ctx.Attacker.Range ?? 1);
            if (!ctx.SkipRangeCheck && (dist < 1 || dist > range))
                return AttackPreview.Illegal($"Out of range (dist {dist}, range {range}).");

            var hitCtx = ctx.HitNeedContext ?? new HitNeedContext(dist, ctx.AttackerTerrain, ctx.DefenderTerrain);
            var hitNeed = BuildHitNeedBreakdown(hitCtx).FinalNeed;
            var raw = CombatDamage.StrikeDamage(ctx.StrikeContext ?? new StrikeContext(ctx.Attacker, ctx.Defender));
            if (raw <= 0)
                return AttackPreview.Illegal("Attacker has no Damage.");

            return AttackPreview.Ok(dist, hitNeed, raw);
        }

        public static AttackResult ResolveAttack(AttackContext ctx, SeededRng rng)
        {
            var preview = PreviewAttack(ctx);
            if (!preview.Legal)
                throw new InvalidOperationException(preview.Reason ?? "Illegal attack");

            var dice = RollHitDice(rng);
            var roll = dice.Item1 + dice.Item2;

            if (roll < preview.HitNeed)
            {
                return new AttackResult(preview, dice, roll, false, 0, 0, false, false);
            }

            var damageCtx = ctx.DamageContext ?? new DamageContext(ctx.Defender, ctx.Attacker);
            var hpBefore = ctx.Defender.ToughnessCurrent ?? 0;
            var damage = CombatDamage.ApplyIncomingDamage(damageCtx, preview.RawDamage);
            var killed = !damage.UnyieldingBlocked && damage.Dealt > 0 && hpBefore - damage.Dealt <= 0;
            var dist = preview.Distance;
            var leftover = killed && CombatKeywords.HasTrample(ctx.Attacker) && dist == 1
                ? CombatDamage.TrampleLeftoverDamage(preview.RawDamage, hpBefore)
                : 0;
            var trampleEligible = killed && CombatKeywords.HasTrample(ctx.Attacker) && dist == 1;
            var overpen = killed && CombatKeywords.HasOverpenetrate(ctx.Attacker) && !CombatKeywords.HasBlast(ctx.Attacker)
                ? CombatDamage.TrampleLeftoverDamage(preview.RawDamage, hpBefore)
                : 0;

            var poison = !damage.UnyieldingBlocked && damage.Dealt > 0 && !killed &&
                         CombatKeywords.HasPoison(ctx.Attacker) && ctx.Defender.PoisonTokens < 1;
            var fear = !damage.UnyieldingBlocked && damage.Dealt > 0 && !killed &&
                       !CombatKeywords.HasUnitAbility(ctx.Defender, "Fearless") && !ctx.Defender.TempFearless &&
                       CombatKeywords.HasFear(ctx.Attacker);
            var slow = !damage.UnyieldingBlocked && damage.Dealt > 0 && !killed &&
                       ctx.Attacker.Kind == UnitKind.Unit && CombatKeywords.HasSlow(ctx.Attacker) &&
                       ctx.Attacker.Seat != ctx.Defender.Seat;

            return new AttackResult(
                preview, dice, roll, true, damage.Dealt, damage.Mitigated, killed, damage.UnyieldingBlocked,
                leftover, trampleEligible, overpen, poison, fear, slow);
        }

        // --- Scout CR (play/shared/combatResolve.ts unitInOfficerRadius / effectiveRadiusForUnit) ---

        /// <summary>Whether a unit hex is inside an officer's CR (Scout extends by ScoutCrExtension).</summary>
        public static bool UnitInOfficerRadius(
            HexCoord unit,
            HexCoord officer,
            int radius,
            UnitToken unitToken = null)
        {
            var dist = HexMath.Distance(unit, officer);
            if (dist <= radius) return true;
            return unitToken != null
                   && CombatKeywords.HasScout(unitToken)
                   && dist <= radius + GameConstants.ScoutCrExtension;
        }

        /// <summary>Effective CR for display / legality for a specific unit (Scout extension).</summary>
        public static int EffectiveRadiusForUnit(int baseRadius, UnitToken unit) =>
            unit != null && CombatKeywords.HasScout(unit)
                ? baseRadius + GameConstants.ScoutCrExtension
                : baseRadius;
    }

    public readonly struct HitNeedModifier
    {
        public string Label { get; }
        /// <summary>Positive = harder to hit; negative = easier.</summary>
        public int Delta { get; }

        public HitNeedModifier(string label, int delta)
        {
            Label = label;
            Delta = delta;
        }
    }

    public readonly struct HitNeedBreakdown
    {
        public int BaseNeed { get; }
        public IReadOnlyList<HitNeedModifier> Modifiers { get; }
        public int FinalNeed { get; }

        public HitNeedBreakdown(int baseNeed, IReadOnlyList<HitNeedModifier> modifiers, int finalNeed)
        {
            BaseNeed = baseNeed;
            Modifiers = modifiers;
            FinalNeed = finalNeed;
        }
    }

    public readonly struct HitNeedContext
    {
        public int Distance { get; }
        public TerrainKind? AttackerTerrain { get; }
        public TerrainKind? DefenderTerrain { get; }
        public bool AttackerFear { get; }
        public bool DefenderEvadeActive { get; }
        public bool AttackerForestFavored { get; }
        public bool FavoredTerrainHit { get; }
        public bool Flanking { get; }
        public bool FormationDrill { get; }
        public bool PackBonus { get; }

        public HitNeedContext(
            int distance,
            TerrainKind? attackerTerrain,
            TerrainKind? defenderTerrain,
            bool attackerFear = false,
            bool defenderEvadeActive = false,
            bool attackerForestFavored = false,
            bool favoredTerrainHit = false,
            bool flanking = false,
            bool formationDrill = false,
            bool packBonus = false)
        {
            Distance = distance;
            AttackerTerrain = attackerTerrain;
            DefenderTerrain = defenderTerrain;
            AttackerFear = attackerFear;
            DefenderEvadeActive = defenderEvadeActive;
            AttackerForestFavored = attackerForestFavored;
            FavoredTerrainHit = favoredTerrainHit;
            Flanking = flanking;
            FormationDrill = formationDrill;
            PackBonus = packBonus;
        }
    }

    public readonly struct AttackContext
    {
        public UnitToken Attacker { get; }
        public UnitToken Defender { get; }
        public TerrainKind? AttackerTerrain { get; }
        public TerrainKind? DefenderTerrain { get; }
        public HitNeedContext? HitNeedContext { get; }
        public StrikeContext? StrikeContext { get; }
        public DamageContext? DamageContext { get; }
        public bool SkipRangeCheck { get; }

        public AttackContext(
            UnitToken attacker,
            UnitToken defender,
            TerrainKind? attackerTerrain = null,
            TerrainKind? defenderTerrain = null,
            HitNeedContext? hitNeedContext = null,
            StrikeContext? strikeContext = null,
            DamageContext? damageContext = null,
            bool skipRangeCheck = false)
        {
            Attacker = attacker;
            Defender = defender;
            AttackerTerrain = attackerTerrain;
            DefenderTerrain = defenderTerrain;
            HitNeedContext = hitNeedContext;
            StrikeContext = strikeContext;
            DamageContext = damageContext;
            SkipRangeCheck = skipRangeCheck;
        }
    }

    public readonly struct AttackPreview
    {
        public bool Legal { get; }
        public string Reason { get; }
        public int Distance { get; }
        public int HitNeed { get; }
        public int RawDamage { get; }

        public static AttackPreview Illegal(string reason) =>
            new(false, reason, 0, 0, 0);

        public static AttackPreview Ok(int distance, int hitNeed, int rawDamage) =>
            new(true, null, distance, hitNeed, rawDamage);

        AttackPreview(bool legal, string reason, int distance, int hitNeed, int rawDamage)
        {
            Legal = legal;
            Reason = reason;
            Distance = distance;
            HitNeed = hitNeed;
            RawDamage = rawDamage;
        }
    }

    public readonly struct AttackResult
    {
        public AttackPreview Preview { get; }
        public (int, int) Dice { get; }
        public int Roll { get; }
        public bool Hit { get; }
        public int Dealt { get; }
        public int Mitigated { get; }
        public bool Killed { get; }
        public bool UnyieldingBlocked { get; }

        public bool TrampleEligible { get; }
        public int TrampleLeftover { get; }
        public int OverpenetrateLeftover { get; }
        public bool PoisonApplied { get; }
        public bool FearApplied { get; }
        public bool SlowApplied { get; }

        public AttackResult(
            AttackPreview preview,
            (int, int) dice,
            int roll,
            bool hit,
            int dealt,
            int mitigated,
            bool killed,
            bool unyieldingBlocked,
            int trampleLeftover = 0,
            bool trampleEligible = false,
            int overpenetrateLeftover = 0,
            bool poisonApplied = false,
            bool fearApplied = false,
            bool slowApplied = false)
        {
            Preview = preview;
            Dice = dice;
            Roll = roll;
            Hit = hit;
            Dealt = dealt;
            Mitigated = mitigated;
            Killed = killed;
            UnyieldingBlocked = unyieldingBlocked;
            TrampleLeftover = trampleLeftover;
            TrampleEligible = trampleEligible;
            OverpenetrateLeftover = overpenetrateLeftover;
            PoisonApplied = poisonApplied;
            FearApplied = fearApplied;
            SlowApplied = slowApplied;
        }
    }
}
