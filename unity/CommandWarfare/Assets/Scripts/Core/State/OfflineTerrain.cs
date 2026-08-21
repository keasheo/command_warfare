using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Map;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>
    /// Offline Terrain: corner biomes → command-zone (flood | pieces) → landLarge/Medium/Small → Deploy.
    /// Port of beginTerrain / command-zone / land path from play/shared/game.ts.
    /// </summary>
    public static class OfflineTerrain
    {
        static readonly Dictionary<string, TerrainKind> RaceFavored = new()
        {
            { "Human", TerrainKind.Plains },
            { "Dwarf", TerrainKind.Mountains },
            { "Elf", TerrainKind.Forest },
            { "Undead", TerrainKind.Swamp },
            { "Demon", TerrainKind.Volcanic },
            { "Dragon", TerrainKind.Volcanic },
            { "Beastfolk", TerrainKind.Forest },
            { "Lizardmen", TerrainKind.Swamp },
            { "Construct", TerrainKind.Plains },
        };

        public static bool IsSeatReady(GameState state, SeatId seat) =>
            state.TerrainReady.TryGetValue(seat, out var ready) && ready;

        public static bool IsLandStage(string stage) =>
            stage is "landLarge" or "landMedium" or "landSmall";

        public static string SizeForStage(string stage) => stage switch
        {
            "landLarge" => "large",
            "landMedium" => "medium",
            "landSmall" => "small",
            _ => null,
        };

        public static TerrainKind FavoredFloodKind(string race)
        {
            if (!string.IsNullOrEmpty(race) && RaceFavored.TryGetValue(race, out var kind))
                return kind;
            return TerrainKind.Plains;
        }

        public static string RaceForSeat(GameState state, SeatId seat) =>
            seat == SeatId.N ? state.NorthRace : state.SouthRace;

        public static string ModeFor(GameState state, SeatId seat) =>
            state.CommandZoneModes != null && state.CommandZoneModes.TryGetValue(seat, out var m)
                ? m
                : null;

        public static List<TerrainQueueItem> HandFor(GameState state, SeatId seat)
        {
            state.TerrainHands ??= new Dictionary<SeatId, List<TerrainQueueItem>>();
            if (!state.TerrainHands.TryGetValue(seat, out var hand) || hand == null)
            {
                hand = new List<TerrainQueueItem>();
                state.TerrainHands[seat] = hand;
            }
            return hand;
        }

        public static void EnterFromForceSelect(GameState state)
        {
            TerrainPieceCatalog.EnsureFallback();
            var opts = RandomMapGenerator.Options.For2P(state.BoardSize, state.RoomCode ?? "dev");
            opts.Commanders = new Dictionary<SeatId, HexCoord>(state.Commanders);
            opts.CommanderRadii = new Dictionary<SeatId, int>(state.CommanderRadii);
            opts.ObjectiveKeys = ObjectiveKeys(state);

            state.Terrain = RandomMapGenerator.GenerateCornerBiomeMap(opts);
            state.Phase = Phase.Terrain;
            state.TerrainStage = "commandZone";
            state.RandomMap = false;
            state.ActiveSeat = null;
            state.TerrainReady[SeatId.N] = false;
            state.TerrainReady[SeatId.S] = false;
            state.CommandZoneFlooded[SeatId.N] = false;
            state.CommandZoneFlooded[SeatId.S] = false;
            state.CommandZoneModes.Clear();
            state.TerrainHands.Clear();
            state.PendingCrHandIndex.Clear();
            state.LandDropsUsed.Clear();
            state.PendingLandPieceId = null;
            state.PendingLandRotation = 0;
            var quota = TerrainPieceCatalog.QuotaLabel(state.MaxPlayers);
            state.LastActionLog =
                $"Terrain — corners seeded. Command zone: flood CR or place pieces ({quota}), then confirm.";
        }

        public static string ChooseCommandZoneMode(GameState state, SeatId seat, string mode)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (mode != "flood" && mode != "pieces")
                return "Mode must be flood or pieces.";
            var hand = HandFor(state, seat);
            if (CommandZoneHasProgress(hand))
                return "Cannot change mode after placing terrain.";
            if (ModeFor(state, seat) != null)
                return "Mode already chosen.";

            state.CommandZoneModes[seat] = mode;
            var label = mode == "flood"
                ? "flood-fill their CR with one terrain type"
                : $"place pieces ({TerrainPieceCatalog.QuotaLabel(state.MaxPlayers)})";
            state.LastActionLog = $"{seat} chose to {label}.";
            return null;
        }

        public static string FloodSeat(GameState state, SeatId seat, TerrainKind kind)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (ModeFor(state, seat) != "flood")
                return "Choose flood mode first.";
            if (state.CommandZoneFlooded.TryGetValue(seat, out var flooded) && flooded)
                return "CR already flood-filled.";
            if (!state.Commanders.TryGetValue(seat, out var commander))
                return "Commander not placed.";

            var radius = state.CommanderRadii.TryGetValue(seat, out var r)
                ? r
                : GameConstants.DefaultCommanderCommandRadius;
            var ownCr = TerrainPlacement.OwnCommandRadiusKeys(commander, radius, state.BoardSize);
            var err = TerrainPlacement.FloodCommandZone(
                state.Terrain, commander, ownCr, ObjectiveKeys(state), kind);
            if (err != null) return err;

            state.CommandZoneFlooded[seat] = true;
            var hand = HandFor(state, seat);
            hand.Clear();
            hand.Add(new TerrainQueueItem
            {
                InstanceId = $"{seat}-flood-{kind}",
                PieceId = $"__flood__-{kind}",
                Name = $"{kind} flood",
                Kind = kind,
                SizeClass = "small",
                Placed = true,
                Flooded = true,
            });
            state.LastActionLog = $"{seat} flood-filled their CR with {kind}.";
            return null;
        }

        public static string PickCrPiece(GameState state, SeatId seat, string pieceId)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (ModeFor(state, seat) != "pieces")
                return "Choose piece placement mode first.";

            var def = TerrainPieceCatalog.Get(pieceId);
            if (def == null) return "Unknown terrain piece.";
            var catalog = TerrainPieceCatalog.CommandZoneCatalog(state.MaxPlayers);
            var allowed = false;
            foreach (var p in catalog)
                if (p.id == def.id) { allowed = true; break; }
            if (!allowed) return "That piece is not available in your CR quota.";

            var quota = CommandZonePieceQuota.ForMaxPlayers(state.MaxPlayers);
            var hand = HandFor(state, seat);
            if (CommandZoneSizeUsed(hand, def.sizeClass) >= quota[def.sizeClass])
                return $"No {def.sizeClass} piece slots left ({quota[def.sizeClass]} max).";
            if (def.KindEnum == TerrainKind.Water && !def.IsSmall)
                return "Water is only available as small pieces.";

            var item = MakeHandItem(def, seat, hand.Count);
            var unplaced = hand.FindIndex(q => q != null && !q.Placed && !q.Skipped && !q.Flooded);
            if (unplaced >= 0)
            {
                var prev = hand[unplaced];
                item.InstanceId = $"{seat}-{def.id}-{unplaced}";
                hand[unplaced] = item;
                state.PendingCrHandIndex[seat] = unplaced;
                state.LastActionLog = prev.PieceId == def.id
                    ? $"{seat} kept {def.name}."
                    : $"{seat} swapped {prev.Name} for {def.name}.";
            }
            else
            {
                hand.Add(item);
                state.PendingCrHandIndex[seat] = hand.Count - 1;
                state.LastActionLog = $"{seat} chose {def.name} ({def.sizeClass}).";
            }
            return null;
        }

        public static string UnpickCrPiece(GameState state, SeatId seat, int handIndex)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (ModeFor(state, seat) != "pieces")
                return "Not in piece placement mode.";
            var hand = HandFor(state, seat);
            if (handIndex < 0 || handIndex >= hand.Count) return "Invalid hand slot.";
            var item = hand[handIndex];
            if (item.Placed || item.Skipped || item.Flooded)
                return "That pick slot is already resolved.";
            hand.RemoveAt(handIndex);
            if (state.PendingCrHandIndex.TryGetValue(seat, out var sel) && sel == handIndex)
                state.PendingCrHandIndex[seat] = -1;
            state.LastActionLog = $"{seat} put {item.Name} back (not locked — pick another).";
            return null;
        }

        public static string PlaceCrPiece(GameState state, SeatId seat, HexCoord anchor)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (ModeFor(state, seat) != "pieces")
                return "Not in piece placement mode.";
            if (!state.Commanders.TryGetValue(seat, out var commander))
                return "Commander not placed.";

            var hand = HandFor(state, seat);
            var handIndex = state.PendingCrHandIndex.TryGetValue(seat, out var hi) ? hi : -1;
            if (handIndex < 0 || handIndex >= hand.Count)
            {
                handIndex = hand.FindIndex(q => q != null && !q.Placed && !q.Skipped && !q.Flooded);
                if (handIndex < 0) return "Pick a terrain piece before placing.";
            }
            var item = hand[handIndex];
            if (item == null || item.Placed || item.Skipped || item.Flooded)
                return item?.Placed == true
                    ? "Already placed that piece."
                    : item?.Skipped == true
                        ? "That pick was skipped."
                        : "Pick a terrain piece before placing.";

            var radius = state.CommanderRadii.TryGetValue(seat, out var r)
                ? r
                : GameConstants.DefaultCommanderCommandRadius;
            var ownCr = TerrainPlacement.OwnCommandRadiusKeys(commander, radius, state.BoardSize);
            var rotation = TerrainPlacement.NormalizeRotation(state.PendingLandRotation);
            var shape = item.Shape?.ToArray() ?? System.Array.Empty<TerrainPlacement.AxialOffset>();
            var cells = TerrainPlacement.ExpandTerrainPiece(anchor, shape, rotation);
            var commanderKey = HexMath.Key(commander.Col, commander.Row);
            var coversCommander = false;
            foreach (var cell in cells)
            {
                if (HexMath.Key(cell.Col, cell.Row) == commanderKey)
                {
                    coversCommander = true;
                    break;
                }
            }
            if (coversCommander && !TerrainPlacement.MayCoverCommander(item.Kind))
                return "Only soft land may cover your commander hex (not Water/Wall).";

            var isSmallBridge = item.SizeClass == "small" &&
                                item.Kind != TerrainKind.Water &&
                                item.Kind != TerrainKind.Wall;
            var err = TerrainPlacement.ValidateTerrainPlacement(
                cells,
                state.BoardSize,
                state.Terrain,
                ObjectiveKeys(state),
                item.Kind,
                requiredKeys: ownCr,
                blockedKeys: null,
                allowOverwriteWater: isSmallBridge);
            if (err != null) return err;

            if (item.Kind is TerrainKind.Water or TerrainKind.Wall)
            {
                var tentative = new Dictionary<string, TerrainKind>(state.Terrain);
                foreach (var cell in cells)
                    tentative[HexMath.Key(cell.Col, cell.Row)] = item.Kind;
                if (!ValidateConnectivity(state, tentative))
                    return "That Water/Wall would disconnect commanders/objectives.";
            }

            foreach (var cell in cells)
                state.Terrain[HexMath.Key(cell.Col, cell.Row)] = item.Kind;
            item.Placed = true;
            state.PendingCrHandIndex[seat] = -1;
            state.LastActionLog =
                $"{seat} placed {item.Name} (rot {rotation}) at ({anchor.Col},{anchor.Row}).";

            if (CommandZonePiecesComplete(hand, CommandZonePieceQuota.ForMaxPlayers(state.MaxPlayers)))
                FinishCommandZoneIfReady(state, seat);
            return null;
        }

        public static string SkipCrHeldPiece(GameState state, SeatId seat)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return "Not command-zone terrain.";
            if (IsSeatReady(state, seat)) return "Terrain already finished.";
            if (ModeFor(state, seat) != "pieces")
                return "Not in piece placement mode.";
            var hand = HandFor(state, seat);
            var heldIndex = hand.FindIndex(q => q != null && !q.Placed && !q.Skipped && !q.Flooded);
            if (heldIndex < 0) return "Pick a piece first, then skip it.";
            var held = hand[heldIndex];
            hand[heldIndex] = new TerrainQueueItem
            {
                InstanceId = $"{seat}-skip-{heldIndex}",
                PieceId = "__skip__",
                Name = "Skipped",
                Kind = TerrainKind.Plains,
                SizeClass = held.SizeClass,
                Skipped = true,
            };
            state.PendingCrHandIndex[seat] = -1;
            state.LastActionLog = $"{seat} skipped {held.SizeClass} piece ({held.Name}).";
            if (CommandZonePiecesComplete(hand, CommandZonePieceQuota.ForMaxPlayers(state.MaxPlayers)))
                FinishCommandZoneIfReady(state, seat);
            return null;
        }

        public static bool IsCommandZoneComplete(GameState state, SeatId seat)
        {
            var mode = ModeFor(state, seat);
            var hand = HandFor(state, seat);
            if (mode == "flood")
                return hand.Exists(q => q != null && q.Flooded) ||
                       (state.CommandZoneFlooded.TryGetValue(seat, out var f) && f);
            if (mode == "pieces")
                return CommandZonePiecesComplete(
                    hand, CommandZonePieceQuota.ForMaxPlayers(state.MaxPlayers));
            return false;
        }

        /// <summary>Command-zone confirm. When both ready → landLarge.</summary>
        public static bool ConfirmCommandZone(GameState state, SeatId seat)
        {
            if (state.Phase != Phase.Terrain || state.TerrainStage != "commandZone")
                return false;
            if (!IsCommandZoneComplete(state, seat))
            {
                state.LastActionLog = "Finish your CR terrain first.";
                return false;
            }
            var hand = HandFor(state, seat);
            if (hand.Exists(q => q != null && !q.Placed && !q.Skipped && !q.Flooded))
            {
                state.LastActionLog = "Place or skip your held piece first.";
                return false;
            }

            state.TerrainReady[seat] = true;
            state.LastActionLog = $"{seat} confirmed command-zone terrain.";

            foreach (var s in new[] { SeatId.N, SeatId.S })
            {
                if (!IsSeatReady(state, s))
                    return true;
            }

            BeginLandStage(state, "landLarge");
            return true;
        }

        static void FinishCommandZoneIfReady(GameState state, SeatId seat)
        {
            if (!IsCommandZoneComplete(state, seat)) return;
            state.TerrainReady[seat] = true;
            state.LastActionLog = $"{seat} finished command-zone terrain.";
            foreach (var s in new[] { SeatId.N, SeatId.S })
            {
                if (!IsSeatReady(state, s))
                    return;
            }
            BeginLandStage(state, "landLarge");
        }

        public static void BeginLandStage(GameState state, string stage)
        {
            state.TerrainStage = stage;
            state.TerrainTurnOrder = new List<SeatId> { SeatId.N, SeatId.S };
            state.LandDropsUsed[SeatId.N] = 0;
            state.LandDropsUsed[SeatId.S] = 0;
            state.ActiveSeat = SeatId.N;
            state.PendingLandPieceId = null;
            state.PendingLandRotation = 0;
            var size = SizeForStage(stage);
            var step = stage == "landLarge" ? "2/4" : stage == "landMedium" ? "3/4" : "4/4";
            state.LastActionLog =
                $"Terrain {step} — {size} land: each places or skips {TerrainPieceCatalog.LandDropsPerSize}. Starting: N.";
        }

        public static HashSet<string> ForeignCommandRadiusKeys(GameState state, SeatId placer)
        {
            var blocked = new HashSet<string>();
            if (state?.Commanders == null) return blocked;
            foreach (var kv in state.Commanders)
            {
                if (kv.Key == placer) continue;
                var radius = state.CommanderRadii.TryGetValue(kv.Key, out var r)
                    ? r
                    : GameConstants.DefaultCommanderCommandRadius;
                foreach (var key in TerrainPlacement.OwnCommandRadiusKeys(kv.Value, radius, state.BoardSize))
                    blocked.Add(key);
            }
            return blocked;
        }

        public static string PlaceLandPiece(GameState state, SeatId seat, HexCoord anchor)
        {
            if (state.Phase != Phase.Terrain || !IsLandStage(state.TerrainStage))
                return "Not a land placement stage.";
            if (state.ActiveSeat != seat)
                return state.ActiveSeat.HasValue
                    ? $"Wait — {state.ActiveSeat} places this piece."
                    : "Not your turn to place terrain.";
            var used = state.LandDropsUsed.TryGetValue(seat, out var n) ? n : 0;
            if (used >= TerrainPieceCatalog.LandDropsPerSize)
                return "No land drops left this tier.";
            if (string.IsNullOrEmpty(state.PendingLandPieceId))
                return "Choose a land piece first.";

            var size = SizeForStage(state.TerrainStage);
            var def = TerrainPieceCatalog.Get(state.PendingLandPieceId);
            if (def == null || !string.Equals(def.sizeClass, size, System.StringComparison.OrdinalIgnoreCase))
                return $"That piece is not a {size} land option.";

            var rotation = TerrainPlacement.NormalizeRotation(state.PendingLandRotation);
            var cells = TerrainPlacement.ExpandTerrainPiece(anchor, def.ShapeOffsets(), rotation);
            var kind = def.KindEnum;
            var isSmallBridge = def.IsSmall && kind != TerrainKind.Water && kind != TerrainKind.Wall;
            var err = TerrainPlacement.ValidateTerrainPlacement(
                cells,
                state.BoardSize,
                state.Terrain,
                ObjectiveKeys(state),
                kind,
                requiredKeys: null,
                blockedKeys: ForeignCommandRadiusKeys(state, seat),
                allowOverwriteWater: isSmallBridge);
            if (err != null) return err;

            if (kind is TerrainKind.Water or TerrainKind.Wall)
            {
                var tentative = new Dictionary<string, TerrainKind>(state.Terrain);
                foreach (var cell in cells)
                    tentative[HexMath.Key(cell.Col, cell.Row)] = kind;
                if (!ValidateConnectivity(state, tentative))
                    return "That Water/Wall would disconnect commanders/objectives.";
            }

            foreach (var cell in cells)
                state.Terrain[HexMath.Key(cell.Col, cell.Row)] = kind;

            state.LastActionLog =
                $"{seat} placed {size} {def.name} (rot {rotation}) at ({anchor.Col},{anchor.Row}).";
            state.PendingLandPieceId = null;
            AdvanceAfterLandDrop(state, seat);
            return null;
        }

        public static string SkipLandDrop(GameState state, SeatId seat)
        {
            if (state.Phase != Phase.Terrain || !IsLandStage(state.TerrainStage))
                return "Not a land placement stage.";
            if (state.ActiveSeat != seat)
                return state.ActiveSeat.HasValue
                    ? $"Wait — {state.ActiveSeat}'s turn."
                    : "Not your turn.";
            var used = state.LandDropsUsed.TryGetValue(seat, out var n) ? n : 0;
            if (used >= TerrainPieceCatalog.LandDropsPerSize)
                return "No land drops left this tier.";

            var size = SizeForStage(state.TerrainStage);
            state.LastActionLog = $"{seat} skipped a {size} land drop.";
            AdvanceAfterLandDrop(state, seat);
            return null;
        }

        public static void AdvanceAfterLandDrop(GameState state, SeatId seat)
        {
            var used = (state.LandDropsUsed.TryGetValue(seat, out var n) ? n : 0) + 1;
            state.LandDropsUsed[seat] = used;

            var allDone = true;
            foreach (var s in state.TerrainTurnOrder)
            {
                var u = state.LandDropsUsed.TryGetValue(s, out var c) ? c : 0;
                if (u < TerrainPieceCatalog.LandDropsPerSize)
                {
                    allDone = false;
                    break;
                }
            }

            if (!allDone)
            {
                state.ActiveSeat = NextSeat(state.TerrainTurnOrder, seat);
                state.LastActionLog += $" · {state.ActiveSeat}'s land drop.";
                return;
            }

            if (state.TerrainStage == "landLarge")
            {
                BeginLandStage(state, "landMedium");
                return;
            }
            if (state.TerrainStage == "landMedium")
            {
                BeginLandStage(state, "landSmall");
                return;
            }

            state.ActiveSeat = null;
            state.LastActionLog = "All battlefield land drops finished — deploying armies.";
            AdvanceToDeploy(state);
        }

        public static bool AdvanceToDeploy(GameState state)
        {
            TerrainPlacement.FillEmptyHexesWithPlains(state.Terrain, state.BoardSize);
            GameSessionFactory.BeginDeployFromLoadouts(state, autoPlace: false);
            state.PendingLandPieceId = null;
            return true;
        }

        static bool CommandZoneHasProgress(List<TerrainQueueItem> hand)
        {
            foreach (var q in hand)
                if (q != null && (q.Placed || q.Skipped || q.Flooded)) return true;
            return false;
        }

        static int CommandZoneSizeUsed(List<TerrainQueueItem> hand, string size)
        {
            var n = 0;
            foreach (var q in hand)
            {
                if (q == null || !string.Equals(q.SizeClass, size, System.StringComparison.OrdinalIgnoreCase))
                    continue;
                if (q.Placed || q.Skipped || (!q.Placed && !q.Skipped && !q.Flooded))
                    n++;
            }
            return n;
        }

        static bool CommandZonePiecesComplete(List<TerrainQueueItem> hand, CommandZonePieceQuota quota)
        {
            foreach (var q in hand)
                if (q != null && !q.Placed && !q.Skipped && !q.Flooded)
                    return false;
            foreach (var size in new[] { "large", "medium", "small" })
            {
                var used = 0;
                foreach (var q in hand)
                {
                    if (q == null) continue;
                    if (!string.Equals(q.SizeClass, size, System.StringComparison.OrdinalIgnoreCase)) continue;
                    if (q.Placed || q.Skipped) used++;
                }
                if (used < quota[size]) return false;
            }
            return true;
        }

        static TerrainQueueItem MakeHandItem(TerrainPieceDef def, SeatId seat, int index)
        {
            var shape = new List<TerrainPlacement.AxialOffset>();
            foreach (var o in def.ShapeOffsets())
                shape.Add(o);
            return new TerrainQueueItem
            {
                InstanceId = $"{seat}-{def.id}-{index}",
                PieceId = def.id,
                Name = def.name,
                Kind = def.KindEnum,
                SizeClass = def.sizeClass,
                Shape = shape,
            };
        }

        static SeatId? NextSeat(List<SeatId> order, SeatId current)
        {
            if (order == null || order.Count == 0) return null;
            var idx = order.IndexOf(current);
            if (idx < 0) return order[0];
            return order[(idx + 1) % order.Count];
        }

        static bool ValidateConnectivity(GameState state, Dictionary<string, TerrainKind> terrain)
        {
            var commanders = new List<HexCoord>();
            if (state.Commanders != null)
                foreach (var kv in state.Commanders)
                    commanders.Add(kv.Value);
            var objectives = new List<HexCoord>();
            if (state.Objectives != null)
                foreach (var obj in state.Objectives)
                    if (obj?.Hexes != null)
                        objectives.AddRange(obj.Hexes);
            return TerrainConnectivity.SetupStayConnected(commanders, objectives, terrain, state.BoardSize);
        }

        static HashSet<string> ObjectiveKeys(GameState state)
        {
            var keys = new HashSet<string>();
            if (state?.Objectives == null) return keys;
            foreach (var obj in state.Objectives)
            {
                if (obj?.Hexes == null) continue;
                foreach (var h in obj.Hexes)
                    keys.Add(HexMath.Key(h.Col, h.Row));
            }
            return keys;
        }
    }
}
