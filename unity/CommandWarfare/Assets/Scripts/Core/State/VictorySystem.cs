using System.Linq;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    public static class VictorySystem
    {
        public static bool HasFightableUnits(GameState state, SeatId seat) =>
            state.Units.Any(u => u.Seat == seat && u.Kind != UnitKind.Commander);

        /// <summary>Returns winning seat when the opponent has no fightable units left.</summary>
        public static SeatId? CheckWinner(GameState state)
        {
            var seats = state.Units.Select(u => u.Seat).Distinct().ToList();
            if (seats.Count == 0) return null;

            SeatId? lastWithUnits = null;
            var contenders = 0;
            foreach (var seat in seats)
            {
                if (!HasFightableUnits(state, seat)) continue;
                lastWithUnits = seat;
                contenders++;
            }
            return contenders == 1 ? lastWithUnits : null;
        }

        public static void ApplyVictory(GameState state, SeatId winner)
        {
            state.WinnerSeat = winner;
            state.Phase = Phase.Ended;
            state.ActiveSeat = null;
            state.SelectedUnitId = null;
        }
    }
}
