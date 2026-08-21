using System;
using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    public enum AiDifficulty { Easy, Medium, Hard }

    /// <summary>Port of play/server/aiBot.ts DifficultyPolicy.</summary>
    public readonly struct AiDifficultyPolicy
    {
        public float Noise { get; }
        public float EndTurnBias { get; }
        public float AbilityChance { get; }
        public float Aggression { get; }
        public float ObjectiveFocus { get; }
        public float ThinkDelayMin { get; }
        public float ThinkDelayMax { get; }

        public AiDifficultyPolicy(
            float noise, float endTurnBias, float abilityChance,
            float aggression, float objectiveFocus,
            float thinkMin, float thinkMax)
        {
            Noise = noise;
            EndTurnBias = endTurnBias;
            AbilityChance = abilityChance;
            Aggression = aggression;
            ObjectiveFocus = objectiveFocus;
            ThinkDelayMin = thinkMin;
            ThinkDelayMax = thinkMax;
        }

        public static AiDifficultyPolicy For(AiDifficulty d) => d switch
        {
            AiDifficulty.Easy => new(0.65f, 0.45f, 0.05f, 0.55f, 0.28f, 0.45f, 0.90f),
            AiDifficulty.Hard => new(0.06f, 0.02f, 0.55f, 1.35f, 1.05f, 0.22f, 0.48f),
            _ => new(0.22f, 0.12f, 0.28f, 1.0f, 0.55f, 0.32f, 0.65f),
        };
    }

    /// <summary>Scored multi-action AI — port of play/server/aiBot.ts play loop.</summary>
    public static class SkirmishAiBot
    {
        static readonly HashSet<string> SimpleAbilities = new(StringComparer.OrdinalIgnoreCase)
        {
            "Heal", "Repair", "Rebuild Protocol", "Bolster", "Inspire",
        };

        struct Scored
        {
            public SkirmishAction Action;
            public float Score;
        }

        public static SkirmishAction ChoosePlayAction(
            GameState state,
            SeatId seat,
            AiDifficulty difficulty,
            CardDatabase cards,
            SeededRng rng)
        {
            if (state == null || state.Phase != Phase.Play || state.ActiveSeat != seat)
                return SkirmishAction.End();

            var policy = AiDifficultyPolicy.For(difficulty);
            var scored = EnumeratePlayActions(state, seat, policy, cards, rng);
            return PickScored(scored, policy, rng);
        }

        static SkirmishAction PickScored(List<Scored> scored, AiDifficultyPolicy policy, SeededRng rng)
        {
            if (scored == null || scored.Count == 0) return SkirmishAction.End();
            if (rng.NextFloat() < policy.Noise)
                return scored[rng.NextInt(scored.Count)].Action;

            scored.Sort((a, b) => b.Score.CompareTo(a.Score));
            if (scored.Count > 1 && policy.Noise > 0.1f && rng.NextFloat() < policy.Noise * 0.5f)
                return scored[1].Action;
            return scored[0].Action;
        }

        static List<Scored> EnumeratePlayActions(
            GameState state,
            SeatId seat,
            AiDifficultyPolicy policy,
            CardDatabase cards,
            SeededRng rng)
        {
            var outList = new List<Scored>();
            var mine = new List<UnitToken>();
            var enemies = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat == seat) mine.Add(u);
                else if (u.Kind != UnitKind.Commander) enemies.Add(u);
            }

            if (state.PendingTrample != null)
            {
                var atk = Find(state, state.PendingTrample.AttackerId);
                if (atk != null && atk.Seat == seat)
                {
                    outList.Add(new Scored
                    {
                        Action = SkirmishAction.ContinueTrample(),
                        Score = 80f * policy.Aggression,
                    });
                    outList.Add(new Scored
                    {
                        Action = SkirmishAction.DeclineTrample(),
                        Score = 10f,
                    });
                    return outList;
                }
            }

            // Attacks
            foreach (var attacker in mine)
            {
                if ((attacker.Damage ?? 0) <= 0 && attacker.TrampleLeftoverDamage <= 0)
                    continue;
                if (BoardAlreadyAttacked(attacker)) continue;

                foreach (var defender in enemies)
                {
                    if (!SkirmishActions.TryPreviewAttack(
                            state, attacker, defender, cards, out var preview, out _))
                        continue;
                    var kill = defender.ToughnessCurrent != null &&
                               preview.RawDamage >= defender.ToughnessCurrent.Value
                        ? 40f
                        : 0f;
                    outList.Add(new Scored
                    {
                        Action = SkirmishAction.Attack(attacker.Id, defender.Id),
                        Score = (35f + preview.RawDamage * 8f + kill) * policy.Aggression,
                    });
                }
            }

            // Activate commander
            if (!CommanderActivation.IsCommanderActivatedThisRound(state, seat))
            {
                foreach (var u in mine)
                {
                    if (u.Kind != UnitKind.Commander) continue;
                    outList.Add(new Scored
                    {
                        Action = SkirmishAction.ActivateCommander(),
                        Score = 18f + policy.Aggression * 4f,
                    });
                    break;
                }
            }

            // Activate companies
            var activatedThisTurn = state.CompanyActivatedThisTurn != null &&
                                    state.CompanyActivatedThisTurn.TryGetValue(seat, out var turnedOn) &&
                                    !string.IsNullOrEmpty(turnedOn);
            if (!activatedThisTurn)
            {
                foreach (var officer in mine)
                {
                    if (officer.Kind != UnitKind.Officer) continue;
                    if (state.ActiveCompanyOfficerId == officer.Id) continue;
                    if (state.CompaniesActivatedThisRound != null &&
                        state.CompaniesActivatedThisRound.TryGetValue(officer.Id, out var done) && done)
                        continue;

                    var company = CompanyMembers(mine, officer);
                    var near = NearestEnemyDist(enemies, new HexCoord(officer.Col, officer.Row));
                    foreach (var m in company)
                        near = Math.Min(near, NearestEnemyDist(enemies, new HexCoord(m.Col, m.Row)));
                    var proximity = float.IsInfinity(near) ? 0f : Math.Max(0f, 20f - near);
                    var objPull = CompanyObjectivePull(state, seat, company);
                    outList.Add(new Scored
                    {
                        Action = SkirmishAction.ActivateCompany(officer.Id),
                        Score = 15f + proximity * policy.Aggression +
                                objPull * 0.55f * policy.ObjectiveFocus,
                    });
                }
            }

            // Moves
            var movable = new List<UnitToken>();
            foreach (var u in mine)
            {
                if (u.MoveRemaining <= 0 && !u.HarassMovePending) continue;
                if (u.Rooted || u.BonePrisoned) continue;
                if (u.Kind == UnitKind.Commander)
                {
                    movable.Add(u);
                    continue;
                }
                if (CompanyActivation.IsUnitInActiveCompany(state, u))
                    movable.Add(u);
            }

            foreach (var unit in movable)
            {
                var reach = Movement.ReachableMoveHexes(state, unit);
                if (reach.Count == 0) continue;

                var enemyGoal = NearestEnemy(enemies, new HexCoord(unit.Col, unit.Row));
                var objGoal = NearestContestObjectiveHex(state, seat, new HexCoord(unit.Col, unit.Row), unit.Id);
                var blocked = OccupiedKeys(state);
                blocked.Remove(HexMath.Key(unit.Col, unit.Row));
                if (enemyGoal != null)
                    blocked.Remove(HexMath.Key(enemyGoal.Col, enemyGoal.Row));
                if (objGoal.HasValue)
                    blocked.Remove(HexMath.Key(objGoal.Value.Col, objGoal.Value.Row));

                var traveler = Movement.MoveTraveler.FromUnit(unit);
                var enemyPath = enemyGoal != null
                    ? Movement.PassablePathDistances(state, new HexCoord(enemyGoal.Col, enemyGoal.Row), blocked, traveler)
                    : null;
                var objPath = objGoal.HasValue
                    ? Movement.PassablePathDistances(state, objGoal.Value, blocked, traveler)
                    : null;

                var unitCell = new HexCoord(unit.Col, unit.Row);
                var pathBeforeEnemy = PathDistOr(enemyPath, unitCell, 40);
                var pathBeforeObj = PathDistOr(objPath, unitCell, 40);
                var crowBefore = NearestEnemyDist(enemies, unitCell);
                var onHexBefore = ObjectiveOnHexValue(state, seat, unitCell, unit.Id);

                Scored? bestMove = null;
                foreach (var kv in reach)
                {
                    var cell = new HexCoord(kv.Value.Col, kv.Value.Row);
                    if (cell.Col == unit.Col && cell.Row == unit.Row) continue;

                    var pathAfterEnemy = PathDistOr(enemyPath, cell, 40);
                    var pathAfterObj = PathDistOr(objPath, cell, 40);
                    var pathClosedEnemy = pathBeforeEnemy - pathAfterEnemy;
                    var pathClosedObj = pathBeforeObj - pathAfterObj;
                    var crowAfter = NearestEnemyDist(enemies, cell);
                    var crowClosed =
                        (float.IsInfinity(crowBefore) ? 30f : crowBefore) -
                        (float.IsInfinity(crowAfter) ? 30f : crowAfter);
                    var onHexAfter = ObjectiveOnHexValue(state, seat, cell, unit.Id);
                    var onHexDelta = onHexAfter - onHexBefore;
                    var shoreTrap = crowClosed > 0 && pathClosedEnemy <= 0 && pathBeforeEnemy < 40 ? 1f : 0f;
                    var score =
                        pathClosedEnemy * 14f * policy.Aggression +
                        pathClosedObj * 11f * policy.ObjectiveFocus +
                        onHexDelta * 0.95f * policy.ObjectiveFocus +
                        crowClosed * 2f * policy.Aggression +
                        (kv.Value.Spent > 0 ? 2f : 0f) -
                        (pathClosedEnemy < 0 ? 10f : 0f) -
                        shoreTrap * 18f;

                    if (bestMove == null || score > bestMove.Value.Score)
                    {
                        bestMove = new Scored
                        {
                            Action = SkirmishAction.Move(unit.Id, cell),
                            Score = score,
                        };
                    }
                }
                if (bestMove.HasValue && bestMove.Value.Score > 0f)
                    outList.Add(bestMove.Value);
            }

            var companyActive = activatedThisTurn || !string.IsNullOrEmpty(state.ActiveCompanyOfficerId);
            var endBias = companyActive
                ? policy.EndTurnBias * 40f + (movable.Count == 0 ? 25f : 5f)
                : 1f + policy.EndTurnBias * 40f;

            if (rng.NextFloat() < policy.AbilityChance)
            {
                foreach (var caster in mine)
                {
                    var names = new List<string>();
                    if (caster.Abilities != null) names.AddRange(caster.Abilities);
                    if (!string.IsNullOrEmpty(caster.Ultimate)) names.Add(caster.Ultimate);
                    foreach (var abilityName in names)
                    {
                        if (!SimpleAbilities.Contains(abilityName)) continue;
                        var allies = new List<UnitToken>();
                        foreach (var u in mine)
                        {
                            if (u.Id == caster.Id) continue;
                            if (u.ToughnessCurrent == null || u.Toughness == null) continue;
                            if (u.ToughnessCurrent < u.Toughness) allies.Add(u);
                        }
                        if (allies.Count == 0)
                        {
                            outList.Add(new Scored
                            {
                                Action = SkirmishAction.CastAbility(caster.Id, abilityName, null),
                                Score = 22f * policy.Aggression,
                            });
                        }
                        else
                        {
                            foreach (var target in allies)
                            {
                                outList.Add(new Scored
                                {
                                    Action = SkirmishAction.CastAbility(caster.Id, abilityName, target.Id),
                                    Score = 22f * policy.Aggression + 8f,
                                });
                            }
                        }
                    }
                }
            }

            outList.Add(new Scored { Action = SkirmishAction.End(), Score = endBias });
            return outList;
        }

        static bool BoardAlreadyAttacked(UnitToken attacker)
        {
            if (attacker.TrampleLeftoverDamage > 0 || attacker.FrenzyAttackPending) return false;
            return attacker.Kind == UnitKind.Commander
                ? attacker.AttackedThisRound
                : attacker.AttackedThisTurn;
        }

        static UnitToken Find(GameState state, string id)
        {
            if (string.IsNullOrEmpty(id) || state?.Units == null) return null;
            foreach (var u in state.Units)
                if (u.Id == id) return u;
            return null;
        }

        static List<UnitToken> CompanyMembers(List<UnitToken> mine, UnitToken officer)
        {
            var list = new List<UnitToken> { officer };
            foreach (var u in mine)
            {
                if (u.Id == officer.Id) continue;
                if (u.OfficerCardId == officer.CardId) list.Add(u);
            }
            return list;
        }

        static UnitToken NearestEnemy(List<UnitToken> enemies, HexCoord cell)
        {
            UnitToken best = null;
            var bestDist = int.MaxValue;
            foreach (var u in enemies)
            {
                var d = HexMath.Distance(cell, new HexCoord(u.Col, u.Row));
                if (d < bestDist)
                {
                    bestDist = d;
                    best = u;
                }
            }
            return best;
        }

        static float NearestEnemyDist(List<UnitToken> enemies, HexCoord cell)
        {
            if (enemies == null || enemies.Count == 0) return float.PositiveInfinity;
            var best = float.PositiveInfinity;
            foreach (var u in enemies)
            {
                var d = HexMath.Distance(cell, new HexCoord(u.Col, u.Row));
                if (d < best) best = d;
            }
            return best;
        }

        static HashSet<string> OccupiedKeys(GameState state)
        {
            var set = new HashSet<string>();
            foreach (var u in state.Units)
                set.Add(HexMath.Key(u.Col, u.Row));
            return set;
        }

        static int PathDistOr(Dictionary<string, int> distances, HexCoord cell, int fallback)
        {
            if (distances == null) return fallback;
            return distances.TryGetValue(HexMath.Key(cell.Col, cell.Row), out var d) ? d : fallback;
        }

        struct ZonePresence
        {
            public ObjectiveMarker Objective;
            public HashSet<string> ZoneKeys;
            public int Friendly;
            public int Enemy;
        }

        static ZonePresence BuildZonePresence(
            GameState state, SeatId seat, ObjectiveMarker objective, string excludeUnitId)
        {
            var zoneKeys = new HashSet<string>();
            foreach (var h in ObjectiveSystem.ZoneHexes(objective))
                zoneKeys.Add(HexMath.Key(h.Col, h.Row));
            var friendly = 0;
            var enemy = 0;
            foreach (var u in state.Units)
            {
                if (excludeUnitId != null && u.Id == excludeUnitId) continue;
                if (!zoneKeys.Contains(HexMath.Key(u.Col, u.Row))) continue;
                if (u.Seat == seat) friendly++;
                else enemy++;
            }
            return new ZonePresence
            {
                Objective = objective,
                ZoneKeys = zoneKeys,
                Friendly = friendly,
                Enemy = enemy,
            };
        }

        static float ZoneContestPriority(ZonePresence presence, SeatId seat)
        {
            var friendly = presence.Friendly;
            var enemy = presence.Enemy;
            var controller = presence.Objective.Controller;
            if (friendly == 0 && enemy == 0) return 42f;
            if (friendly == enemy) return 48f;
            if (friendly == enemy - 1) return 55f;
            if (friendly > enemy)
                return friendly == enemy + 1 ? 14f : 4f;
            if (controller.HasValue && controller.Value != seat) return 28f;
            return 22f;
        }

        static float ObjectiveOnHexValue(
            GameState state, SeatId seat, HexCoord cell, string movingUnitId)
        {
            if (state.Objectives == null || state.Objectives.Count == 0) return 0f;
            var key = HexMath.Key(cell.Col, cell.Row);
            var best = 0f;
            foreach (var objective in state.Objectives)
            {
                var presence = BuildZonePresence(state, seat, objective, movingUnitId);
                if (!presence.ZoneKeys.Contains(key)) continue;
                best = Math.Max(best, ZoneContestPriority(presence, seat));
            }
            return best;
        }

        static float ObjectiveCellValue(
            GameState state, SeatId seat, HexCoord cell, string movingUnitId)
        {
            if (state.Objectives == null || state.Objectives.Count == 0) return 0f;
            var onHex = ObjectiveOnHexValue(state, seat, cell, movingUnitId);
            if (onHex > 0f) return onHex;
            var dist = NearestContestObjectiveDist(state, seat, cell, movingUnitId);
            if (float.IsInfinity(dist)) return 0f;
            return Math.Max(0f, 16f - dist);
        }

        static float NearestContestObjectiveDist(
            GameState state, SeatId seat, HexCoord cell, string movingUnitId)
        {
            var best = float.PositiveInfinity;
            if (state.Objectives == null) return best;
            foreach (var objective in state.Objectives)
            {
                var presence = BuildZonePresence(state, seat, objective, movingUnitId);
                if (ZoneContestPriority(presence, seat) < 8f) continue;
                foreach (var h in ObjectiveSystem.ZoneHexes(objective))
                    best = Math.Min(best, HexMath.Distance(cell, h));
            }
            return best;
        }

        static float CompanyObjectivePull(GameState state, SeatId seat, List<UnitToken> company)
        {
            if (state.Objectives == null || state.Objectives.Count == 0 || company == null)
                return 0f;
            var best = 0f;
            foreach (var u in company)
            {
                best = Math.Max(best,
                    ObjectiveCellValue(state, seat, new HexCoord(u.Col, u.Row), u.Id));
            }
            return best;
        }

        static HexCoord? NearestContestObjectiveHex(
            GameState state, SeatId seat, HexCoord cell, string movingUnitId)
        {
            HexCoord? bestHex = null;
            var bestDist = int.MaxValue;
            if (state.Objectives == null) return null;
            foreach (var objective in state.Objectives)
            {
                var presence = BuildZonePresence(state, seat, objective, movingUnitId);
                if (ZoneContestPriority(presence, seat) < 8f) continue;
                foreach (var h in ObjectiveSystem.ZoneHexes(objective))
                {
                    var d = HexMath.Distance(cell, h);
                    if (d < bestDist)
                    {
                        bestDist = d;
                        bestHex = h;
                    }
                }
            }
            return bestHex;
        }
    }
}
