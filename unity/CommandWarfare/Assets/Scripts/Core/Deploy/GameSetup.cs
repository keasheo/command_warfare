using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.Deploy
{
    public static class GameSetup
    {
        /// <summary>Port of edgeCommanderHex from play/shared/game.ts.</summary>
        public static HexCoord EdgeCommanderHex(SeatId seat, int boardSize)
        {
            var mid = GameConstants.BoardMid(boardSize);
            return seat switch
            {
                SeatId.N => new HexCoord(mid, 0),
                SeatId.S => new HexCoord(mid, boardSize - 1),
                SeatId.W => new HexCoord(0, mid),
                _ => new HexCoord(boardSize - 1, mid),
            };
        }
    }
}
