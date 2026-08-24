using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Water look without circular overlays — only the hex prism material (glassy/recessed).
    /// Shore foam stays on water↔land edges via HexTerrainAutotile.
    /// </summary>
    public static class WaterSurfaceDress
    {
        public static void Apply(HexTile tile, float hexSize)
        {
            if (tile == null || tile.Terrain != TerrainKind.Water) return;

            // Remove any older circular ripple/sheen discs from prior builds.
            ClearPrior(tile.transform);

            // No disc overlays — circles came from smaller sheen/depth fans on every water hex.
            // The hex body already uses CreateWaterMaterial (translucent + glossy) and a lower height.
        }

        static void ClearPrior(Transform tile)
        {
            var existing = tile.Find("WaterSurface");
            if (existing == null) return;
            if (Application.isPlaying) Object.Destroy(existing.gameObject);
            else Object.DestroyImmediate(existing.gameObject);
        }
    }
}
