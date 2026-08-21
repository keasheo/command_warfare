using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of activateCommander from play/shared/game.ts.</summary>
    public static class CommanderActivation
    {
        public readonly struct ActivateResult
        {
            public bool Ok { get; }
            public string Error { get; }
            public string Log { get; }

            public static ActivateResult Success(string log) => new(true, null, log);
            public static ActivateResult Fail(string error) => new(false, error, null);

            ActivateResult(bool ok, string error, string log)
            {
                Ok = ok;
                Error = error;
                Log = log;
            }
        }

        public static ActivateResult TryActivateCommander(GameState state, SeatId seat)
        {
            if (state.Phase != Phase.Play)
                return ActivateResult.Fail("Not play phase.");
            if (state.ActiveSeat != seat)
                return ActivateResult.Fail("Not your turn.");
            if (state.CommanderActivatedThisRound.TryGetValue(seat, out var done) && done)
                return ActivateResult.Fail("Commander already activated this round.");

            UnitToken commander = null;
            foreach (var u in state.Units)
            {
                if (u.Seat == seat && u.Kind == UnitKind.Commander)
                {
                    commander = u;
                    break;
                }
            }

            if (commander == null)
                return ActivateResult.Fail("Commander not found.");

            CompanyActivation.EndPreviousCompanyActivation(state, seat);

            commander.MoveRemaining = commander.Move + commander.TempMove;
            commander.ActivationCol = commander.Col;
            commander.ActivationRow = commander.Row;
            commander.TempDamage = 0;
            commander.TempMove = 0;
            commander.Harden = 0;

            state.ActiveCompanyOfficerId = null;
            state.CommanderActivatedThisRound[seat] = true;

            return ActivateResult.Success(
                $"{seat} activated {commander.CardName} (Move {commander.Move}).");
        }

        public static bool IsCommanderActivatedThisRound(GameState state, SeatId seat) =>
            state.CommanderActivatedThisRound.TryGetValue(seat, out var done) && done;
    }
}
