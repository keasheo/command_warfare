using System;
using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.Deploy
{
    /// <summary>Auto-deploy spot finding — port of play/shared/game.ts deploy helpers.</summary>
    public static class DeployPlacement
    {
        public struct CardSnap
        {
            public string PrimaryType;
            public string[] Keywords;
            public int CommandRadius;
        }

        public struct QueueItem
        {
            public string Kind;
            public string CardId;
            public string OfficerCardId;
            public bool Placed;
        }

        public static bool IsSiegeCard(CardSnap? card)
        {
            if (!card.HasValue) return false;
            var c = card.Value;
            if (string.Equals(c.PrimaryType, "Siege", StringComparison.OrdinalIgnoreCase))
                return true;
            if (c.Keywords == null) return false;
            foreach (var k in c.Keywords)
            {
                if (string.IsNullOrEmpty(k)) continue;
                var lower = k.ToLowerInvariant();
                if (lower == "siege" || lower.StartsWith("siege "))
                    return true;
            }
            return false;
        }

        public static bool HasScout(IReadOnlyList<string> keywords)
        {
            if (keywords == null) return false;
            foreach (var k in keywords)
            {
                if (string.Equals(k, "Scout", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        public static int EffectiveRadiusForUnit(int baseRadius, IReadOnlyList<string> unitKeywords) =>
            HasScout(unitKeywords) ? baseRadius + GameConstants.ScoutCrExtension : baseRadius;

        public static bool UnitInOfficerRadius(HexCoord unit, HexCoord officer, int radius, IReadOnlyList<string> unitKeywords)
        {
            var dist = HexMath.Distance(unit, officer);
            if (dist <= radius) return true;
            return HasScout(unitKeywords) && dist <= radius + GameConstants.ScoutCrExtension;
        }

        public static HashSet<string> CommandRadiusKeys(HexCoord origin, int radius, int boardSize)
        {
            var keys = new HashSet<string>();
            for (var col = 0; col < boardSize; col++)
            for (var row = 0; row < boardSize; row++)
            {
                var cell = new HexCoord(col, row);
                if (HexMath.Distance(origin, cell) <= radius)
                    keys.Add(HexMath.Key(col, row));
            }
            return keys;
        }

        public static HashSet<string> OfficerDeployHexesForSiegeCompany(SeatId seat, int officerRadius, int boardSize)
        {
            var zone = DeployZone.WedgeKeys(seat, boardSize);
            var siegeBand = DeployZone.SiegeBandKeys(seat, boardSize);
            var radius = officerRadius > 0 ? officerRadius : GameConstants.DefaultOfficerCommandRadius;
            var result = new HashSet<string>();
            foreach (var key in zone)
            {
                var origin = HexMath.ParseKey(key);
                var cr = CommandRadiusKeys(origin, radius, boardSize);
                foreach (var sk in siegeBand)
                {
                    if (!cr.Contains(sk)) continue;
                    result.Add(key);
                    break;
                }
            }
            return result;
        }

        public static HashSet<string> UnitDeployHexKeys(
            SeatId seat,
            UnitToken officer,
            int boardSize,
            IReadOnlyList<string> pendingUnitKeywords,
            bool siege)
        {
            var radius = officer.CommandRadius ?? GameConstants.DefaultOfficerCommandRadius;
            var effective = EffectiveRadiusForUnit(radius, pendingUnitKeywords);
            var keys = CommandRadiusKeys(new HexCoord(officer.Col, officer.Row), effective, boardSize);
            if (!siege) return keys;

            var band = DeployZone.SiegeBandKeys(seat, boardSize);
            var clipped = new HashSet<string>();
            foreach (var key in keys)
            {
                if (band.Contains(key)) clipped.Add(key);
            }
            return clipped;
        }

        /// <summary>Find first legal deploy hex for queue item, or null.</summary>
        public static (int col, int row)? FindDeploySpot(
            SeatId seat,
            int boardSize,
            IReadOnlyList<QueueItem> queue,
            int queueIndex,
            IReadOnlyList<UnitToken> unitsOnBoard,
            HashSet<string> occupied,
            IReadOnlyDictionary<string, CardSnap> cardCatalog)
        {
            if (queueIndex < 0 || queueIndex >= queue.Count) return null;
            var item = queue[queueIndex];
            if (item.Placed) return null;

            cardCatalog.TryGetValue(item.CardId, out var snap);
            var keywords = snap.Keywords ?? Array.Empty<string>();

            IEnumerable<HexCoord> candidates;
            if (item.Kind == "commander")
            {
                candidates = WedgeCoords(seat, boardSize);
            }
            else if (item.Kind == "officer")
            {
                var companyHasSiege = false;
                foreach (var q in queue)
                {
                    if (q.Kind != "unit" || q.OfficerCardId != item.CardId) continue;
                    cardCatalog.TryGetValue(q.CardId, out var unitSnap);
                    if (IsSiegeCard(unitSnap)) { companyHasSiege = true; break; }
                }

                if (companyHasSiege)
                {
                    var radius = snap.CommandRadius > 0 ? snap.CommandRadius : GameConstants.DefaultOfficerCommandRadius;
                    var allowed = OfficerDeployHexesForSiegeCompany(seat, radius, boardSize);
                    candidates = KeysToCoords(allowed);
                }
                else
                {
                    candidates = WedgeCoords(seat, boardSize);
                }
            }
            else
            {
                UnitToken officer = null;
                foreach (var u in unitsOnBoard)
                {
                    if (u.Seat == seat && u.Kind == UnitKind.Officer && u.CardId == item.OfficerCardId)
                    {
                        officer = u;
                        break;
                    }
                }
                if (officer == null) return null;

                var siege = IsSiegeCard(snap);
                var hexKeys = UnitDeployHexKeys(seat, officer, boardSize, keywords, siege);
                candidates = KeysToCoords(hexKeys);
            }

            var mid = GameConstants.BoardMid(boardSize);
            var front = seat switch
            {
                SeatId.N => new HexCoord(mid, Math.Min(boardSize - 1, GameConstants.DeployZoneDepth - 1)),
                SeatId.S => new HexCoord(mid, Math.Max(0, boardSize - GameConstants.DeployZoneDepth)),
                SeatId.W => new HexCoord(Math.Min(boardSize - 1, GameConstants.DeployZoneDepth - 1), mid),
                _ => new HexCoord(Math.Max(0, boardSize - GameConstants.DeployZoneDepth), mid),
            };

            HexCoord? best = null;
            var bestScore = int.MinValue;
            foreach (var cell in candidates)
            {
                var key = HexMath.Key(cell.Col, cell.Row);
                if (occupied.Contains(key)) continue;
                if (item.Kind is "commander" or "officer" && !DeployZone.Contains(seat, cell, boardSize))
                    continue;

                if (item.Kind == "unit")
                {
                    UnitToken officer = null;
                    foreach (var u in unitsOnBoard)
                    {
                        if (u.Seat == seat && u.Kind == UnitKind.Officer && u.CardId == item.OfficerCardId)
                        {
                            officer = u;
                            break;
                        }
                    }
                    if (officer == null) continue;
                    var radius = officer.CommandRadius ?? GameConstants.DefaultOfficerCommandRadius;
                    if (!UnitInOfficerRadius(cell, new HexCoord(officer.Col, officer.Row), radius, keywords))
                        continue;
                }

                var score = -HexMath.Distance(cell, front);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = cell;
                }
            }

            return best.HasValue ? (best.Value.Col, best.Value.Row) : null;
        }

        static IEnumerable<HexCoord> WedgeCoords(SeatId seat, int boardSize)
        {
            foreach (var key in DeployZone.WedgeKeys(seat, boardSize))
                yield return HexMath.ParseKey(key);
        }

        static IEnumerable<HexCoord> KeysToCoords(IEnumerable<string> keys)
        {
            foreach (var key in keys)
                yield return HexMath.ParseKey(key);
        }
    }
}
