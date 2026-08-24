namespace CommandWarfare.Core.Terrain
{
    public enum TerrainKind
    {
        Plains,
        Forest,
        Swamp,
        Desert,
        Water,
        Wall,
        Volcanic,
        Mountains,
    }

    public static class TerrainVisuals
    {
        /// <summary>Uniform base prism height — elevation variation lives in scatter props only.</summary>
        public const float StandardBlockHeight = 0.72f;
        public const float WaterBlockHeight = 0.48f;

        /// <summary>Block height above ground — matches TERRAIN_BLOCK_HEIGHT in hexTerrainMesh.ts.</summary>
        public static float BlockHeight(TerrainKind kind) => kind switch
        {
            TerrainKind.Wall => 2.1f,
            TerrainKind.Water => WaterBlockHeight,
            _ => StandardBlockHeight,
        };

        public static UnityEngine.Color BaseColor(TerrainKind kind, int variant) => kind switch
        {
            TerrainKind.Plains => Variant(new[] { "#9cb058", "#a8bc60", "#90a850", "#b4c868", "#88a048" }, variant),
            TerrainKind.Forest => Variant(new[] { "#488858", "#529060", "#408050", "#5a9868", "#38784c" }, variant),
            TerrainKind.Swamp => Variant(new[] { "#2a4838", "#1e3828", "#243c30", "#324840", "#182e22" }, variant),
            TerrainKind.Desert => Variant(new[] { "#e8b868", "#f0c070", "#e0b060", "#f8c878", "#d8a858" }, variant),
            // Deeper teal-blue pool color (alpha used when water mat is transparent).
            TerrainKind.Water => Variant(new[] { "#1e7aad", "#2486b8", "#18709e", "#2a92c4", "#156898" }, variant),
            TerrainKind.Wall => Variant(new[] { "#989ca8", "#a0a4b0", "#909498", "#a8acb8", "#888c98" }, variant),
            // Dark charcoal — crack glow comes from volcanic albedo, not a near-black slab.
            TerrainKind.Volcanic => Variant(new[] { "#2c2c30", "#343438", "#28282c", "#303034", "#2a2a2e" }, variant),
            // Light gray rock with soft green / light-brown mountain character.
            TerrainKind.Mountains => Variant(new[] { "#b0b4ac", "#b8b0a4", "#a8aca4", "#c0b8a8", "#aab0a6" }, variant),
            _ => UnityEngine.Color.gray,
        };

        static UnityEngine.Color Variant(string[] hexes, int variant)
        {
            if (!UnityEngine.ColorUtility.TryParseHtmlString(hexes[variant % hexes.Length], out var c))
                return UnityEngine.Color.gray;
            return c;
        }
    }
}
