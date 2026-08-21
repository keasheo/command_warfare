using System.Collections.Generic;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Net
{
    /// <summary>Apply server GameState JSON onto Unity Core.State.GameState.</summary>
    public static class PlayStateApplier
    {
        public static void Apply(GameState target, PlayJson.GameStateDto dto, string rawJson)
        {
            if (target == null || dto == null) return;

            target.RoomCode = dto.roomCode ?? target.RoomCode;
            target.BoardSize = dto.boardSize > 0 ? dto.boardSize : target.BoardSize;
            target.Phase = ParsePhase(dto.phase);
            target.ActiveSeat = ParseSeat(dto.activeSeat);
            target.Round = dto.round > 0 ? dto.round : target.Round;
            target.ActiveCompanyOfficerId = dto.activeCompanyOfficerId;
            target.WinnerSeat = ParseSeat(dto.winner);

            if (!string.IsNullOrEmpty(rawJson))
            {
                var terrain = PlayJson.ParseTerrainMap(rawJson);
                if (terrain.Count > 0)
                    target.Terrain = terrain;

                ApplyCommanderPools(target, rawJson);
                ApplyCompanyPools(target, rawJson);

                var combatLog = PlayJson.ParseLastCombatSummary(rawJson);
                if (!string.IsNullOrEmpty(combatLog))
                    target.LastCombatLog = combatLog;

                target.PendingTrample = MapPendingTrample(PlayJson.ParsePendingTrample(rawJson));

                ApplyDeaths(target, rawJson);
                var fortified = PlayJson.ParseFortifiedHexes(rawJson);
                if (fortified.Count > 0 || rawJson.Contains("\"fortifiedHexes\""))
                    target.FortifiedHexes = fortified;
            }

            if (dto.units == null) return;

            target.Units.Clear();
            foreach (var u in dto.units)
            {
                if (u == null || string.IsNullOrEmpty(u.id)) continue;
                target.Units.Add(ToUnitToken(u));
            }
        }

        static void ApplyCommanderPools(GameState target, string rawJson)
        {
            var parsed = new Dictionary<SeatId, PlayJson.CommanderPoolDto>();
            PlayJson.ParseCommanderPools(rawJson, parsed);
            if (parsed.Count == 0) return;

            target.CommanderPools.Clear();
            foreach (var kv in parsed)
            {
                target.CommanderPools[kv.Key] = new CommanderPool(
                    kv.Value.Ap, kv.Value.Cc, kv.Value.ApMax, kv.Value.CcMax);
            }
        }

        static void ApplyCompanyPools(GameState target, string rawJson)
        {
            var parsed = new Dictionary<string, PlayJson.CompanyPoolDto>();
            PlayJson.ParseCompanyPools(rawJson, parsed);
            if (parsed.Count == 0) return;

            target.CompanyPools.Clear();
            foreach (var kv in parsed)
            {
                target.CompanyPools[kv.Key] = new CompanyPool(kv.Value.Ap, kv.Value.ApMax);
            }
        }

        static UnitToken ToUnitToken(PlayJson.UnitDto u) => new()
        {
            Id = u.id,
            Seat = ParseSeat(u.seat) ?? SeatId.N,
            Kind = ParseKind(u.kind),
            CardId = u.cardId,
            CardName = u.cardName,
            Race = null,
            OfficerCardId = u.officerCardId,
            Col = u.col,
            Row = u.row,
            Move = u.move,
            MoveRemaining = u.moveRemaining,
            Damage = NullIfZero(u.damage),
            Range = NullIfZero(u.range),
            Toughness = NullIfZero(u.toughness),
            ToughnessCurrent = NullIfZero(u.toughnessCurrent),
            CommandRadius = NullIfZero(u.commandRadius),
            Keywords = u.keywords != null ? new List<string>(u.keywords) : new List<string>(),
            Abilities = u.abilities != null ? new List<string>(u.abilities) : new List<string>(),
            Ultimate = u.ultimate,
            Rooted = u.rooted,
            Fear = u.fear,
            TerrorFear = u.terrorFear,
            Slow = u.slow,
            SlowPendingClear = u.slowPendingClear,
            EvadeActive = u.evadeActive,
            Unyielding = u.unyielding,
            Harden = u.harden,
            TempDamage = u.tempDamage,
            TempMove = u.tempMove,
            Counterattack = u.counterattack,
            PoisonTokens = u.poisonTokens,
            TrampleLeftoverDamage = u.trampleLeftoverDamage,
            AttackedThisTurn = u.attackedThisTurn,
            FrenzyAttackPending = u.frenzyAttackPending,
            HarassMovePending = u.harassMovePending,
        };

        static void ApplyDeaths(GameState target, string rawJson)
        {
            var parsed = PlayJson.ParseDeaths(rawJson);
            target.Deaths ??= new List<DeathRecord>();
            target.Deaths.Clear();
            foreach (var d in parsed)
            {
                if (string.IsNullOrEmpty(d.Id)) continue;
                target.Deaths.Add(new DeathRecord
                {
                    Id = d.Id,
                    UnitId = d.UnitId,
                    Seat = ParseSeat(d.Seat) ?? SeatId.N,
                    Kind = ParseKind(d.Kind),
                    CardId = d.CardId,
                    CardName = d.CardName,
                    OfficerCardId = d.OfficerCardId,
                    Col = d.Col,
                    Row = d.Row,
                    Round = d.Round,
                    Move = d.Move,
                    Damage = d.Damage > 0 ? d.Damage : null,
                    Range = d.Range > 0 ? d.Range : null,
                    Toughness = d.Toughness > 0 ? d.Toughness : null,
                    CommandRadius = d.CommandRadius > 0 ? d.CommandRadius : null,
                    Keywords = d.Keywords != null ? new List<string>(d.Keywords) : new List<string>(),
                    Abilities = d.Abilities != null ? new List<string>(d.Abilities) : new List<string>(),
                    Ultimate = d.Ultimate,
                });
            }
        }

        static PendingTrample MapPendingTrample(PlayJson.PendingTrampleDto? dto)
        {
            if (!dto.HasValue) return null;
            var p = dto.Value;
            return new PendingTrample
            {
                AttackerId = p.AttackerId,
                DestCol = p.DestCol,
                DestRow = p.DestRow,
                LeftoverDamage = p.LeftoverDamage,
            };
        }

        static int? NullIfZero(int v) => v == 0 ? null : v;

        static Phase ParsePhase(string phase) => phase switch
        {
            "Lobby" => Phase.Lobby,
            "ArmyBuild" => Phase.ArmyBuild,
            "Commanders" => Phase.Commanders,
            "Objectives" => Phase.Objectives,
            "ForceSelect" => Phase.ForceSelect,
            "Terrain" => Phase.Terrain,
            "Deploy" => Phase.Deploy,
            "Play" => Phase.Play,
            "Ended" => Phase.Ended,
            _ => Phase.Play,
        };

        static SeatId? ParseSeat(string seat) => seat switch
        {
            "N" => SeatId.N,
            "S" => SeatId.S,
            "E" => SeatId.E,
            "W" => SeatId.W,
            _ => null,
        };

        static UnitKind ParseKind(string kind) => kind switch
        {
            "commander" => UnitKind.Commander,
            "officer" => UnitKind.Officer,
            _ => UnitKind.Unit,
        };
    }
}
