using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Map;
using CommandWarfare.Core.Objectives;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Builds a dev skirmish GameState from map gen + card catalog.</summary>
    public static class GameSessionFactory
    {
        public static readonly string[] PlayableRaces =
        {
            "Human", "Dwarf", "Elf", "Undead", "Demon", "Dragon", "Beastfolk", "Lizardman", "Construct",
        };

        /// <summary>Lobby/ArmyBuild shell — pick races then call BeginForceSelectFromArmyBuild.</summary>
        public static GameState CreateArmyBuildLobby(string roomSeed, string northRace = "Human", string southRace = "Dwarf")
        {
            return new GameState
            {
                RoomCode = roomSeed,
                BoardSize = GameConstants.BoardSize2P,
                Phase = Phase.ArmyBuild,
                ActiveSeat = SeatId.N,
                Round = 1,
                NorthRace = northRace,
                SouthRace = southRace,
            };
        }

        /// <summary>ArmyBuild → ForceSelect: generate map + armies, no tokens on board yet.</summary>
        public static GameState BeginForceSelectFromArmyBuild(
            GameState lobby,
            CardDatabase cards,
            bool preserveArmies = false)
        {
            var boardSize = GameConstants.BoardSize2P;
            var roomSeed = lobby?.RoomCode ?? "dev";
            var opts = RandomMapGenerator.Options.For2P(boardSize, roomSeed);
            var interactiveTerrain = lobby != null && !lobby.RandomMap;
            var terrain = interactiveTerrain
                ? RandomMapGenerator.GenerateCornerBiomeMap(opts)
                : RandomMapGenerator.GenerateRandomBiomeMap(opts);

            var state = new GameState
            {
                RoomCode = roomSeed,
                BoardSize = boardSize,
                Phase = Phase.ForceSelect,
                ActiveSeat = SeatId.N,
                Round = 1,
                Terrain = terrain,
                NorthRace = string.IsNullOrWhiteSpace(lobby?.NorthRace) ? "Human" : lobby.NorthRace,
                SouthRace = string.IsNullOrWhiteSpace(lobby?.SouthRace) ? "Dwarf" : lobby.SouthRace,
                LoadoutPools = lobby != null && lobby.LoadoutPools.DeployMax > 0
                    ? lobby.LoadoutPools
                    : LoadoutPools.Default,
                RandomMap = lobby != null && lobby.RandomMap,
            };
            state.ForceSelectReady[SeatId.N] = false;
            state.ForceSelectReady[SeatId.S] = false;

            foreach (var kv in opts.Commanders)
            {
                state.Commanders[kv.Key] = kv.Value;
                state.CommanderRadii[kv.Key] = opts.CommanderRadii.TryGetValue(kv.Key, out var r)
                    ? r
                    : GameConstants.DefaultCommanderCommandRadius;
            }

            state.OfflineArmies[SeatId.N] = ResolveArmy(lobby, cards, SeatId.N, state.NorthRace, preserveArmies);
            state.OfflineArmies[SeatId.S] = ResolveArmy(lobby, cards, SeatId.S, state.SouthRace, preserveArmies);
            state.BattleLoadouts[SeatId.N] = BattleLoadoutUtil.DefaultBattleLoadout(
                state.OfflineArmies[SeatId.N], state.LoadoutPools);
            state.BattleLoadouts[SeatId.S] = BattleLoadoutUtil.DefaultBattleLoadout(
                state.OfflineArmies[SeatId.S], state.LoadoutPools);

            state.Objectives = ObjectiveSystem.PlaceCard(ObjectiveSystem.CardById("mirror-ns"), boardSize, roomSeed);
            state.Scores[SeatId.N] = 0;
            state.Scores[SeatId.S] = 0;
            state.LastActionLog = "Force Select — assign companies to Deploy / Reserve / Unused.";
            return state;
        }

        static DemoArmy ResolveArmy(
            GameState lobby,
            CardDatabase cards,
            SeatId seat,
            string race,
            bool preserveArmies)
        {
            if (preserveArmies
                && lobby?.OfflineArmies != null
                && lobby.OfflineArmies.TryGetValue(seat, out var existing)
                && existing?.Commander != null)
                return existing;
            return BuildDemoArmy(cards, race);
        }

        /// <summary>When both seats confirm ForceSelect → Terrain or Deploy (if RandomMap).</summary>
        public static bool TryAdvanceForceSelectToDeploy(GameState state, CardDatabase cards)
        {
            if (state == null || state.Phase != Phase.ForceSelect) return false;
            foreach (var seat in new[] { SeatId.N, SeatId.S })
            {
                if (!state.ForceSelectReady.TryGetValue(seat, out var ready) || !ready)
                    return false;
            }

            if (state.RandomMap)
            {
                TerrainPlacement.FillEmptyHexesWithPlains(state.Terrain, state.BoardSize);
                // Interactive deploy for the player — AI auto-places via SkirmishAi.
                BeginDeployFromLoadouts(state, autoPlace: false);
                state.LastActionLog =
                    "Random battlefield — place Deploy companies on highlighted hexes, then confirm.";
                return true;
            }

            OfflineTerrain.EnterFromForceSelect(state);
            return true;
        }

        /// <summary>Build deploy + reserve queues; board starts empty for interactive place.</summary>
        public static void BeginDeployFromLoadouts(GameState state, bool autoPlace = false)
        {
            if (state == null) return;
            state.Units.Clear();
            state.DeployQueues.Clear();
            state.ReserveQueues.Clear();
            state.DeployQueueIndex.Clear();
            state.DeployReady[SeatId.N] = false;
            state.DeployReady[SeatId.S] = false;

            foreach (var seat in new[] { SeatId.N, SeatId.S })
            {
                state.OfflineArmies.TryGetValue(seat, out var army);
                state.BattleLoadouts.TryGetValue(seat, out var loadout);
                loadout ??= new Dictionary<string, BattleBucket>();
                state.DeployQueues[seat] = DeployQueueBuilder.FromArmy(army, loadout, BattleBucket.Deploy);
                state.ReserveQueues[seat] = DeployQueueBuilder.FromArmy(army, loadout, BattleBucket.Reserve);
                state.DeployQueueIndex[seat] = OfflineDeploy.NextUnplacedIndex(state.DeployQueues[seat]);
            }

            state.Phase = Phase.Deploy;
            if (autoPlace)
            {
                OfflineDeploy.AutoPlaceAll(state, SeatId.N);
                OfflineDeploy.AutoPlaceAll(state, SeatId.S);
            }
            state.LastActionLog = autoPlace
                ? "Deploy — armies auto-placed; confirm when ready."
                : "Deploy — place companies from your queue, then confirm.";
        }

        /// <summary>Legacy name — queue-based begin (empty board).</summary>
        public static void SpawnDeployFromLoadouts(GameState state) =>
            BeginDeployFromLoadouts(state, autoPlace: false);

        /// <summary>ArmyBuild shortcut: randomMap path — skip Terrain, queues auto-placed.</summary>
        public static GameState BeginDeployFromArmyBuild(GameState lobby, CardDatabase cards)
        {
            var state = BeginForceSelectFromArmyBuild(lobby, cards);
            state.RandomMap = true;
            state.ForceSelectReady[SeatId.N] = true;
            state.ForceSelectReady[SeatId.S] = true;
            TerrainPlacement.FillEmptyHexesWithPlains(state.Terrain, state.BoardSize);
            BeginDeployFromLoadouts(state, autoPlace: true);
            state.LastActionLog = "Random biome map — skipping terrain placement.";
            return state;
        }

        /// <summary>Editor/dev: full random map, all companies Deploy, auto-placed.</summary>
        public static GameState CreateDevSkirmish(
            string roomSeed,
            CardDatabase cards,
            string northRace = "Human",
            string southRace = "Dwarf")
        {
            var lobby = CreateArmyBuildLobby(roomSeed, northRace, southRace);
            var state = BeginForceSelectFromArmyBuild(lobby, cards);
            foreach (var seat in new[] { SeatId.N, SeatId.S })
            {
                if (!state.OfflineArmies.TryGetValue(seat, out var army) || army?.Companies == null)
                    continue;
                var loadout = new Dictionary<string, BattleBucket>();
                foreach (var co in army.Companies)
                {
                    if (co?.OfficerId != null)
                        loadout[co.OfficerId] = BattleBucket.Deploy;
                }
                state.BattleLoadouts[seat] = loadout;
            }
            state.RandomMap = true;
            TerrainPlacement.FillEmptyHexesWithPlains(state.Terrain, state.BoardSize);
            BeginDeployFromLoadouts(state, autoPlace: true);
            state.LastActionLog = "Dev skirmish — full Deploy armies.";
            return state;
        }

        public static DemoArmy BuildDemoArmy(CardDatabase cards, string race)
        {
            var army = new DemoArmy();
            var used = new HashSet<string>();
            army.Commander = FindSampleCard(cards, "Commander", race, used);
            if (army.Commander != null) used.Add(army.Commander.cardId);

            var officer1 = FindSampleCard(cards, "Officer", race, used);
            if (officer1 != null) used.Add(officer1.cardId);
            var officer2 = FindSampleCard(cards, "Officer", race, used);
            if (officer2 != null) used.Add(officer2.cardId);

            if (officer1 != null)
            {
                var co1 = new DemoCompany { Officer = officer1 };
                for (var i = 0; i < 6; i++)
                {
                    var unit = FindSampleUnitCard(cards, race, used, preferNonSiege: true);
                    if (unit == null) break;
                    co1.Units.Add(unit);
                }
                army.Companies.Add(co1);
            }

            if (officer2 != null)
                army.Companies.Add(new DemoCompany { Officer = officer2 });

            return army;
        }

        static CardDefinition FindSampleUnitCard(
            CardDatabase cards,
            string race,
            HashSet<string> excludeIds,
            bool preferNonSiege)
        {
            if (cards == null) return null;
            CardDefinition siegeFallback = null;
            foreach (var c in cards.All)
            {
                if (c == null || c.cardType != "Unit") continue;
                if (race != null && !RaceEquals(c.race, race)) continue;
                if (excludeIds != null && excludeIds.Contains(c.cardId)) continue;
                if (preferNonSiege && Deploy.SiegeRules.IsSiegeCard(c))
                {
                    siegeFallback ??= c;
                    continue;
                }
                return c;
            }
            if (siegeFallback != null) return siegeFallback;
            return FindSampleCard(cards, "Unit", race, excludeIds);
        }

        static bool RaceEquals(string cardRace, string want)
        {
            if (string.Equals(cardRace, want, System.StringComparison.OrdinalIgnoreCase)) return true;
            var a = (cardRace ?? "").Trim().ToLowerInvariant();
            var b = (want ?? "").Trim().ToLowerInvariant();
            return (a is "lizardman" or "lizardmen") && (b is "lizardman" or "lizardmen");
        }

        static void SpawnLoadoutArmy(GameState state, SeatId seat)
        {
            if (!state.OfflineArmies.TryGetValue(seat, out var army) || army == null) return;
            state.BattleLoadouts.TryGetValue(seat, out var loadout);
            loadout ??= new Dictionary<string, BattleBucket>();

            var free = BuildLandHexes(state, seat);
            if (free.Count == 0) return;

            if (army.Commander != null)
            {
                var coord = TakeNext(free);
                if (!coord.HasValue) return;
                state.Units.Add(UnitFromCard(army.Commander, seat, UnitKind.Commander, coord.Value));
                state.Commanders[seat] = coord.Value;
            }

            foreach (var co in army.Companies)
            {
                if (co?.Officer == null) continue;
                var bucket = loadout.TryGetValue(co.OfficerId, out var b) ? b : BattleBucket.Unused;
                if (bucket != BattleBucket.Deploy) continue;

                var officerCoord = TakeNext(free);
                if (!officerCoord.HasValue) break;
                state.Units.Add(UnitFromCard(co.Officer, seat, UnitKind.Officer, officerCoord.Value));

                var radius = co.Officer.commandRadius > 0
                    ? co.Officer.commandRadius
                    : GameConstants.DefaultOfficerCommandRadius;

                foreach (var unitCard in co.Units)
                {
                    if (unitCard == null) continue;
                    var spot = TakeInOfficerRadius(free, officerCoord.Value, radius, seat, unitCard, co.OfficerId)
                               ?? TakeNext(free);
                    if (!spot.HasValue) break;
                    state.Units.Add(UnitFromCard(unitCard, seat, UnitKind.Unit, spot.Value, co.OfficerId));
                }
            }
        }

        static List<HexCoord> BuildLandHexes(GameState state, SeatId seat)
        {
            var keys = DeployZone.WedgeKeys(seat, state.BoardSize);
            var land = new List<HexCoord>();
            foreach (var key in keys)
            {
                var c = HexMath.ParseKey(key);
                if (state.Terrain.TryGetValue(key, out var t) && t == TerrainKind.Water) continue;
                land.Add(c);
            }
            if (seat == SeatId.S)
                land.Sort((a, b) => b.Row != a.Row ? b.Row.CompareTo(a.Row) : a.Col.CompareTo(b.Col));
            else
                land.Sort((a, b) => a.Row != b.Row ? a.Row.CompareTo(b.Row) : a.Col.CompareTo(b.Col));
            return land;
        }

        static HexCoord? TakeNext(List<HexCoord> free)
        {
            if (free == null || free.Count == 0) return null;
            var c = free[0];
            free.RemoveAt(0);
            return c;
        }

        static HexCoord? TakeInOfficerRadius(
            List<HexCoord> free,
            HexCoord officer,
            int radius,
            SeatId seat,
            CardDefinition unitCard,
            string officerCardId)
        {
            for (var i = 0; i < free.Count; i++)
            {
                var candidate = free[i];
                var pending = UnitFromCard(unitCard, seat, UnitKind.Unit, candidate, officerCardId);
                if (!CombatResolve.UnitInOfficerRadius(candidate, officer, radius, pending))
                    continue;
                free.RemoveAt(i);
                return candidate;
            }
            return null;
        }

        static CardDefinition FindSampleCard(
            CardDatabase cards,
            string cardType,
            string race,
            HashSet<string> excludeIds = null)
        {
            if (cards == null) return null;
            CardDefinition fallback = null;
            foreach (var c in cards.All)
            {
                if (c == null) continue;
                if (c.cardType != cardType) continue;
                if (race != null && !RaceEquals(c.race, race)) continue;
                if (excludeIds != null && excludeIds.Contains(c.cardId))
                {
                    fallback ??= c;
                    continue;
                }
                return c;
            }
            if (fallback != null) return fallback;
            foreach (var c in cards.All)
            {
                if (c == null || c.cardType != cardType) continue;
                if (excludeIds != null && excludeIds.Contains(c.cardId)) continue;
                return c;
            }
            foreach (var c in cards.All)
                if (c != null && c.cardType == cardType) return c;
            return null;
        }

        public static UnitToken UnitFromCard(
            CardDefinition card,
            SeatId seat,
            UnitKind kind,
            HexCoord coord,
            string officerCardIdForUnit = null)
        {
            return new UnitToken
            {
                Id = System.Guid.NewGuid().ToString("N")[..8],
                Seat = seat,
                Kind = kind,
                CardId = card.cardId,
                CardName = card.displayName,
                Race = card.race,
                OfficerCardId = kind switch
                {
                    UnitKind.Officer => card.cardId,
                    UnitKind.Unit => officerCardIdForUnit,
                    _ => null,
                },
                Col = coord.Col,
                Row = coord.Row,
                Move = card.move,
                MoveRemaining = 0,
                Damage = card.damage,
                Range = card.range,
                Toughness = card.toughness,
                ToughnessCurrent = card.toughness,
                CommandRadius = kind == UnitKind.Commander
                    ? (card.commandRadius > 0 ? card.commandRadius : GameConstants.DefaultCommanderCommandRadius)
                    : (card.commandRadius > 0 ? card.commandRadius : null),
                Keywords = card.keywords != null ? new List<string>(card.keywords) : new List<string>(),
                Abilities = card.abilities != null ? new List<string>(card.abilities) : new List<string>(),
                Ultimate = card.ultimate,
            };
        }
    }
}
