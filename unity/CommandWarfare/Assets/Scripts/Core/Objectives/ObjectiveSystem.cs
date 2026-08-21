using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;

namespace CommandWarfare.Core.Objectives
{
    /// <summary>Port of play/shared/objectiveCards.ts + VP scoring from game.ts.</summary>
    public static class ObjectiveSystem
    {
        static readonly (int q, int r)[] Triad3 = { (0, 0), (1, 0), (0, 1) };
        static readonly (int q, int r)[] Bend3 = { (-1, 0), (0, 0), (1, -1) };
        static readonly (int q, int r)[] Cap3 = { (-1, 0), (0, 0), (0, -1) };
        static readonly (int q, int r)[] Barb4 = { (0, 0), (1, 0), (2, 0), (1, -1) };
        static readonly (int q, int r)[] Zig4 = { (0, 0), (1, -1), (1, 0), (2, 0) };
        static readonly (int q, int r)[] Cluster4 = { (-1, 0), (0, 0), (0, 1), (1, 0) };
        static readonly (int q, int r)[] Hook5 = { (0, 0), (1, 0), (1, -1), (0, -1), (-1, 0) };
        static readonly (int q, int r)[] Star5 = { (0, 0), (-1, 0), (1, 0), (0, -1), (0, 1) };
        static readonly (int q, int r)[] Arc5 = { (0, 0), (1, 0), (2, 0), (2, -1), (3, -1) };

        static readonly string[] Pool3 = { "triad3", "bend3", "cap3" };
        static readonly string[] Pool4 = { "barb4", "zig4", "cluster4" };
        static readonly string[] Pool5 = { "hook5", "star5", "arc5" };

        public readonly struct ObjectiveCard
        {
            public string Id { get; }
            public string Name { get; }
            public (int col, int row)[] Anchors { get; }

            public ObjectiveCard(string id, string name, params (int col, int row)[] anchors)
            {
                Id = id;
                Name = name;
                Anchors = anchors;
            }
        }

        public static readonly ObjectiveCard[] Deck =
        {
            new("single-center", "Single Center", (0, 0)),
            new("mirror-ns", "North–South Pair", (0, -4), (0, 4)),
            new("mirror-we", "West–East Pair", (-4, 0), (4, 0)),
            new("triangle", "Triad", (0, 0), (-5, -4), (5, 4)),
            new("wide-three", "Wide Three", (-5, 0), (0, 0), (5, 0)),
            new("diagonal-pair", "Diagonal Pair", (-4, -4), (4, 4)),
        };

        public static ObjectiveCard CardById(string id)
        {
            foreach (var card in Deck)
            {
                if (string.Equals(card.Id, id, StringComparison.OrdinalIgnoreCase))
                    return card;
            }
            return Deck[1];
        }

        public static List<ObjectiveMarker> PlaceCard(ObjectiveCard card, int boardSize, string roomCode)
        {
            var mid = GameConstants.BoardMid(boardSize);
            var hexCount = card.Anchors.Length == 1 ? 5 : card.Anchors.Length == 2 ? 4 : 3;
            var result = new List<ObjectiveMarker>();
            for (var i = 0; i < card.Anchors.Length; i++)
            {
                var anchor = new HexCoord(mid + card.Anchors[i].col, mid + card.Anchors[i].row);
                var rng = new SeededRng(SeededRng.SeedFromRoomCode(roomCode, $"obj:{card.Id}:{i}"));
                var pool = hexCount == 5 ? Pool5 : hexCount == 4 ? Pool4 : Pool3;
                var shapeId = pool[rng.NextInt(pool.Length)];
                var hexes = ExpandShape(anchor, Shape(shapeId), rng.NextInt(6), rng.NextFloat() < 0.5f);
                result.Add(new ObjectiveMarker
                {
                    Id = $"obj-{i}",
                    Col = anchor.Col,
                    Row = anchor.Row,
                    Hexes = hexes,
                    Controller = null,
                });
            }
            return result;
        }

        public static IEnumerable<HexCoord> ZoneHexes(ObjectiveMarker marker)
        {
            if (marker.Hexes != null && marker.Hexes.Count > 0)
            {
                foreach (var h in marker.Hexes) yield return h;
                yield break;
            }
            yield return new HexCoord(marker.Col, marker.Row);
        }

        public static string RecalculateControl(GameState state)
        {
            if (state.Objectives == null || state.Objectives.Count == 0) return null;
            string log = null;
            foreach (var o in state.Objectives)
            {
                var next = MajorityController(state, o);
                if (next == o.Controller) continue;
                if (next.HasValue && !o.Controller.HasValue)
                    log = $"{next} claims objective at ({o.Col},{o.Row}).";
                else if (!next.HasValue && o.Controller.HasValue)
                    log = $"Objective at ({o.Col},{o.Row}) contested.";
                else
                    log = $"{next} takes objective at ({o.Col},{o.Row}) from {o.Controller}.";
                o.Controller = next;
            }
            return log;
        }

