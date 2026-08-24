using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Spend commander/company AP pools (play/shared/game.ts spendPool).</summary>
    public static class PoolSpending
    {
        public readonly struct SpendResult
        {
            public bool Ok { get; }
            public string Error { get; }
            public string Log { get; }

            public static SpendResult Success(string log) => new(true, null, log);
            public static SpendResult Fail(string error) => new(false, error, null);

            SpendResult(bool ok, string error, string log)
            {
                Ok = ok;
                Error = error;
                Log = log;
            }
        }

        public static SpendResult TrySpendCommanderAp(GameState state, SeatId seat, int amount)
        {
            if (amount < 1) return SpendResult.Fail("Spend at least 1.");
            if (state?.CommanderPools == null || !state.CommanderPools.TryGetValue(seat, out var pool))
                return SpendResult.Fail("No commander pool.");
            if (pool.Ap < amount) return SpendResult.Fail("Not enough AP.");

            pool.Ap -= amount;
            state.CommanderPools[seat] = pool;
            return SpendResult.Success($"{seat} spent {amount} AP ({pool.Ap}/{pool.ApMax} left).");
        }

        public static SpendResult TrySpendCommanderCc(GameState state, SeatId seat, int amount)
        {
            if (amount < 1) return SpendResult.Fail("Spend at least 1.");
            if (state?.CommanderPools == null || !state.CommanderPools.TryGetValue(seat, out var pool))
                return SpendResult.Fail("No commander pool.");
            if (pool.Cc < amount) return SpendResult.Fail("Not enough CC.");

            pool.Cc -= amount;
            state.CommanderPools[seat] = pool;
            return SpendResult.Success($"{seat} spent {amount} CC ({pool.Cc}/{pool.CcMax} left).");
        }

        public static SpendResult TrySpendCompanyAp(GameState state, string officerId, int amount)
        {
            if (amount < 1) return SpendResult.Fail("Spend at least 1.");
            if (string.IsNullOrEmpty(officerId))
                return SpendResult.Fail("Activate a company to spend Company AP.");
            if (state?.CompanyPools == null || !state.CompanyPools.TryGetValue(officerId, out var pool))
                return SpendResult.Fail("No company pool.");
            if (pool.Ap < amount) return SpendResult.Fail("Not enough Company AP.");

            pool.Ap -= amount;
            state.CompanyPools[officerId] = pool;
            return SpendResult.Success($"Spent {amount} Company AP ({pool.Ap}/{pool.ApMax} left).");
        }
    }
}
