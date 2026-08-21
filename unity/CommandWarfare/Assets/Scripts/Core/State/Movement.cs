using System;
using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of play/shared/movement.ts — terrain move costs and reachability.</summary>
    public static class Movement
    {
        public readonly struct ReachableCell
        {
            public int Col { get; }
            public int Row { get; }
            public int Remaining { get; }
            public int Spent { get; }

            public ReachableCell(int col, int row, int remaining, int spent)
            {
                Col = col;
                Row = row;
                Remaining = remaining;
                Spent = spent;
            }
        }

        public readonly struct MoveTraveler
        {
            public bool Amphibious { get; }
            public bool Flying { get; }
            public bool Rooted { get; }

            public MoveTraveler(bool amphibious = false, bool flying = false, bool rooted = false)
            {
                Amphibious = amphibious;
                Flying = flying;
                Rooted = rooted;
            }

            public static MoveTraveler FromUnit(UnitToken unit) => new(
                HasKeyword(unit, "Amphibious"),
                HasKeyword(unit, "Flying"),
                unit.Rooted || unit.BonePrisoned);

            static bool HasKeyword(UnitToken unit, string keyword)
            {
                if (unit.Keywords == null) return false;
                foreach (var k in unit.Keywords)
                    if (string.Equals(k, keyword, StringComparison.OrdinalIgnoreCase))
                        return true;
                return false;
            }
        }

        public static int TerrainEnterCost(TerrainKind kind, MoveTraveler traveler)
        {
            if (traveler.Flying)
                return kind == TerrainKind.Wall ? int.MaxValue : 1;

            if (kind == TerrainKind.Water)
                return traveler.Amphibious ? 1 : int.MaxValue;
            if (kind == TerrainKind.Wall)
                return int.MaxValue;
            return 1;
        }

        public static bool CanAffordEnter(int remaining, int cost, bool rooted)
        {
            if (cost == int.MaxValue || remaining <= 0) return false;
            if (cost <= remaining) return true;
            return !rooted;
        }

        public static int RemainingAfterEnter(int remaining, int cost) =>
            Math.Max(0, remaining - cost);

        public static Dictionary<string, ReachableCell> ReachableMoveHexes(
            GameState state,
            UnitToken unit,
            MoveTraveler? travelerOverride = null,
            int? budgetOverride = null,
            bool ignoreTerrainCosts = false,
            int? maxSteps = null)
        {
            var traveler = travelerOverride ?? MoveTraveler.FromUnit(unit);
            if (unit.HarassMovePending && budgetOverride == null)
            {
                // Harass: free Move 1 that ignores terrain costs and rooted for this step.
                traveler = new MoveTraveler(traveler.Amphibious, traveler.Flying, rooted: false);
                budgetOverride = 1;
                ignoreTerrainCosts = true;
                maxSteps = 1;
            }
            var origin = new HexCoord(unit.Col, unit.Row);
            var originKey = HexMath.Key(origin.Col, origin.Row);
            var budget = budgetOverride ?? StatusEffects.EffectiveMoveBudget(unit, unit.MoveRemaining);
            var best = new Dictionary<string, ReachableCell>();
            if (budget <= 0) return best;

            var occupied = OccupiedKeys(state, unit.Id);
            best[originKey] = new ReachableCell(origin.Col, origin.Row, budget, 0);

            var queue = new List<(HexCoord cell, int remaining, int spent)>
            {
                (origin, budget, 0),
            };

            while (queue.Count > 0)
            {
                queue.Sort((a, b) => b.remaining.CompareTo(a.remaining) != 0
                    ? b.remaining.CompareTo(a.remaining)
                    : a.spent.CompareTo(b.spent));
                var cur = queue[0];
                queue.RemoveAt(0);

                var curKey = HexMath.Key(cur.cell.Col, cur.cell.Row);
                if (!best.TryGetValue(curKey, out var known) || cur.remaining < known.Remaining)
                    continue;

                if (maxSteps != null && cur.spent >= maxSteps.Value)
                    continue;

                foreach (var n in HexMath.Neighbors(cur.cell))
                {
                    if (!HexMath.InBounds(n, state.BoardSize)) continue;
                    var nk = HexMath.Key(n.Col, n.Row);
                    if (nk != originKey && occupied.Contains(nk)) continue;

                    var kind = TerrainAt(state, n);
                    var cost = ignoreTerrainCosts
                        ? (kind == TerrainKind.Wall ? int.MaxValue : 1)
                        : TerrainEnterCost(kind, traveler);
                    if (!CanAffordEnter(cur.remaining, cost, traveler.Rooted)) continue;

                    var nextRem = RemainingAfterEnter(cur.remaining, cost);
                    var nextSpent = cur.spent + (cur.remaining - nextRem);

                    if (best.TryGetValue(nk, out var prevBest) &&
                        nextRem <= prevBest.Remaining && nextSpent >= prevBest.Spent)
                        continue;

                    best[nk] = new ReachableCell(n.Col, n.Row, nextRem, nextSpent);
                    queue.Add((n, nextRem, nextSpent));
                }
            }

            best.Remove(originKey);
            return best;
        }

        public static bool TryValidateMove(
            GameState state,
            UnitToken unit,
            HexCoord dest,
            out string error)
        {
            error = null;
            if (unit.Rooted || unit.BonePrisoned)
            {
                error = unit.BonePrisoned
                    ? "Bone Prison — cannot move."
                    : "Rooted units cannot move.";
                return false;
            }

            if (unit.Kind == UnitKind.Commander)
            {
                if (unit.MoveRemaining <= 0 && !unit.HarassMovePending)
                {
                    error = "Commander has no move remaining. Activate first.";
                    return false;
                }
            }
            else if (!CompanyActivation.IsUnitInActiveCompany(state, unit))
            {
                error = "Activate a company first.";
                return false;
            }

            var key = HexMath.Key(dest.Col, dest.Row);
            var reach = ReachableMoveHexes(state, unit);
            if (!reach.ContainsKey(key))
            {
                error = "Destination not reachable.";
                return false;
            }

            return true;
        }

        public static bool ApplyMove(GameState state, UnitToken unit, HexCoord dest)
        {
            if (!TryValidateMove(state, unit, dest, out _)) return false;

            var key = HexMath.Key(dest.Col, dest.Row);
            var cell = ReachableMoveHexes(state, unit)[key];
            unit.Col = dest.Col;
            unit.Row = dest.Row;
            unit.MoveRemaining = cell.Remaining;
            if (unit.HarassMovePending)
                unit.HarassMovePending = false;
            return true;
        }

        static HashSet<string> OccupiedKeys(GameState state, string movingUnitId)
        {
            var set = new HashSet<string>();
            foreach (var u in state.Units)
            {
                if (u.Id == movingUnitId) continue;
                set.Add(HexMath.Key(u.Col, u.Row));
            }
            return set;
        }

        static TerrainKind TerrainAt(GameState state, HexCoord coord)
        {
            var key = HexMath.Key(coord.Col, coord.Row);
            return state.Terrain.TryGetValue(key, out var t) ? t : TerrainKind.Plains;
        }
    }
}
