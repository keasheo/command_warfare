using System;
using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>
    /// Offline Deploy: place from deployQueues (TS deploy action), then confirm → Play.
    /// </summary>
    public static class OfflineDeploy
    {
        public static List<DeployQueueItem> QueueFor(GameState state, SeatId seat)
        {
            if (state?.DeployQueues != null && state.DeployQueues.TryGetValue(seat, out var q) && q != null)
                return q;
            return new List<DeployQueueItem>();
        }

        public static int SelectedIndex(GameState state, SeatId seat)
        {
            if (state?.DeployQueueIndex != null && state.DeployQueueIndex.TryGetValue(seat, out var i))
                return i;
            return NextUnplacedIndex(QueueFor(state, seat));
        }

        public static void SelectQueueIndex(GameState state, SeatId seat, int index)
        {
            if (state == null) return;
            state.DeployQueueIndex[seat] = index;
        }

        public static int NextUnplacedIndex(List<DeployQueueItem> queue)
        {
            if (queue == null) return -1;
            for (var i = 0; i < queue.Count; i++)
                if (queue[i] != null && !queue[i].Placed) return i;
            return -1;
        }

        public static bool AllPlaced(GameState state, SeatId seat)
        {
            foreach (var item in QueueFor(state, seat))
                if (item != null && !item.Placed) return false;
            return true;
        }

        public static HashSet<string> DeployHexesForQueueItem(GameState state, SeatId seat, int queueIndex)
        {
            var keys = new HashSet<string>();
            if (state?.Phase != Phase.Deploy) return keys;
            var queue = QueueFor(state, seat);
            if (queueIndex < 0 || queueIndex >= queue.Count) return keys;
            var item = queue[queueIndex];
            if (item == null || item.Placed) return keys;

            var occupied = OccupiedKeys(state, null);
            var candidates = CandidateKeys(state, seat, item, queue);
            foreach (var key in candidates)
            {
                if (occupied.Contains(key)) continue;
                if (state.Terrain.TryGetValue(key, out var t) && t == TerrainKind.Water &&
                    !CanDeployOnWater(item, state, seat))
                    continue;
                keys.Add(key);
            }
            return keys;
        }

        static HashSet<string> CandidateKeys(
            GameState state,
            SeatId seat,
            DeployQueueItem item,
            List<DeployQueueItem> queue)
        {
            if (item.Kind is "commander" or "officer")
            {
                if (item.Kind == "officer" && CompanyHasSiege(queue, item.CardId, state, seat))
                {
                    var card = FindCard(state, seat, item.CardId);
                    var radius = card != null && card.commandRadius > 0
                        ? card.commandRadius
                        : GameConstants.DefaultOfficerCommandRadius;
                    return DeployPlacement.OfficerDeployHexesForSiegeCompany(seat, radius, state.BoardSize);
                }
                return DeployZone.WedgeKeys(seat, state.BoardSize);
            }

            var officer = FindDeployedOfficer(state, seat, item.OfficerCardId);
            if (officer == null) return new HashSet<string>();
            var unitCard = FindCard(state, seat, item.CardId);
            var siege = SiegeRules.IsSiegeCard(unitCard);
            var pending = unitCard != null
                ? GameSessionFactory.UnitFromCard(unitCard, seat, UnitKind.Unit, new HexCoord(0, 0), item.OfficerCardId)
                : new UnitToken();
            var officerRadius = officer.CommandRadius ?? GameConstants.DefaultOfficerCommandRadius;
            var effective = CombatResolve.EffectiveRadiusForUnit(officerRadius, pending);
            var keys = DeployPlacement.CommandRadiusKeys(
                new HexCoord(officer.Col, officer.Row), effective, state.BoardSize);
            if (siege)
                keys.IntersectWith(DeployZone.SiegeBandKeys(seat, state.BoardSize));
            return keys;
        }

        static bool CompanyHasSiege(
            List<DeployQueueItem> queue,
            string officerCardId,
            GameState state,
            SeatId seat)
        {
            foreach (var q in queue)
            {
                if (q == null || q.Kind != "unit" || q.OfficerCardId != officerCardId) continue;
                if (SiegeRules.IsSiegeCard(FindCard(state, seat, q.CardId))) return true;
            }
            return false;
        }

        static bool CanDeployOnWater(DeployQueueItem item, GameState state, SeatId seat)
        {
            var card = FindCard(state, seat, item.CardId);
            if (card?.keywords == null) return false;
            foreach (var k in card.keywords)
            {
                if (string.IsNullOrEmpty(k)) continue;
                if (k.Equals("Amphibious", StringComparison.OrdinalIgnoreCase) ||
                    k.Equals("Flying", StringComparison.OrdinalIgnoreCase) ||
                    k.StartsWith("Amphibious ", StringComparison.OrdinalIgnoreCase) ||
                    k.StartsWith("Flying ", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        public static string TryPlace(
            GameState state,
            SeatId seat,
            int queueIndex,
            HexCoord cell)
        {
            if (state.Phase != Phase.Deploy) return "Not deploy phase.";
            if (IsSeatReady(state, seat)) return "Deploy finished.";
            var queue = QueueFor(state, seat);
            if (queueIndex < 0 || queueIndex >= queue.Count) return "Invalid deploy item.";
            var item = queue[queueIndex];
            if (item == null || item.Placed) return "Invalid deploy item.";
            if (!HexMath.InBounds(cell, state.BoardSize)) return "Out of bounds.";

            var legal = DeployHexesForQueueItem(state, seat, queueIndex);
            var key = HexMath.Key(cell.Col, cell.Row);
            if (!legal.Contains(key))
            {
                if (item.Kind == "unit" && FindDeployedOfficer(state, seat, item.OfficerCardId) == null)
                    return "Deploy that unit’s officer before placing the unit.";
                return "Illegal deploy hex.";
            }

            if (OccupiedKeys(state, null).Contains(key))
                return "Hex occupied.";

            var card = FindCard(state, seat, item.CardId);
            if (card == null) return "Unknown card.";

            var unit = GameSessionFactory.UnitFromCard(card, seat, item.UnitKind, cell,
                item.Kind == "commander" ? null : (item.OfficerCardId ?? item.CardId));
            if (item.Move > 0) unit.Move = item.Move;
            state.Units.Add(unit);
            item.Placed = true;

            if (item.Kind == "commander")
                state.Commanders[seat] = cell;

            state.DeployQueueIndex[seat] = NextUnplacedIndex(queue);
            state.LastActionLog = $"{seat} deployed {item.CardName} at ({cell.Col},{cell.Row}).";
            return null;
        }

        /// <summary>Greedy auto-place remaining queue items (AI / smoke / randomMap shortcut).</summary>
        public static int AutoPlaceAll(GameState state, SeatId seat)
        {
            var queue = QueueFor(state, seat);
            var placed = 0;
            for (var i = 0; i < queue.Count; i++)
            {
                if (queue[i] == null || queue[i].Placed) continue;
                var spot = FindAutoSpot(state, seat, i);
                if (!spot.HasValue) continue;
                var err = TryPlace(state, seat, i, spot.Value);
                if (err == null) placed++;
            }
            return placed;
        }

        static HexCoord? FindAutoSpot(GameState state, SeatId seat, int queueIndex)
        {
            var keys = DeployHexesForQueueItem(state, seat, queueIndex);
            if (keys.Count == 0) return null;
            var mid = GameConstants.BoardMid(state.BoardSize);
            HexCoord front = seat switch
            {
                SeatId.N => new HexCoord(mid, Math.Min(state.BoardSize - 1, GameConstants.DeployZoneDepth - 1)),
                SeatId.S => new HexCoord(mid, Math.Max(0, state.BoardSize - GameConstants.DeployZoneDepth)),
                _ => new HexCoord(mid, mid),
            };
            HexCoord? best = null;
            var bestScore = int.MinValue;
            foreach (var key in keys)
            {
                var cell = HexMath.ParseKey(key);
                var score = -HexMath.Distance(cell, front);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = cell;
                }
            }
            return best;
        }

        /// <summary>Legal hexes for a already-placed unit that is being repositioned.</summary>
        public static HashSet<string> DeployHexesForUnit(GameState state, UnitToken unit)
        {
            if (unit == null) return new HashSet<string>();
            // Map back to a synthetic queue item for candidate logic.
            var item = new DeployQueueItem
            {
                Kind = unit.Kind switch
                {
                    UnitKind.Commander => "commander",
                    UnitKind.Officer => "officer",
                    _ => "unit",
                },
                CardId = unit.CardId,
                OfficerCardId = unit.OfficerCardId ?? "",
                Placed = false,
            };
            var queue = QueueFor(state, unit.Seat);
            var occupied = OccupiedKeys(state, unit.Id);
            var keys = new HashSet<string>();
            foreach (var key in CandidateKeys(state, unit.Seat, item, queue))
            {
                if (occupied.Contains(key)) continue;
                if (state.Terrain.TryGetValue(key, out var t) && t == TerrainKind.Water)
                {
                    var can = false;
                    if (unit.Keywords != null)
                        foreach (var k in unit.Keywords)
                            if (!string.IsNullOrEmpty(k) &&
                                (k.StartsWith("Amphibious", StringComparison.OrdinalIgnoreCase) ||
                                 k.StartsWith("Flying", StringComparison.OrdinalIgnoreCase)))
                            { can = true; break; }
                    if (!can) continue;
                }
                keys.Add(key);
            }
            return keys;
        }

        public static bool TryReposition(GameState state, UnitToken unit, HexCoord dest)
        {
            if (state.Phase != Phase.Deploy) return false;
            if (IsSeatReady(state, unit.Seat)) return false;
            var key = HexMath.Key(dest.Col, dest.Row);
            if (!DeployHexesForUnit(state, unit).Contains(key)) return false;
            unit.Col = dest.Col;
            unit.Row = dest.Row;
            if (unit.Kind == UnitKind.Commander)
                state.Commanders[unit.Seat] = dest;
            return true;
        }

        public static string ConfirmSeat(GameState state, SeatId seat, CardDatabase cards)
        {
            if (state.Phase != Phase.Deploy) return "Not deploy phase.";
            if (!AllPlaced(state, seat))
                return "Place all army pieces first.";

            state.DeployReady[seat] = true;
            state.LastActionLog = $"{seat} finished deploy.";

            foreach (var s in new[] { SeatId.N, SeatId.S })
            {
                if (!IsSeatReady(state, s))
                    return null;
            }

            state.Phase = Phase.Play;
            state.ActiveSeat = SeatId.N;
            state.Round = 1;
            PoolRefresh.RefreshAllPools(state, cards);
            ObjectiveSystem.RecalculateControl(state);
            state.LastActionLog = "Deploy confirmed — battle begins.";
            return null;
        }

        public static bool IsSeatReady(GameState state, SeatId seat) =>
            state.DeployReady.TryGetValue(seat, out var ready) && ready;

        static UnitToken FindDeployedOfficer(GameState state, SeatId seat, string officerCardId)
        {
            if (string.IsNullOrEmpty(officerCardId)) return null;
            foreach (var u in state.Units)
            {
                if (u.Seat != seat || u.Kind != UnitKind.Officer) continue;
                if (u.CardId == officerCardId) return u;
            }
            return null;
        }

        static CardDefinition FindCard(GameState state, SeatId seat, string cardId)
        {
            if (string.IsNullOrEmpty(cardId)) return null;
            if (state.OfflineArmies != null && state.OfflineArmies.TryGetValue(seat, out var army) && army != null)
            {
                if (army.Commander != null && army.Commander.cardId == cardId) return army.Commander;
                if (army.Companies != null)
                {
                    foreach (var co in army.Companies)
                    {
                        if (co?.Officer != null && co.Officer.cardId == cardId) return co.Officer;
                        if (co?.Units == null) continue;
                        foreach (var u in co.Units)
                            if (u != null && u.cardId == cardId) return u;
                    }
                }
            }
            return null;
        }

        static HashSet<string> OccupiedKeys(GameState state, string exceptUnitId)
        {
            var occupied = new HashSet<string>();
            if (state?.Units == null) return occupied;
            foreach (var u in state.Units)
            {
                if (exceptUnitId != null && u.Id == exceptUnitId) continue;
                occupied.Add(HexMath.Key(u.Col, u.Row));
            }
            return occupied;
        }
    }
}
