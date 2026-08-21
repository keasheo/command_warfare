using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Net
{
    /// <summary>Picks the next lobby/setup WebSocket action from server state JSON.</summary>
    public static class PlaySetupAutomator
    {
        static readonly Dictionary<string, string> RaceFavoredTerrain = new()
        {
            { "Human", "plains" },
            { "Dwarf", "mountains" },
            { "Elf", "forest" },
            { "Undead", "swamp" },
            { "Demon", "volcanic" },
            { "Dragon", "volcanic" },
            { "Beastfolk", "forest" },
            { "Lizardmen", "swamp" },
            { "Construct", "plains" },
        };

        public struct SetupStep
        {
            public string ActionJson;
            public string Label;
        }

        public static bool TryGetNextStep(
            string rawJson,
            SeatId localSeat,
            Phase phase,
            GameState localState,
            QuickPickArmyLoader.PresetDto preset,
            out SetupStep step)
        {
            step = default;
            if (string.IsNullOrEmpty(rawJson)) return false;

            PlayJson.ParsePlayerFlags(rawJson, localSeat, out var flags);

            if ((phase == Phase.Lobby || phase == Phase.ArmyBuild) && !flags.ArmyReady)
            {
                if (preset == null || string.IsNullOrEmpty(preset.submitArmyJson)) return false;
                step = new SetupStep
                {
                    ActionJson = preset.submitArmyJson,
                    Label = "Submit quick-pick army",
                };
                return true;
            }

            if (phase == Phase.ForceSelect && !flags.ForceSelectReady)
            {
                if (preset == null || string.IsNullOrEmpty(preset.confirmForceSelectJson)) return false;
                step = new SetupStep
                {
                    ActionJson = preset.confirmForceSelectJson,
                    Label = "Confirm force (default loadout)",
                };
                return true;
            }

            if (phase is Phase.Lobby or Phase.ArmyBuild or Phase.Commanders or Phase.Objectives or Phase.ForceSelect)
            {
                step = new SetupStep
                {
                    ActionJson = PlayJson.BuildForceStart(),
                    Label = "Force start",
                };
                return true;
            }

            if (phase == Phase.Terrain && !PlayJson.ParseRandomMap(rawJson))
            {
                var stage = PlayJson.ParseTerrainStage(rawJson) ?? "commandZone";
                if (stage == "commandZone" && !flags.TerrainReady)
                {
                    if (!PlayJson.HasCommandZoneMode(rawJson, localSeat))
                    {
                        step = new SetupStep
                        {
                            ActionJson = PlayJson.BuildChooseCommandZoneMode("flood"),
                            Label = "Choose flood CR mode",
                        };
                        return true;
                    }

                    if (!PlayJson.HasFloodedCommandZone(rawJson, localSeat))
                    {
                        var race = PlayJson.ParseArmyRace(rawJson, localSeat) ?? "Human";
                        var kind = FavoredFloodKind(race);
                        step = new SetupStep
                        {
                            ActionJson = PlayJson.BuildFloodCommandZone(kind),
                            Label = $"Flood CR ({kind})",
                        };
                        return true;
                    }

                    step = new SetupStep
                    {
                        ActionJson = PlayJson.BuildConfirmTerrain(),
                        Label = "Confirm terrain",
                    };
                    return true;
                }

                var active = localState?.ActiveSeat;
                if (active.HasValue && active.Value == localSeat && stage != "commandZone")
                {
                    step = new SetupStep
                    {
                        ActionJson = PlayJson.BuildSkipTerrain(),
                        Label = "Skip land terrain",
                    };
                    return true;
                }
                return false;
            }

            if (phase == Phase.Deploy && !flags.DeployDone)
            {
                var queueDto = PlayJson.ParseDeployQueue(rawJson, localSeat);
                if (queueDto.Count == 0) return false;

                var catalogDto = PlayJson.ParseCardCatalog(rawJson);
                var catalog = new Dictionary<string, DeployPlacement.CardSnap>();
                foreach (var kv in catalogDto)
                {
                    catalog[kv.Key] = new DeployPlacement.CardSnap
                    {
                        PrimaryType = kv.Value.PrimaryType,
                        Keywords = kv.Value.Keywords,
                        CommandRadius = kv.Value.CommandRadius,
                    };
                }

                var queue = new List<DeployPlacement.QueueItem>();
                foreach (var q in queueDto)
                {
                    queue.Add(new DeployPlacement.QueueItem
                    {
                        Kind = q.Kind,
                        CardId = q.CardId,
                        OfficerCardId = q.OfficerCardId,
                        Placed = q.Placed,
                    });
                }

                var occupied = new HashSet<string>();
                if (localState?.Units != null)
                {
                    foreach (var u in localState.Units)
                        occupied.Add(Core.Hex.HexMath.Key(u.Col, u.Row));
                }

                var boardSize = localState?.BoardSize ?? PlayJson.ParseIntField(rawJson, "boardSize", GameConstants.BoardSize2P);

                for (var i = 0; i < queue.Count; i++)
                {
                    if (queue[i].Placed) continue;
                    var spot = DeployPlacement.FindDeploySpot(
                        localSeat,
                        boardSize,
                        queue,
                        i,
                        localState?.Units ?? new List<UnitToken>(),
                        occupied,
                        catalog);
                    if (!spot.HasValue) continue;

                    step = new SetupStep
                    {
                        ActionJson = PlayJson.BuildDeploy(i, spot.Value.col, spot.Value.row),
                        Label = $"Deploy {queue[i].Kind} #{i}",
                    };
                    return true;
                }

                if (!HasUnplaced(queue))
                {
                    step = new SetupStep
                    {
                        ActionJson = PlayJson.BuildConfirmDeploy(),
                        Label = "Confirm deploy",
                    };
                    return true;
                }
            }

            return false;
        }

        static bool HasUnplaced(List<DeployPlacement.QueueItem> queue)
        {
            foreach (var q in queue)
            {
                if (!q.Placed) return true;
            }
            return false;
        }

        static string FavoredFloodKind(string race)
        {
            if (!string.IsNullOrEmpty(race) &&
                RaceFavoredTerrain.TryGetValue(race, out var favored) &&
                IsFloodKind(favored))
                return favored;
            return "plains";
        }

        static bool IsFloodKind(string kind) =>
            kind is "plains" or "forest" or "swamp" or "desert" or "volcanic" or "mountains";
    }
}
