using System;
using System.Collections.Generic;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of DeployItem / deployQueueFromArmy from play/shared.</summary>
    [Serializable]
    public class DeployQueueItem
    {
        public string Kind; // commander | officer | unit
        public string CardId;
        public string CardName;
        public string OfficerCardId;
        public int Move;
        public bool Placed;

        public UnitKind UnitKind => Kind switch
        {
            "commander" => UnitKind.Commander,
            "officer" => UnitKind.Officer,
            _ => UnitKind.Unit,
        };
    }

    public static class DeployQueueBuilder
    {
        public static List<DeployQueueItem> FromArmy(
            DemoArmy army,
            Dictionary<string, BattleBucket> loadout,
            BattleBucket bucket)
        {
            var q = new List<DeployQueueItem>();
            if (army == null) return q;
            loadout ??= new Dictionary<string, BattleBucket>();

            if (bucket == BattleBucket.Deploy && army.Commander != null)
            {
                q.Add(FromCard("commander", army.Commander, ""));
            }

            if (army.Companies == null) return q;
            foreach (var co in army.Companies)
            {
                if (co?.Officer == null || string.IsNullOrEmpty(co.OfficerId)) continue;
                if (!loadout.TryGetValue(co.OfficerId, out var b) || b != bucket) continue;

                q.Add(FromCard("officer", co.Officer, co.OfficerId));
                if (co.Units == null) continue;
                foreach (var u in co.Units)
                {
                    if (u == null) continue;
                    q.Add(FromCard("unit", u, co.OfficerId));
                }
            }
            return q;
        }

        static DeployQueueItem FromCard(string kind, CardDefinition card, string officerCardId) => new()
        {
            Kind = kind,
            CardId = card.cardId,
            CardName = card.displayName,
            OfficerCardId = officerCardId ?? "",
            Move = card.move,
            Placed = false,
        };
    }
}
