using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    public static class TurnSystem
    {
        public static readonly SeatId[] TurnOrder2P = { SeatId.N, SeatId.S };

        public static void EndTurn(GameState state, CardDatabase cards = null)
        {
            var from = state.ActiveSeat ?? SeatId.N;
            state.SelectedUnitId = null;

            CompanyActivation.EndPreviousCompanyActivation(state, from);
            state.CompanyActivatedThisTurn.Remove(from);

            var idx = System.Array.IndexOf(TurnOrder2P, from);
            var next = TurnOrder2P[(idx + 1) % TurnOrder2P.Length];
            state.ActiveSeat = next;
            state.ActiveCompanyOfficerId = null;

            foreach (var u in state.Units)
            {
                if (u.Seat == from || u.Seat == next)
                {
                    u.MoveRemaining = 0;
                    u.ActivationCol = null;
                    u.ActivationRow = null;
                }
            }

            if (LivingOfficersPendingActivation(state).Count == 0)
            {
                var vpLog = ObjectiveSystem.AwardRoundVp(state);
                if (!string.IsNullOrEmpty(vpLog))
                    state.LastActionLog = vpLog;
                if (ObjectiveSystem.TryResolveMaxRoundWinner(state, out var endLog))
                {
                    if (!string.IsNullOrEmpty(endLog))
                        state.LastActionLog = endLog;
                    return;
                }
                state.Round++;
                if (cards != null)
                    PoolRefresh.BeginNewRound(state, cards);
                else
                {
                    state.CompaniesActivatedThisRound.Clear();
                    state.CommanderActivatedThisRound.Clear();
                }
            }
        }

        static System.Collections.Generic.List<UnitToken> LivingOfficersPendingActivation(GameState state)
        {
            var pending = new System.Collections.Generic.List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Kind != UnitKind.Officer) continue;
                if (!state.CompaniesActivatedThisRound.TryGetValue(u.Id, out var done) || !done)
                    pending.Add(u);
            }
            return pending;
        }
    }
}
