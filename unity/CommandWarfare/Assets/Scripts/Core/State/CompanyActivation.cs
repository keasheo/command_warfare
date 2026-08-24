using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of company activation from play/shared/game.ts (subset for offline skirmish).</summary>
    public static class CompanyActivation
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

        public static ActivateResult TryActivateCompany(
            GameState state,
            UnitToken officer,
            CardDatabase cards)
        {
            if (state.Phase != Phase.Play)
                return ActivateResult.Fail("Not play phase.");
            if (state.ActiveSeat == null || officer.Seat != state.ActiveSeat)
                return ActivateResult.Fail("Not your turn.");
            if (officer.Kind != UnitKind.Officer)
                return ActivateResult.Fail("Select one of your officers.");

            if (state.CompaniesActivatedThisRound.TryGetValue(officer.Id, out var done) && done)
                return ActivateResult.Fail($"{officer.CardName}'s company already activated this round.");

            if (state.CompanyActivatedThisTurn.TryGetValue(officer.Seat, out var other) &&
                other != officer.Id)
                return ActivateResult.Fail("You may activate only one company per turn.");

            if (state.ActiveCompanyOfficerId == officer.Id)
                return ActivateResult.Success(null);

            var ccSpend = PoolSpending.TrySpendCommanderCc(
                state, officer.Seat, GameConstants.OfficerActivateCcCost);
            if (!ccSpend.Ok)
                return ActivateResult.Fail(ccSpend.Error ?? "Not enough CC.");

            EndPreviousCompanyActivation(state, officer.Seat);

            var companyCardId = officer.CardId;
            var poisonKills = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (!InCompany(u, officer.Seat, officer.Id, companyCardId)) continue;

                // Poison tick: lose 1 Toughness at start of activation, then clear token.
                if (u.PoisonTokens > 0 && u.ToughnessCurrent != null)
                {
                    u.ToughnessCurrent = System.Math.Max(0, u.ToughnessCurrent.Value - 1);
                    u.PoisonTokens = System.Math.Max(0, u.PoisonTokens - 1);
                    if (u.ToughnessCurrent <= 0)
                        poisonKills.Add(u);
                }

                var march = Formation.MarchBonus(state, u, cards);
                var terrainMove = FavoredTerrain.MoveBonus(state, u, cards);
                var budget = u.Move + u.TempMove + march + terrainMove;
                StatusEffects.MarkSlowForActivation(u);
                u.MoveRemaining = StatusEffects.EffectiveMoveBudget(u, budget);
                u.ActivationCol = u.Col;
                u.ActivationRow = u.Row;
                u.TempDamage = 0;
                u.TempMove = 0;
                u.Harden = 0;
                u.EvadeActive = false;
                u.TrampleLeftoverDamage = 0;
            }

            foreach (var dead in poisonKills)
                UnitDestruction.RemoveDead(state, dead, out _);

            state.ActiveCompanyOfficerId = officer.Id;
            state.CompaniesActivatedThisRound[officer.Id] = true;
            state.CompanyActivatedThisTurn[officer.Seat] = officer.Id;

            PoolRefresh.RefreshCompanyPool(state, officer, cards);
            var pool = state.CompanyPools.TryGetValue(officer.Id, out var p) ? p : default;
            var poisonNote = poisonKills.Count > 0 ? $" · Poison killed {poisonKills.Count}" : "";
            return ActivateResult.Success(
                $"{officer.Seat} activated {officer.CardName}'s company (−{GameConstants.OfficerActivateCcCost} CC · AP {pool.Ap}/{pool.ApMax}){poisonNote}.");
        }

        public static void EndPreviousCompanyActivation(GameState state, SeatId seat)
        {
            var prevOfficerId = state.ActiveCompanyOfficerId;
            if (string.IsNullOrEmpty(prevOfficerId)) return;

            var prevOfficer = FindUnit(state, prevOfficerId);
            if (prevOfficer == null || prevOfficer.Seat != seat) return;

            var companyCardId = prevOfficer.CardId;
            foreach (var u in state.Units)
            {
                if (!InCompany(u, seat, prevOfficerId, companyCardId)) continue;
                StatusEffects.ClearConsumedSlow(u);
                u.MoveRemaining = 0;
                u.ActivationCol = null;
                u.ActivationRow = null;
            }

            state.ActiveCompanyOfficerId = null;
        }

        public static UnitToken FindOfficerForUnit(GameState state, UnitToken unit)
        {
            if (unit.Kind == UnitKind.Officer) return unit;
            if (unit.Kind == UnitKind.Commander) return null;
            if (string.IsNullOrEmpty(unit.OfficerCardId)) return null;

            foreach (var u in state.Units)
            {
                if (u.Seat == unit.Seat && u.Kind == UnitKind.Officer && u.CardId == unit.OfficerCardId)
                    return u;
            }
            return null;
        }

        public static bool IsUnitInActiveCompany(GameState state, UnitToken unit)
        {
            if (unit.Kind == UnitKind.Commander) return true;
            if (string.IsNullOrEmpty(state.ActiveCompanyOfficerId)) return false;

            var officer = FindUnit(state, state.ActiveCompanyOfficerId);
            if (officer == null) return false;
            return InCompany(unit, officer.Seat, officer.Id, officer.CardId);
        }

        static bool InCompany(UnitToken u, SeatId seat, string officerId, string companyCardId) =>
            u.Seat == seat && (u.Id == officerId || u.OfficerCardId == companyCardId);

        static UnitToken FindUnit(GameState state, string id)
        {
            foreach (var u in state.Units)
                if (u.Id == id) return u;
            return null;
        }
    }
}
