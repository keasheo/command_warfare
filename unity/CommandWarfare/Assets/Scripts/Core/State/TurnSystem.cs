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
            AdvanceTurnOnce(state, cards);

            // Skip seats that already activated every living officer + commander this round
            // (nothing left to do until the round rolls over).
            var guard = 0;
            while (state.Phase == Phase.Play &&
                   state.ActiveSeat.HasValue &&
                   !SeatHasPendingActivations(state, state.ActiveSeat.Value) &&
                   guard++ < TurnOrder2P.Length + 2)
            {
                var skipped = state.ActiveSeat.Value;
                AdvanceTurnOnce(state, cards);
                if (state.Phase != Phase.Play) break;
                state.LastActionLog =
                    $"{skipped} skipped — all officers & commander already activated this round.";
            }
        }

        /// <summary>
        /// True if this seat still has an officer or commander that has not activated this round.
        /// </summary>
        public static bool SeatHasPendingActivations(GameState state, SeatId seat)
        {
            if (state?.Units == null) return false;

            foreach (var u in state.Units)
            {
                if (u.Seat != seat) continue;
                if (u.Kind == UnitKind.Officer)
                {
                    if (state.CompaniesActivatedThisRound == null ||
                        !state.CompaniesActivatedThisRound.TryGetValue(u.Id, out var done) ||
                        !done)
                        return true;
                }
            }

            foreach (var u in state.Units)
            {
                if (u.Seat != seat || u.Kind != UnitKind.Commander) continue;
                return !CommanderActivation.IsCommanderActivatedThisRound(state, seat);
            }

            // No commander and every living officer already activated (or no officers left).
            return false;
        }

        /// <summary>
        /// True if the seat can still do something useful on the current turn
        /// (activate a company/commander, or spend remaining move/attack/cast while active).
        /// </summary>
        public static bool SeatCanActThisTurn(
            GameState state,
            SeatId seat,
            AbilityDatabase abilities = null)
        {
            if (state?.Units == null || state.Phase != Phase.Play) return false;

            var companyUsedThisTurn = state.CompanyActivatedThisTurn != null &&
                                      state.CompanyActivatedThisTurn.TryGetValue(seat, out var used) &&
                                      !string.IsNullOrEmpty(used);

            if (!companyUsedThisTurn)
            {
                foreach (var u in state.Units)
                {
                    if (u.Seat != seat || u.Kind != UnitKind.Officer) continue;
                    if (state.CompaniesActivatedThisRound == null ||
                        !state.CompaniesActivatedThisRound.TryGetValue(u.Id, out var done) ||
                        !done)
                        return true;
                }
            }

            if (!CommanderActivation.IsCommanderActivatedThisRound(state, seat))
            {
                foreach (var u in state.Units)
                    if (u.Seat == seat && u.Kind == UnitKind.Commander)
                        return true;
            }

            foreach (var u in state.Units)
            {
                if (u.Seat != seat) continue;
                if (UnitBattleAvailability.HasRemainingActions(state, u, abilities))
                    return true;
            }

            return false;
        }

        static void AdvanceTurnOnce(GameState state, CardDatabase cards)
        {
            var from = state.ActiveSeat ?? SeatId.N;
            CombatFollowup.DismissPendingFollowupsForSeat(state, from);
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
                    if (u.Seat == from)
                    {
                        u.AttackedThisTurn = false;
                        u.FrenzyAttackPending = false;
                    }
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