        public static string AwardRoundVp(GameState state)
        {
            var gained = new Dictionary<SeatId, int>();
            foreach (var o in state.Objectives)
            {
                if (!o.Controller.HasValue) continue;
                var seat = o.Controller.Value;
                state.Scores.TryGetValue(seat, out var cur);
                state.Scores[seat] = cur + GameConstants.VpPerObjective;
                gained.TryGetValue(seat, out var g);
                gained[seat] = g + GameConstants.VpPerObjective;
            }

            var totals = FormatScores(state);
            if (gained.Count == 0)
                return $"End of round {state.Round}: no objectives held. Totals: {totals}.";
            var parts = new List<string>();
            foreach (var kv in gained)
                parts.Add($"{kv.Key} +{kv.Value}");
            return $"End of round {state.Round}: objective VP — {string.Join(", ", parts)}. Totals: {totals}.";
        }

        public static bool TryResolveMaxRoundWinner(GameState state, out string log)
        {
            log = null;
            if (state.Round < GameConstants.MaxRounds) return false;

            SeatId? best = null;
            var bestVp = -1;
            var tied = false;
            foreach (var kv in state.Scores)
            {
                if (kv.Value > bestVp)
                {
                    best = kv.Key;
                    bestVp = kv.Value;
                    tied = false;
                }
                else if (kv.Value == bestVp)
                {
                    tied = true;
                }
            }

            state.Phase = Phase.Ended;
            state.ActiveSeat = null;
            if (tied || !best.HasValue)
            {
                state.Draw = true;
                state.WinnerSeat = null;
                log = $"Game over after {GameConstants.MaxRounds} rounds — draw ({FormatScores(state)}).";
            }
            else
            {
                state.Draw = false;
                state.WinnerSeat = best;
                log = $"Game over after {GameConstants.MaxRounds} rounds — {best} wins with {bestVp} VP ({FormatScores(state)}).";
            }
            return true;
        }

        static SeatId? MajorityController(GameState state, ObjectiveMarker objective)
        {
            var zone = new HashSet<string>();
            foreach (var h in ZoneHexes(objective))
                zone.Add(HexMath.Key(h.Col, h.Row));

            var counts = new Dictionary<SeatId, int>();
            foreach (var u in state.Units)
            {
                if (!zone.Contains(HexMath.Key(u.Col, u.Row))) continue;
                counts.TryGetValue(u.Seat, out var n);
                counts[u.Seat] = n + 1;
            }

            SeatId? best = null;
            var bestCount = 0;
            var tied = false;
            foreach (var kv in counts)
            {
                if (kv.Value > bestCount)
                {
                    best = kv.Key;
                    bestCount = kv.Value;
                    tied = false;
                }
                else if (kv.Value == bestCount && kv.Value > 0)
                {
                    tied = true;
                }
            }
            if (bestCount == 0 || tied) return null;
            return best;
        }

        static string FormatScores(GameState state)
        {
            var parts = new List<string>();
            foreach (SeatId seat in Enum.GetValues(typeof(SeatId)))
            {
                if (!state.Scores.ContainsKey(seat) && !HasSeat(state, seat)) continue;
                state.Scores.TryGetValue(seat, out var vp);
                parts.Add($"{seat} {vp}");
            }
            return string.Join(" · ", parts);
        }

        static bool HasSeat(GameState state, SeatId seat)
        {
            foreach (var u in state.Units)
                if (u.Seat == seat) return true;
            return false;
        }

        static (int q, int r)[] Shape(string id) => id switch
        {
            "bend3" => Bend3,
            "cap3" => Cap3,
            "barb4" => Barb4,
            "zig4" => Zig4,
            "cluster4" => Cluster4,
            "hook5" => Hook5,
            "star5" => Star5,
            "arc5" => Arc5,
            _ => Triad3,
        };

        static List<HexCoord> ExpandShape(HexCoord anchor, (int q, int r)[] shape, int rotation, bool reflect)
        {
            var origin = HexMath.OddRToAxial(anchor.Col, anchor.Row);
            var centered = CenterShape(shape);
            var hexes = new List<HexCoord>(centered.Length);
            foreach (var (q, r) in centered)
            {
                var tq = q;
                var tr = r;
                if (reflect)
                {
                    var m = HexMath.ReflectAxial(tq, tr);
                    tq = m.Q;
                    tr = m.R;
                }
                var rotated = HexMath.RotateAxial(tq, tr, rotation);
                hexes.Add(HexMath.AxialToOddR(origin.Q + rotated.Q, origin.R + rotated.R));
            }
            return hexes;
        }

        static (int q, int r)[] CenterShape((int q, int r)[] shape)
        {
            var best = shape[0];
            var bestSum = int.MaxValue;
            foreach (var candidate in shape)
            {
                var sum = 0;
                foreach (var other in shape)
                {
                    var dq = candidate.q - other.q;
                    var dr = candidate.r - other.r;
                    sum += (Math.Abs(dq) + Math.Abs(dq + dr) + Math.Abs(dr)) / 2;
                }
                if (sum < bestSum)
                {
                    bestSum = sum;
                    best = candidate;
                }
            }
            var centered = new (int q, int r)[shape.Length];
            for (var i = 0; i < shape.Length; i++)
                centered[i] = (shape[i].q - best.q, shape[i].r - best.r);
            return centered;
        }
    }
}
