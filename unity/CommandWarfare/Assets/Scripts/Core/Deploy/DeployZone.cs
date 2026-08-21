using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.Deploy
{
    /// <summary>Ported from play/shared/game.ts — shared 13×8 edge deployment zones.</summary>
    public static class DeployZone
    {
        public static (int Lo, int Hi) ColRange(int boardSize)
        {
            var mid = (boardSize - 1) / 2;
            var half = GameConstants.DeployZoneWidth / 2;
            var lo = System.Math.Max(0, mid - half);
            var hi = System.Math.Min(boardSize - 1, mid + half);
            return (lo, hi);
        }

        public static (int Lo, int Hi) RowRange(int boardSize) => ColRange(boardSize);

        public static bool Contains(SeatId seat, HexCoord cell, int boardSize)
        {
            if (seat == SeatId.N || seat == SeatId.S)
            {
                var (lo, hi) = ColRange(boardSize);
                if (cell.Col < lo || cell.Col > hi) return false;
                if (seat == SeatId.N)
                    return cell.Row >= 0 && cell.Row < GameConstants.DeployZoneDepth;
                return cell.Row > boardSize - 1 - GameConstants.DeployZoneDepth && cell.Row < boardSize;
            }

            var (rLo, rHi) = RowRange(boardSize);
            if (cell.Row < rLo || cell.Row > rHi) return false;
            if (seat == SeatId.W)
                return cell.Col >= 0 && cell.Col < GameConstants.DeployZoneDepth;
            return cell.Col > boardSize - 1 - GameConstants.DeployZoneDepth && cell.Col < boardSize;
        }

        public static bool InSiegeBand(SeatId seat, HexCoord cell, int boardSize)
        {
            if (!Contains(seat, cell, boardSize)) return false;
            return seat switch
            {
                SeatId.N => cell.Row >= 0 && cell.Row < GameConstants.SiegeDeployDepth,
                SeatId.S => cell.Row > boardSize - 1 - GameConstants.SiegeDeployDepth && cell.Row < boardSize,
                SeatId.W => cell.Col >= 0 && cell.Col < GameConstants.SiegeDeployDepth,
                _ => cell.Col > boardSize - 1 - GameConstants.SiegeDeployDepth && cell.Col < boardSize,
            };
        }

        public static HashSet<string> WedgeKeys(SeatId seat, int boardSize)
        {
            var keys = new HashSet<string>();
            for (var row = 0; row < boardSize; row++)
            for (var col = 0; col < boardSize; col++)
            {
                var cell = new HexCoord(col, row);
                if (Contains(seat, cell, boardSize))
                    keys.Add(HexMath.Key(col, row));
            }
            return keys;
        }

        public static HashSet<string> SiegeBandKeys(SeatId seat, int boardSize)
        {
            var keys = new HashSet<string>();
            foreach (var key in WedgeKeys(seat, boardSize))
            {
                var cell = HexMath.ParseKey(key);
                if (InSiegeBand(seat, cell, boardSize))
                    keys.Add(key);
            }
            return keys;
        }
    }
}
