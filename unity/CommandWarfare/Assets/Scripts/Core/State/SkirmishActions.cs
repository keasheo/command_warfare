using System.Collections.Generic;
using System.Linq;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    public enum SkirmishActionKind { EndTurn, Move, Attack, ActivateCommander }

    public readonly struct SkirmishAction
    {
        public SkirmishActionKind Kind { get; }
        public string UnitId { get; }
        public HexCoord Dest { get; }
        public string TargetUnitId { get; }

        public static SkirmishAction End() => new(SkirmishActionKind.EndTurn, null, default, null);

        public static SkirmishAction Move(string unitId, HexCoord dest) =>
            new(SkirmishActionKind.Move, unitId, dest, null);

        public static SkirmishAction Attack(string unitId, string targetId) =>
            new(SkirmishActionKind.Attack, unitId, default, targetId);

        public static SkirmishAction ActivateCommander() =>
            new(SkirmishActionKind.ActivateCommander, null, default, null);

        SkirmishAction(SkirmishActionKind kind, string unitId, HexCoord dest, string targetId)
        {
            Kind = kind;
            UnitId = unitId;
            Dest = dest;
            TargetUnitId = targetId;
        }
    }

    /// <summary>Shared move/attack resolution for player input and AI.</summary>
    public static class SkirmishActions
    {
        public static bool ExecuteMove(GameState state, UnitToken unit, HexCoord dest)
        {
            var guards = CollectDisengageGuards(state, unit);
            if (!Movement.ApplyMove(state, unit, dest)) return false;

            var parts = new List<string>();
            foreach (var guard in guards)
            {
                if (!state.Units.Contains(guard)) continue;
                if (HexMath.Distance(new HexCoord(guard.Col, guard.Row), new HexCoord(unit.Col, unit.Row)) <= 1)
                    continue;
                var strike = ApplyDisengageStrike(state, guard, unit);
                if (!string.IsNullOrEmpty(strike))
                    parts.Add(strike);
            }

            var log = ObjectiveSystem.RecalculateControl(state);
            if (!string.IsNullOrEmpty(log))
                parts.Add(log);
            if (parts.Count > 0)
                state.LastActionLog = string.Join(" · ", parts);
            return true;
        }

        public static bool ExecuteAttack(
            GameState state,
            UnitToken attacker,
            UnitToken defender,
            SeededRng rng,
            CardDatabase cards,
            out string log)
        {
            log = null;
            if (attacker.Kind != UnitKind.Commander &&
                !CompanyActivation.IsUnitInActiveCompany(state, attacker))
                return false;

            var targetKey = HexMath.Key(defender.Col, defender.Row);
            if (!MoveReachability.AttackTargetKeys(state, attacker).Contains(targetKey))
                return false;

            if (attacker.BonePrisoned)
                return false;

            var parts = new List<string>();
            var dist = HexMath.Distance(
                new HexCoord(attacker.Col, attacker.Row),
                new HexCoord(defender.Col, defender.Row));
            var useCleave = CombatKeywords.HasCleave(attacker) &&
                            !CombatKeywords.HasBlast(attacker) &&
                            dist == 1 &&
                            CombatDamage.EffectiveDamage(attacker) > 1;

            if (useCleave)
            {
                var plan = BuildCleavePlan(state, attacker, defender);
                foreach (var (target, dmg) in plan)
                {
                    if (!state.Units.Contains(target)) continue;
                    if (!ResolveSingleStrike(state, attacker, target, rng, cards, out var part,
                            strikeDamageOverride: dmg, skipKillFollowups: plan.Count > 1))
                    {
                        if (parts.Count == 0) return false;
                        break;
                    }
                    parts.Add(part);
                }
            }
            else
            {
                var strikes = CombatKeywords.MultiStrikeCount(attacker);
                for (var i = 0; i < strikes; i++)
                {
                    if (!state.Units.Contains(defender))
                        break;
                    if (!ResolveSingleStrike(state, attacker, defender, rng, cards, out var part))
                    {
                        if (i == 0) return false;
                        break;
                    }
                    parts.Add(part);
                }
            }

            attacker.TrampleLeftoverDamage = 0;
            attacker.AttackedThisTurn = attacker.Kind != UnitKind.Commander;
            attacker.AttackedThisRound = attacker.Kind == UnitKind.Commander || attacker.AttackedThisRound;

            if (CombatKeywords.HasUnitAbility(attacker, "Harass"))
            {
                attacker.HarassMovePending = true;
                parts.Add("Harass: free Move 1 available");
            }

            var objLog = ObjectiveSystem.RecalculateControl(state);
            if (!string.IsNullOrEmpty(objLog))
                parts.Add(objLog);

            log = string.Join(" · ", parts);
            return parts.Count > 0;
        }

        /// <summary>Resolve a player-declared Cleave plan (assignments before Hit rolls).</summary>
        public static bool ExecuteCleavePlan(
            GameState state,
            PendingCleave pending,
            SeededRng rng,
            CardDatabase cards,
            out string log)
        {
            log = null;
            if (pending == null || pending.Assignments == null || pending.Assignments.Count == 0)
                return false;
            CleavePlanner.FinalizeRemainder(pending);
            var attacker = state.Units.Find(u => u.Id == pending.AttackerId);
            if (attacker == null) return false;

            var parts = new List<string>();
            var multi = pending.Assignments.Count > 1;
            foreach (var a in pending.Assignments)
            {
                var target = state.Units.Find(u => u.Id == a.TargetId);
                if (target == null || a.Damage <= 0) continue;
                if (!ResolveSingleStrike(state, attacker, target, rng, cards, out var part,
                        strikeDamageOverride: a.Damage, skipKillFollowups: multi))
                {
                    if (parts.Count == 0) return false;
                    continue;
                }
                parts.Add(part);
            }

            attacker.TrampleLeftoverDamage = 0;
            attacker.AttackedThisTurn = attacker.Kind != UnitKind.Commander;
            attacker.AttackedThisRound = attacker.Kind == UnitKind.Commander || attacker.AttackedThisRound;
            if (CombatKeywords.HasUnitAbility(attacker, "Harass"))
            {
                attacker.HarassMovePending = true;
                parts.Add("Harass: free Move 1 available");
            }
            var objLog = ObjectiveSystem.RecalculateControl(state);
            if (!string.IsNullOrEmpty(objLog))
                parts.Add(objLog);
            state.PendingCleave = null;
            log = string.Join(" · ", parts);
            return parts.Count > 0;
        }

        static List<(UnitToken Target, int Damage)> BuildCleavePlan(
            GameState state,
            UnitToken attacker,
            UnitToken primary)
        {
            var total = CombatDamage.EffectiveDamage(attacker);
            var origin = new HexCoord(attacker.Col, attacker.Row);
            var candidates = new List<UnitToken> { primary };
            foreach (var u in state.Units)
            {
                if (u.Id == primary.Id || u.Seat == attacker.Seat) continue;
                if (u.ToughnessCurrent == null) continue;
                if (u.Kind == UnitKind.Commander && (u.ToughnessCurrent ?? 0) <= 0) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) != 1) continue;
                candidates.Add(u);
            }

            candidates.Sort((a, b) =>
            {
                if (a.Id == primary.Id) return -1;
                if (b.Id == primary.Id) return 1;
                return (a.ToughnessCurrent ?? 0).CompareTo(b.ToughnessCurrent ?? 0);
            });

            var n = System.Math.Min(total, candidates.Count);
            var chosen = candidates.GetRange(0, n);
            var assigned = new int[chosen.Count];
            for (var i = 0; i < chosen.Count; i++)
                assigned[i] = 1;
            var left = total - chosen.Count;
            assigned[0] += left;

            var plan = new List<(UnitToken, int)>();
            for (var i = 0; i < chosen.Count; i++)
                plan.Add((chosen[i], assigned[i]));
            return plan;
        }

        static List<UnitToken> CollectDisengageGuards(GameState state, UnitToken mover)
        {
            var guards = new List<UnitToken>();
            var origin = new HexCoord(mover.Col, mover.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == mover.Seat) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) != 1) continue;
                if (UnitHasGuard(state, u))
                    guards.Add(u);
            }
            return guards;
        }

        static bool UnitHasGuard(GameState state, UnitToken unit)
        {
            if (CombatKeywords.HasGuard(unit)) return true;
            var key = HexMath.Key(unit.Col, unit.Row);
            var terrain = state.Terrain.TryGetValue(key, out var t) ? t : TerrainKind.Plains;
            return FavoredTerrain.GrantsGuard(unit, null, terrain);
        }

        static string ApplyDisengageStrike(GameState state, UnitToken guard, UnitToken mover)
        {
            if (mover.ToughnessCurrent == null) return null;
            var dmg = System.Math.Max(1, CombatDamage.EffectiveDamage(guard));
            mover.ToughnessCurrent = System.Math.Max(0, mover.ToughnessCurrent.Value - dmg);
            var note = $"{guard.CardName} Disengage Strike hits {mover.CardName} for {dmg}";
            if ((mover.ToughnessCurrent ?? 0) <= 0)
            {
                if (!TryRevenant(mover))
                {
                    UnitDestruction.RemoveDead(state, mover, out _);
                    note += " — destroyed";
                }
                else
                    note += " — Revenant";
            }
            return note;
        }

        static bool ResolveSingleStrike(
            GameState state,
            UnitToken attacker,
            UnitToken defender,
            SeededRng rng,
            CardDatabase cards,
            out string log,
            int? strikeDamageOverride = null,
            bool skipKillFollowups = false)
        {
            log = null;
            var atkTerrain = TerrainAt(state, attacker);
            var defTerrain = TerrainAt(state, defender);
            var dist = HexMath.Distance(
                new HexCoord(attacker.Col, attacker.Row),
                new HexCoord(defender.Col, defender.Row));

            var atkCard = cards?.FindById(attacker.CardId);
            var defCard = cards?.FindById(defender.CardId);
            var favoredHit = FavoredTerrain.GrantsHitBonus(attacker, atkCard, atkTerrain);
            var favoredDmg = FavoredTerrain.GrantsDamageBonus(attacker, atkCard, atkTerrain);
            var flanking = IsFlanking(state, attacker, defender);
            var formationDrill = Formation.DrillHitBonus(state, attacker, cards) > 0;
            var packBonus = dist == 1 && Formation.PackMeleeHitBonus(state, attacker);
            var formationGuard = Formation.GuardMitigation(state, defender, cards);
            var defKey = HexMath.Key(defender.Col, defender.Row);
            var fortified = state.FortifiedHexes.TryGetValue(defKey, out var fort) && fort;

            var hitCtx = new HitNeedContext(
                dist, atkTerrain, defTerrain,
                attackerFear: StatusEffects.UnitHasFearPenalty(attacker),
                defenderEvadeActive: defender.EvadeActive,
                attackerForestFavored: FavoredTerrain.HasForestFavored(attacker, atkCard),
                favoredTerrainHit: favoredHit,
                flanking: flanking,
                formationDrill: formationDrill,
                packBonus: packBonus);

            var strikeCtx = new StrikeContext(
                attacker, defender,
                favoredTerrainDamage: favoredDmg,
                strikeDamageOverride: strikeDamageOverride ??
                    (attacker.TrampleLeftoverDamage > 0 ? attacker.TrampleLeftoverDamage : null),
                attackerTags: DamageTypes.TagsFrom(atkCard),
                defenderTags: DamageTypes.TagsFrom(defCard),
                fortifiedTarget: fortified);

            var damageCtx = new DamageContext(
                defender, attacker,
                fortifiedHex: fortified,
                mountainsFavoredHarden: FavoredTerrain.GrantsHardenBonus(defender, defCard, defTerrain),
                formationGuard: formationGuard,
                shieldwallAdjacent: HasShieldwallAdjacent(state, defender));

            var ctx = new AttackContext(
                attacker, defender, atkTerrain, defTerrain,
                hitCtx, strikeCtx, damageCtx);

            try
            {
                var result = CombatResolve.ResolveAttack(ctx, rng);
                log = result.Hit
                    ? $"{attacker.CardName} hit {defender.CardName} for {result.Dealt} (roll {result.Roll} vs {result.Preview.HitNeed})"
                    : $"{attacker.CardName} missed {defender.CardName} (roll {result.Roll} vs {result.Preview.HitNeed})";

                if (attacker.FrenzyAttackPending)
                    attacker.FrenzyAttackPending = false;

                state.PendingTrample = null;

                if (result.Hit && result.UnyieldingBlocked)
                    defender.Unyielding = false;

                if (result.Hit && !result.UnyieldingBlocked)
                {
                    defender.ToughnessCurrent = (defender.ToughnessCurrent ?? 0) - result.Dealt;
                    CombatFollowup.ApplyHitStatuses(defender, result);

                    var counter = CombatFollowup.ApplyCounterattack(state, attacker, defender, result);
                    if (!string.IsNullOrEmpty(counter))
                        log += " · " + counter;

                    var splash = skipKillFollowups
                        ? null
                        : CombatFollowup.ApplyBlastSplash(state, attacker, defender, rng, cards);
                    if (!string.IsNullOrEmpty(splash))
                        log += " · " + splash;

                    if (result.Killed)
                    {
                        if (TryRevenant(defender))
                        {
                            log += " · Revenant: returns with half Toughness";
                        }
                        else
                        {
                            if (!skipKillFollowups)
                            {
                                CombatFollowup.ApplyOverpenetrate(state, attacker, defender, result.OverpenetrateLeftover, rng, cards);
                                CombatFollowup.OfferTrample(state, attacker, defender, result);
                                if (CombatKeywords.HasFrenzy(attacker))
                                    attacker.FrenzyAttackPending = true;
                            }
                            if ((defender.ToughnessCurrent ?? 0) > 0)
                                defender.ToughnessCurrent = 0;
                            UnitDestruction.RemoveDead(state, defender, out _);
                        }
                    }
                }
                return true;
            }
            catch (System.InvalidOperationException)
            {
                return false;
            }
        }

        static bool TryRevenant(UnitToken unit)
        {
            if (unit.RevenantUsed) return false;
            if (!CombatKeywords.HasUnitAbility(unit, "Revenant")) return false;
            if (unit.Toughness == null || unit.Toughness <= 0) return false;
            var half = System.Math.Max(1, unit.Toughness.Value / 2);
            unit.ToughnessCurrent = half;
            unit.RevenantUsed = true;
            return true;
        }

        static bool HasShieldwallAdjacent(GameState state, UnitToken defender)
        {
            if (!CombatKeywords.HasUnitAbility(defender, "Shieldwall")) return false;
            var origin = new HexCoord(defender.Col, defender.Row);
            foreach (var u in state.Units)
            {
                if (u.Id == defender.Id || u.Seat != defender.Seat) continue;
                if (!CombatKeywords.HasUnitAbility(u, "Shieldwall")) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) == 1)
                    return true;
            }
            return false;
        }

        static bool IsFlanking(GameState state, UnitToken attacker, UnitToken defender)
        {
            if (!CombatDamage.HasAbility(attacker, "Flanking")) return false;
            var defTerrain = TerrainAt(state, defender);
            var atkTerrain = TerrainAt(state, attacker);
            if (TerrainCombatRules.SwampBlocksFlanking(defTerrain, atkTerrain))
                return false;

            var defCoord = new HexCoord(defender.Col, defender.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat != attacker.Seat || u.Id == attacker.Id) continue;
                if (HexMath.Distance(new HexCoord(u.Col, u.Row), defCoord) == 1)
                    return true;
            }
            return false;
        }

        static TerrainKind TerrainAt(GameState state, UnitToken unit)
        {
            var key = HexMath.Key(unit.Col, unit.Row);
            return state.Terrain.TryGetValue(key, out var t) ? t : TerrainKind.Plains;
        }
    }

    /// <summary>Simple greedy AI for dev skirmish — attack if possible, else advance.</summary>
    public static class SkirmishAiPlanner
    {
        public static SkirmishAction PlanTurn(GameState state, SeatId seat)
        {
            var units = state.Units.Where(u => u.Seat == seat && u.Kind != UnitKind.Commander).ToList();
            if (units.Count == 0) return SkirmishAction.End();

            // Prefer Frenzy follow-up attackers first.
            var ordered = units
                .OrderByDescending(u => u.FrenzyAttackPending)
                .ThenByDescending(u => u.Damage ?? 0)
                .ToList();

            foreach (var attacker in ordered)
            {
                if (attacker.AttackedThisTurn && !attacker.FrenzyAttackPending) continue;
                var targets = AttackTargets(state, attacker);
                var kill = targets
                    .Where(t => (t.ToughnessCurrent ?? 0) <= (attacker.Damage ?? 0))
                    .OrderBy(t => t.ToughnessCurrent ?? 0)
                    .FirstOrDefault();
                if (kill != null)
                    return SkirmishAction.Attack(attacker.Id, kill.Id);

                if (targets.Count > 0)
                    return SkirmishAction.Attack(attacker.Id, targets[0].Id);
            }

            var enemies = state.Units.Where(u =>
                u.Seat != seat &&
                (u.Kind != UnitKind.Commander || (u.ToughnessCurrent ?? 0) > 0)).ToList();
            if (enemies.Count == 0) return SkirmishAction.End();

            UnitToken bestUnit = null;
            HexCoord bestDest = default;
            var bestScore = int.MaxValue;

            foreach (var unit in units.Where(u => u.MoveRemaining > 0 || u.HarassMovePending))
            {
                var reachable = MoveReachability.ReachableHexes(state, unit);
                foreach (var key in reachable)
                {
                    var dest = HexMath.ParseKey(key);
                    var score = enemies.Min(e =>
                        HexMath.Distance(dest, new HexCoord(e.Col, e.Row)));
                    if (score < bestScore)
                    {
                        bestScore = score;
                        bestUnit = unit;
                        bestDest = dest;
                    }
                }
            }

            if (bestUnit != null)
                return SkirmishAction.Move(bestUnit.Id, bestDest);

            return SkirmishAction.End();
        }

        static List<UnitToken> AttackTargets(GameState state, UnitToken attacker)
        {
            var keys = MoveReachability.AttackTargetKeys(state, attacker);
            return state.Units
                .Where(u => keys.Contains(HexMath.Key(u.Col, u.Row)))
                .ToList();
        }
    }
}
