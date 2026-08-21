using System;
using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Manual Cleave damage split — declare before Hit rolls (keywords.yaml).</summary>
    public static class CleavePlanner
    {
        public static bool CanCleave(UnitToken attacker, UnitToken primary, GameState state)
        {
            if (attacker == null || primary == null || state == null) return false;
            if (!CombatKeywords.HasCleave(attacker) || CombatKeywords.HasBlast(attacker)) return false;
            var dist = HexMath.Distance(
                new HexCoord(attacker.Col, attacker.Row),
                new HexCoord(primary.Col, primary.Row));
            if (dist != 1) return false;
            return CombatDamage.EffectiveDamage(attacker) > 1 &&
                   AdjacentEnemyCount(state, attacker) > 1;
        }

        public static int AdjacentEnemyCount(GameState state, UnitToken attacker)
        {
            var n = 0;
            var origin = new HexCoord(attacker.Col, attacker.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == attacker.Seat) continue;
                if (u.ToughnessCurrent == null) continue;
                if (u.Kind == UnitKind.Commander && (u.ToughnessCurrent ?? 0) <= 0) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) == 1)
                    n++;
            }
            return n;
        }

        public static List<UnitToken> AdjacentEnemies(GameState state, UnitToken attacker)
        {
            var list = new List<UnitToken>();
            var origin = new HexCoord(attacker.Col, attacker.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == attacker.Seat) continue;
                if (u.ToughnessCurrent == null) continue;
                if (u.Kind == UnitKind.Commander && (u.ToughnessCurrent ?? 0) <= 0) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) == 1)
                    list.Add(u);
            }
            return list;
        }

        public static PendingCleave Begin(UnitToken attacker, UnitToken primary)
        {
            var total = CombatDamage.EffectiveDamage(attacker);
            return new PendingCleave
            {
                AttackerId = attacker.Id,
                TotalDamage = total,
                Assignments = new List<CleaveAssignment>
                {
                    new() { TargetId = primary.Id, Damage = 1 },
                },
            };
        }

        public static int AssignedTotal(PendingCleave pending)
        {
            var sum = 0;
            foreach (var a in pending.Assignments)
                sum += a.Damage;
            return sum;
        }

        public static int Leftover(PendingCleave pending) =>
            Math.Max(0, pending.TotalDamage - AssignedTotal(pending));

        public static bool TryAssign(PendingCleave pending, string targetId)
        {
            if (pending == null || string.IsNullOrEmpty(targetId)) return false;
            if (Leftover(pending) <= 0) return false;
            foreach (var a in pending.Assignments)
            {
                if (a.TargetId != targetId) continue;
                a.Damage += 1;
                return true;
            }
            pending.Assignments.Add(new CleaveAssignment { TargetId = targetId, Damage = 1 });
            return true;
        }

        /// <summary>Dump remaining Damage onto the primary (first) assignment.</summary>
        public static void FinalizeRemainder(PendingCleave pending)
        {
            if (pending?.Assignments == null || pending.Assignments.Count == 0) return;
            var left = Leftover(pending);
            if (left > 0)
                pending.Assignments[0].Damage += left;
        }

        public static bool IsLegalTarget(GameState state, PendingCleave pending, UnitToken target)
        {
            if (pending == null || target == null) return false;
            var attacker = FindUnit(state, pending.AttackerId);
            if (attacker == null || target.Seat == attacker.Seat) return false;
            return HexMath.Distance(
                new HexCoord(attacker.Col, attacker.Row),
                new HexCoord(target.Col, target.Row)) == 1;
        }

        static UnitToken FindUnit(GameState state, string id)
        {
            foreach (var u in state.Units)
                if (u.Id == id) return u;
            return null;
        }
    }

    [Serializable]
    public class PendingCleave
    {
        public string AttackerId;
        public int TotalDamage;
        public List<CleaveAssignment> Assignments = new();
    }

    [Serializable]
    public class CleaveAssignment
    {
        public string TargetId;
        public int Damage;
    }
}
