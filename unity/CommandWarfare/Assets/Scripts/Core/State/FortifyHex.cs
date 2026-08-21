using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of toggleFortifyHex from play/shared/game.ts.</summary>
    public static class FortifyHex
    {
        public static string Toggle(GameState state, SeatId seat, HexCoord cell)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            state.FortifiedHexes ??= new Dictionary<string, bool>();
            var key = HexMath.Key(cell.Col, cell.Row);
            if (state.FortifiedHexes.TryGetValue(key, out var on) && on)
            {
                state.FortifiedHexes.Remove(key);
                state.LastActionLog = $"{seat} removes Fortification at ({cell.Col},{cell.Row}).";
                return null;
            }
            state.FortifiedHexes[key] = true;
            state.LastActionLog =
                $"{seat} fortifies hex ({cell.Col},{cell.Row}) - occupants gain Harden 1 (Piercing ignores).";
            return null;
        }
    }
}
