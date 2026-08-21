using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Core.Util
{
    /// <summary>Port of play/client/src/unitTokenVisuals.ts seat palette.</summary>
    public static class SeatColors
    {
        public static Color Fill(SeatId seat) => seat switch
        {
            SeatId.N => new Color(0.27f, 0.55f, 0.86f),
            SeatId.W => new Color(0.78f, 0.35f, 0.27f),
            SeatId.S => new Color(0.24f, 0.63f, 0.43f),
            SeatId.E => new Color(0.71f, 0.51f, 0.16f),
            _ => Color.gray,
        };

        public static string Label(SeatId seat, UnitKind kind) => kind switch
        {
            UnitKind.Commander => $"C{seat.ToString()[0]}",
            UnitKind.Officer => "O",
            _ => "U",
        };
    }
}
