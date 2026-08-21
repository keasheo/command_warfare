using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Commander + company AP pool refresh (play/shared/game.ts refreshAllPools).</summary>
    public static class PoolRefresh
    {
        public static void RefreshAllPools(GameState state, CardDatabase cards)
        {
            RefreshCommanderPools(state, cards);
            state.CompanyPools.Clear();
            foreach (var u in state.Units)
            {
                if (u.Kind != UnitKind.Officer) continue;
                RefreshCompanyPool(state, u, cards);
            }
        }

        public static void RefreshCommanderPools(GameState state, CardDatabase cards)
        {
            foreach (var seat in new[] { SeatId.N, SeatId.S })
            {
                UnitToken commander = null;
                foreach (var u in state.Units)
                {
                    if (u.Seat == seat && u.Kind == UnitKind.Commander)
                    {
                        commander = u;
                        break;
                    }
                }

                var card = commander != null ? cards?.FindById(commander.CardId) : null;
                var apMax = card?.apGeneration ?? 0;
                var ccMax = card?.ccGeneration ?? 0;
                if (apMax < 0) apMax = 0;
                if (ccMax < 0) ccMax = 0;

                state.CommanderPools[seat] = new CommanderPool(apMax, ccMax, apMax, ccMax);
            }
        }

        public static void RefreshCompanyPool(GameState state, UnitToken officer, CardDatabase cards)
        {
            var card = cards?.FindById(officer.CardId);
            var max = card?.companyAp ?? 0;
            if (max < 0) max = 0;
            state.CompanyPools[officer.Id] = new CompanyPool(max, max);
        }

        public static void BeginNewRound(GameState state, CardDatabase cards)
        {
            state.CompaniesActivatedThisRound.Clear();
            state.CompanyActivatedThisTurn.Clear();
            state.CommanderActivatedThisRound.Clear();
            state.ActiveCompanyOfficerId = null;
            RefreshCommanderPools(state, cards);

            foreach (var u in state.Units)
            {
                u.MoveRemaining = 0;
                u.ActivationCol = null;
                u.ActivationRow = null;
                u.TempDamage = 0;
                u.TempMove = 0;
                u.Harden = 0;
                u.EvadeActive = false;
                u.TrampleLeftoverDamage = 0;
                u.AttackedThisTurn = false;
                u.AttackedThisRound = false;
                u.FrenzyAttackPending = false;
                StatusEffects.ClearRoundStatuses(u);
            }
        }
    }
}
