using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Move/attack reachability using terrain-aware pathfinding.</summary>
    public static class MoveReachability
    {
        public static HashSet<string> ReachableHexes(GameState state, UnitToken unit)
        {
            var result = new HashSet<string>();
            foreach (var kv in Movement.ReachableMoveHexes(state, unit))
                result.Add(kv.Key);
            return result;
        }

        public static HashSet<string> AttackTargetKeys(GameState state, UnitToken attacker)
        {
            var keys = new HashSet<string>();
            var range = System.Math.Max(1, attacker.Range ?? 1);
            var origin = new HexCoord(attacker.Col, attacker.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == attacker.Seat) continue;
                if (u.Kind == UnitKind.Commander && (u.ToughnessCurrent ?? 0) <= 0) continue;
                if (u.ToughnessCurrent == null) continue;
                var d = HexMath.Distance(origin, new HexCoord(u.Col, u.Row));
                if (d < 1 || d > range) continue;
                if (!CanTarget(attacker, u, d)) continue;
                keys.Add(HexMath.Key(u.Col, u.Row));
            }
            return keys;
        }

        public static bool CanTarget(UnitToken attacker, UnitToken defender, int dist)
        {
            var defenderFlying = CombatKeywords.HasUnitAbility(defender, "Flying");
            if (defenderFlying && dist <= 1)
            {
                return CombatKeywords.HasUnitAbility(attacker, "Reach") ||
                       CombatKeywords.HasUnitAbility(attacker, "Flying");
            }

            // Stealth: cannot be targeted by ranged attacks unless it attacked this round.
            var atkRange = System.Math.Max(1, attacker.Range ?? 1);
            if (CombatKeywords.HasUnitAbility(defender, "Stealth") &&
                atkRange > 1 &&
                dist > 1 &&
                !defender.AttackedThisRound)
                return false;

            return true;
        }
    }
}
