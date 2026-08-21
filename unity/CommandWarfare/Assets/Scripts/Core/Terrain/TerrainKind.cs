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
        /// <summary>Block height above ground — matches TERRAIN_BLOCK_HEIGHT in hexTerrainMesh.ts.</summary>
        public static float BlockHeight(TerrainKind kind) => kind switch
        {
            TerrainKind.Plains => 0.72f,
            TerrainKind.Forest => 0.88f,
            TerrainKind.Swamp => 0.58f,
            TerrainKind.Desert => 0.68f,
            TerrainKind.Water => 0.38f,
            TerrainKind.Wall => 2.1f,
            TerrainKind.Volcanic => 0.92f,
            TerrainKind.Mountains => 1.85f,
            _ => 0.72f,
        };

        public static UnityEngine.Color BaseColor(TerrainKind kind, int variant) => kind switch
        {
            TerrainKind.Plains => Variant(new[] { "#9cb058", "#a8bc60", "#90a850", "#b4c868", "#88a048" }, variant),
            TerrainKind.Forest => Variant(new[] { "#488858", "#529060", "#408050", "#5a9868", "#38784c" }, variant),
            TerrainKind.Swamp => Variant(new[] { "#2a4838", "#1e3828", "#243c30", "#324840", "#182e22" }, variant),
            TerrainKind.Desert => Variant(new[] { "#e8b868", "#f0c070", "#e0b060", "#f8c878", "#d8a858" }, variant),
            TerrainKind.Water => Variant(new[] { "#4898d8", "#50a0e0", "#4090d0", "#58a8e8", "#3888c8" }, variant),
            TerrainKind.Wall => Variant(new[] { "#989ca8", "#a0a4b0", "#909498", "#a8acb8", "#888c98" }, variant),
            TerrainKind.Volcanic => Variant(new[] { "#685850", "#706058", "#605048", "#786860", "#584840" }, variant),
            TerrainKind.Mountains => Variant(new[] { "#6a6870", "#747278", "#605e68", "#7a7880", "#58565e" }, variant),
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
