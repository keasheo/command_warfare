using System;
using System.Collections.Generic;
using CommandWarfare.Core.Terrain;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of TerrainQueueItem from play/shared/types.ts / terrainPieces.ts.</summary>
    [Serializable]
    public class TerrainQueueItem
    {
        public string InstanceId;
        public string PieceId;
        public string Name;
        public TerrainKind Kind;
        public string SizeClass;
        public List<TerrainPlacement.AxialOffset> Shape = new();
        public bool Placed;
        public bool Skipped;
        public bool Flooded;
    }

    public struct CommandZonePieceQuota
    {
        public int Large;
        public int Medium;
        public int Small;

        public int this[string size] => size?.ToLowerInvariant() switch
        {
            "large" => Large,
            "medium" => Medium,
            "small" => Small,
            _ => 0,
        };

        public int Total => Large + Medium + Small;

        public static CommandZonePieceQuota ForMaxPlayers(int maxPlayers) =>
            maxPlayers <= 2
                ? new CommandZonePieceQuota { Large = 1, Medium = 2, Small = 2 }
                : new CommandZonePieceQuota { Large = 0, Medium = 1, Small = 2 };
    }
}
