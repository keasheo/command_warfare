using System;
using System.Collections.Generic;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of play/shared/army.ts battle loadout types.</summary>
    public enum BattleBucket
    {
        Deploy,
        Reserve,
        Unused,
    }

    [Serializable]
    public struct LoadoutPools
    {
        public int DeployMax;
        public int ReserveMax;

        public static LoadoutPools Default => new()
        {
            DeployMax = GameConstants.DeployUvMax,
            ReserveMax = GameConstants.ReserveUvMax,
        };
    }

    [Serializable]
    public class DemoCompany
    {
        public CardDefinition Officer;
        public List<CardDefinition> Units = new();

        public int Uv
        {
            get
            {
                var uv = Officer != null ? Officer.uv : 0;
                if (Units == null) return uv;
                foreach (var u in Units)
                    if (u != null) uv += u.uv;
                return uv;
            }
        }

        public string OfficerId => Officer != null ? Officer.cardId : null;
        public string OfficerName => Officer != null ? Officer.displayName : "?";
    }

    [Serializable]
    public class DemoArmy
    {
        public CardDefinition Commander;
        public List<DemoCompany> Companies = new();

        public int TotalUv
        {
            get
            {
                var uv = Commander != null ? Commander.uv : 0;
                if (Companies == null) return uv;
                foreach (var co in Companies)
                    if (co != null) uv += co.Uv;
                return uv;
            }
        }
    }

    [Serializable]
    public struct BattleLoadoutTotals
    {
        public int Deploy;
        public int Reserve;
        public int Unused;
    }

    /// <summary>Greedy default loadout — port of defaultBattleLoadout.</summary>
    public static class BattleLoadoutUtil
    {
        public static Dictionary<string, BattleBucket> DefaultBattleLoadout(
            DemoArmy army,
            LoadoutPools? pools = null)
        {
            var caps = pools ?? LoadoutPools.Default;
            var loadout = new Dictionary<string, BattleBucket>();
            if (army?.Companies == null) return loadout;

            var deployLeft = caps.DeployMax;
            var reserveLeft = caps.ReserveMax;
            foreach (var co in army.Companies)
            {
                if (co?.Officer == null || string.IsNullOrEmpty(co.OfficerId)) continue;
                var uv = co.Uv;
                if (uv <= deployLeft)
                {
                    loadout[co.OfficerId] = BattleBucket.Deploy;
                    deployLeft -= uv;
                }
                else if (uv <= reserveLeft)
                {
                    loadout[co.OfficerId] = BattleBucket.Reserve;
                    reserveLeft -= uv;
                }
                else
                {
                    loadout[co.OfficerId] = BattleBucket.Unused;
                }
            }
            return loadout;
        }

        public static BattleLoadoutTotals Totals(DemoArmy army, Dictionary<string, BattleBucket> loadout)
        {
            var totals = new BattleLoadoutTotals();
            if (army?.Companies == null || loadout == null) return totals;
            foreach (var co in army.Companies)
            {
                if (co?.OfficerId == null || !loadout.TryGetValue(co.OfficerId, out var bucket))
                    continue;
                switch (bucket)
                {
                    case BattleBucket.Deploy: totals.Deploy += co.Uv; break;
                    case BattleBucket.Reserve: totals.Reserve += co.Uv; break;
                    case BattleBucket.Unused: totals.Unused += co.Uv; break;
                }
            }
            return totals;
        }

        public static string Validate(
            DemoArmy army,
            Dictionary<string, BattleBucket> loadout,
            LoadoutPools? pools = null)
        {
            var caps = pools ?? LoadoutPools.Default;
            if (army?.Companies == null) return "No army.";
            loadout ??= new Dictionary<string, BattleBucket>();

            foreach (var co in army.Companies)
            {
                if (co?.OfficerId == null) continue;
                if (!loadout.ContainsKey(co.OfficerId))
                    return $"Assign {co.OfficerName} to Deploy, Reserve, or Unused.";
            }

            var totals = Totals(army, loadout);
            if (totals.Deploy > caps.DeployMax)
                return $"Deploy UV {totals.Deploy} exceeds max {caps.DeployMax}.";
            if (totals.Reserve > caps.ReserveMax)
                return $"Reserve UV {totals.Reserve} exceeds max {caps.ReserveMax}.";

            var siegeErr = CommandWarfare.Core.Deploy.SiegeRules.ValidateDeploySiegeCap(army, loadout);
            if (siegeErr != null) return siegeErr;
            return null;
        }

        public static void SetBucket(
            Dictionary<string, BattleBucket> loadout,
            string officerId,
            BattleBucket bucket)
        {
            if (loadout == null || string.IsNullOrEmpty(officerId)) return;
            loadout[officerId] = bucket;
        }
    }
}
