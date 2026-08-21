using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of undoMove from play/shared/game.ts.</summary>
    public static class UndoMove
    {
        public static string TryUndo(GameState state, SeatId seat, string unitId, CardDatabase cards)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            if (state.ActiveSeat != seat)
                return "Not your turn.";

            UnitToken unit = null;
            foreach (var u in state.Units)
            {
                if (u.Id == unitId)
                {
                    unit = u;
                    break;
                }
            }
            if (unit == null || unit.Seat != seat)
                return "Invalid unit.";
            if (unit.ActivationCol == null || unit.ActivationRow == null)
                return "Activate this unit/commander before undoing movement.";

            var startCol = unit.ActivationCol.Value;
            var startRow = unit.ActivationRow.Value;
            var fullBudget = FullMoveBudget(state, unit, cards);
            if (unit.Col == startCol && unit.Row == startRow && unit.MoveRemaining == fullBudget)
                return "Nothing to undo — unit is still at its start hex.";

            unit.Col = startCol;
            unit.Row = startRow;
            // Recalc budget at restored hex (terrain/formation may differ).
            unit.MoveRemaining = FullMoveBudget(state, unit, cards);

            ObjectiveSystem.RecalculateControl(state);
            state.WinnerSeat = null;
            if (state.Phase != Phase.Ended)
                state.Phase = Phase.Play;
            state.LastActionLog =
                $"{seat} reset {unit.CardName} to ({startCol},{startRow}) — Move restored.";
            return null;
        }

        public static int FullMoveBudget(GameState state, UnitToken unit, CardDatabase cards)
        {
            var march = Formation.MarchBonus(state, unit, cards);
            var terrain = FavoredTerrain.MoveBonus(state, unit, cards);
            var budget = unit.Move + unit.TempMove + march + terrain;
            return StatusEffects.EffectiveMoveBudget(unit, budget);
        }
    }
}
