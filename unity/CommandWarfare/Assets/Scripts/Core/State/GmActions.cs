using System;
using System.Collections.Generic;
using System.Text;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of rollDice / applyDamage / applyHeal from play/shared/game.ts.</summary>
    [Serializable]
    public class DiceRollRecord
    {
        public SeatId Seat;
        public int Count;
        public int Sides;
        public List<int> Results = new();
        public int Total;
        public string Note;
    }

    public static class GmActions
    {
        public static string RollDice(
            GameState state,
            SeatId seat,
            int count,
            int sides,
            string note,
            SeededRng rng)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            if (rng == null) return "RNG not ready.";

            count = Math.Min(12, Math.Max(1, count));
            sides = Math.Min(20, Math.Max(2, sides <= 0 ? 6 : sides));
            var results = new List<int>(count);
            var total = 0;
            for (var i = 0; i < count; i++)
            {
                var roll = 1 + rng.NextInt(sides);
                results.Add(roll);
                total += roll;
            }

            state.LastDiceRoll = new DiceRollRecord
            {
                Seat = seat,
                Count = count,
                Sides = sides,
                Results = results,
                Total = total,
                Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            };

            var detail = new StringBuilder();
            detail.Append($"{count}d{sides}: [");
            for (var i = 0; i < results.Count; i++)
            {
                if (i > 0) detail.Append(", ");
                detail.Append(results[i]);
            }
            detail.Append(']');
            if (count > 1) detail.Append($" = {total}");

            var noteSuffix = state.LastDiceRoll.Note != null ? $" ({state.LastDiceRoll.Note})" : "";
            state.LastActionLog = $"{seat} rolled {detail}{noteSuffix}.";
            return null;
        }

        public static string ApplyDamage(GameState state, SeatId seat, string unitId, int amount)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            if (amount < 1) return "Damage must be at least 1.";

            UnitToken target = null;
            foreach (var u in state.Units)
            {
                if (u.Id == unitId) { target = u; break; }
            }
            if (target == null) return "Target not found.";
            if (target.Kind == UnitKind.Commander)
                return "Commander toughness is not tracked yet.";
            if (target.ToughnessCurrent == null)
                return "Target has no Toughness.";

            target.ToughnessCurrent = Math.Max(0, target.ToughnessCurrent.Value - amount);
            state.LastActionLog =
                $"{seat} applies {amount} damage to {target.CardName} ({target.Seat}) → Toughness {target.ToughnessCurrent}/{target.Toughness?.ToString() ?? "—"}.";
            UnitDestruction.RemoveDestroyedUnits(state);
            return null;
        }

        public static string ApplyHeal(GameState state, SeatId seat, string unitId, int amount)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            if (amount < 1) return "Heal must be at least 1.";

            UnitToken target = null;
            foreach (var u in state.Units)
            {
                if (u.Id == unitId) { target = u; break; }
            }
            if (target == null) return "Target not found.";
            if (target.ToughnessCurrent == null || target.Toughness == null)
                return "Target has no Toughness.";

            target.ToughnessCurrent = Math.Min(target.Toughness.Value, target.ToughnessCurrent.Value + amount);
            state.LastActionLog =
                $"{seat} heals {target.CardName} for {amount} → Toughness {target.ToughnessCurrent}/{target.Toughness}.";
            return null;
        }
    }
}
