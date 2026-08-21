using System;
using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of DeathRecord / removeDestroyedUnits / reviveFromGrave from play/shared/game.ts.</summary>
    [Serializable]
    public class DeathRecord
    {
        public string Id;
        public string UnitId;
        public SeatId Seat;
        public UnitKind Kind;
        public string CardId;
        public string CardName;
        public string OfficerCardId;
        public int Col;
        public int Row;
        public int Round;
        public int Move;
        public int? Damage;
        public int? Range;
        public int? Toughness;
        public int? CommandRadius;
        public List<string> Keywords = new();
        public List<string> Abilities = new();
        public string Ultimate;
    }

    public static class UnitDestruction
    {
        public static DeathRecord FromUnit(GameState state, UnitToken unit)
        {
            return new DeathRecord
            {
                Id = $"grave-{unit.Id}-{Guid.NewGuid().ToString("N")[..5]}",
                UnitId = unit.Id,
                Seat = unit.Seat,
                Kind = unit.Kind,
                CardId = unit.CardId,
                CardName = unit.CardName,
                OfficerCardId = unit.OfficerCardId,
                Col = unit.Col,
                Row = unit.Row,
                Round = state?.Round ?? 1,
                Move = unit.Move,
                Damage = unit.Damage,
                Range = unit.Range,
                Toughness = unit.Toughness,
                CommandRadius = unit.CommandRadius,
                Keywords = unit.Keywords != null ? new List<string>(unit.Keywords) : new List<string>(),
                Abilities = unit.Abilities != null ? new List<string>(unit.Abilities) : new List<string>(),
                Ultimate = unit.Ultimate,
            };
        }

        /// <summary>Remove a destroyed non-commander unit and append a grave record.</summary>
        public static bool RemoveDead(GameState state, UnitToken unit, out string log)
        {
            log = null;
            if (state == null || unit == null) return false;
            if (unit.Kind == UnitKind.Commander) return false;
            if ((unit.ToughnessCurrent ?? 0) > 0) return false;

            state.Deaths ??= new List<DeathRecord>();
            var death = FromUnit(state, unit);
            state.Deaths.Add(death);
            state.Units.Remove(unit);
            if (unit.Kind == UnitKind.Officer)
                state.CompanyPools.Remove(unit.Id);
            if (state.ActiveCompanyOfficerId == unit.Id)
                state.ActiveCompanyOfficerId = null;
            if (state.SelectedUnitId == unit.Id)
                state.SelectedUnitId = null;

            log = $"{unit.CardName} ({unit.Seat}) is destroyed at ({unit.Col},{unit.Row}).";
            ObjectiveSystem.RecalculateControl(state);
            return true;
        }

        /// <summary>Sweep all non-commander units at ≤0 Toughness into graves.</summary>
        public static int RemoveDestroyedUnits(GameState state)
        {
            if (state?.Units == null) return 0;
            var doomed = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Kind == UnitKind.Commander) continue;
                if (u.ToughnessCurrent != null && u.ToughnessCurrent <= 0)
                    doomed.Add(u);
            }
            var n = 0;
            foreach (var u in doomed)
            {
                if (RemoveDead(state, u, out var log) && !string.IsNullOrEmpty(log))
                {
                    state.LastActionLog = log;
                    n++;
                }
            }
            return n;
        }

        public static string ReviveFromGrave(
            GameState state,
            SeatId seat,
            string deathId,
            HexCoord? dest = null,
            int toughness = 1,
            CardDatabase cards = null)
        {
            if (state == null || state.Phase != Phase.Play)
                return "Not play phase.";
            if (state.ActiveSeat != seat)
                return "Not your turn.";
            if (state.Deaths == null)
                return "Grave not found.";

            DeathRecord death = null;
            foreach (var d in state.Deaths)
            {
                if (d != null && d.Id == deathId)
                {
                    death = d;
                    break;
                }
            }
            if (death == null) return "Grave not found.";
            if (death.Seat != seat)
                return "Only the owner can revive their units.";

            var col = dest?.Col ?? death.Col;
            var row = dest?.Row ?? death.Row;
            var cell = new HexCoord(col, row);
            if (!HexMath.InBounds(cell, state.BoardSize))
                return "Out of bounds.";
            foreach (var u in state.Units)
            {
                if (u.Col == col && u.Row == row)
                    return "Hex is occupied.";
            }

            var revived = BuildRevivedUnit(state, death, cell, toughness, cards);
            state.Units.Add(revived);
            state.Deaths.Remove(death);

            if (revived.Kind == UnitKind.Officer && cards != null)
                PoolRefresh.RefreshCompanyPool(state, revived, cards);

            ObjectiveSystem.RecalculateControl(state);
            state.LastActionLog =
                $"{seat} revives {revived.CardName} at ({col},{row}) — Toughness {revived.ToughnessCurrent}/{revived.Toughness?.ToString() ?? "—"}.";
            return null;
        }

        static UnitToken BuildRevivedUnit(
            GameState state,
            DeathRecord death,
            HexCoord cell,
            int toughnessParam,
            CardDatabase cards)
        {
            CardDefinition card = null;
            if (cards != null)
                card = cards.FindById(death.CardId);

            UnitToken unit;
            if (card != null)
            {
                unit = GameSessionFactory.UnitFromCard(
                    card, death.Seat, death.Kind, cell, death.OfficerCardId);
            }
            else
            {
                unit = new UnitToken
                {
                    Id = Guid.NewGuid().ToString("N")[..8],
                    Seat = death.Seat,
                    Kind = death.Kind,
                    CardId = death.CardId,
                    CardName = death.CardName,
                    OfficerCardId = death.OfficerCardId,
                    Col = cell.Col,
                    Row = cell.Row,
                    Move = death.Move,
                    Damage = death.Damage,
                    Range = death.Range,
                    Toughness = death.Toughness,
                    CommandRadius = death.CommandRadius,
                    Keywords = new List<string>(death.Keywords ?? new List<string>()),
                    Abilities = new List<string>(death.Abilities ?? new List<string>()),
                    Ultimate = death.Ultimate,
                };
            }

            var printed = unit.Toughness ?? death.Toughness ?? 1;
            var start = Math.Max(1, Math.Min(printed, toughnessParam > 0 ? toughnessParam : 1));
            unit.MoveRemaining = 0;
            unit.ToughnessCurrent = start;
            return unit;
        }
    }
}
