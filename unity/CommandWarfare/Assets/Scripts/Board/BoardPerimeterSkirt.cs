using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Wooden tray frame around the hex map so jagged hex sides / void never show.
    /// Hexes sit inside; from outside you only see textured wood walls + lip.
    /// </summary>
    public static class BoardPerimeterSkirt
    {
        const float RadiusScale = 1.04f;
        const float Margin = 0.45f;
        const float WallThick = 0.38f;
        const float YBottom = -0.35f;
        const float FloorY = 0.02f;

        public static void Build(Transform parent, int boardSize, float hexSize)
        {
            if (parent == null || boardSize < 1) return;
            ClearPrior(parent);

            var root = new GameObject("BoardPerimeter").transform;
            root.SetParent(parent, false);
            root.gameObject.hideFlags = HideFlags.DontSave;

            ComputeBounds(boardSize, hexSize, out var minX, out var maxX, out var minZ, out var maxZ);

            var wood = WoodMat();
            var woodDark = WoodDarkMat();

            var wallTop = TerrainVisuals.StandardBlockHeight + 0.12f;
            var lipY = wallTop + 0.04f;

            // Inner cavity matches the hex footprint; outer is padded so walls hide zigzags.
            var innerMinX = minX;
            var innerMaxX = maxX;
            var innerMinZ = minZ;
            var innerMaxZ = maxZ;
            var outerMinX = minX - Margin;
            var outerMaxX = maxX + Margin;
            var outerMinZ = minZ - Margin;
            var outerMaxZ = maxZ + Margin;

            // Solid floor under the whole tray (kills void under notches).
            Box(root, "TrayFloor",
                new Vector3((outerMinX + outerMaxX) * 0.5f, (FloorY + YBottom) * 0.5f, (outerMinZ + outerMaxZ) * 0.5f),
                new Vector3(outerMaxX - outerMinX, FloorY - YBottom, outerMaxZ - outerMinZ),
                woodDark);

            // Raised plinth under hexes — covers most hex side faces from low angles.
            var plinthTop = TerrainVisuals.StandardBlockHeight - 0.04f;
            Box(root, "TrayPlinth",
                new Vector3((innerMinX + innerMaxX) * 0.5f, (plinthTop + FloorY) * 0.5f, (innerMinZ + innerMaxZ) * 0.5f),
                new Vector3(innerMaxX - innerMinX + 0.08f, plinthTop - FloorY, innerMaxZ - innerMinZ + 0.08f),
                wood);

            // Four outer walls — what you see instead of jagged hex edges.
            var midX = (outerMinX + outerMaxX) * 0.5f;
            var midZ = (outerMinZ + outerMaxZ) * 0.5f;
            var sizeX = outerMaxX - outerMinX;
            var sizeZ = outerMaxZ - outerMinZ;
            var wallCy = (wallTop + YBottom) * 0.5f;
            var wallH = wallTop - YBottom;

            Box(root, "WallN",
                new Vector3(midX, wallCy, outerMaxZ - WallThick * 0.5f),
                new Vector3(sizeX, wallH, WallThick), wood);
            Box(root, "WallS",
                new Vector3(midX, wallCy, outerMinZ + WallThick * 0.5f),
                new Vector3(sizeX, wallH, WallThick), wood);
            Box(root, "WallE",
                new Vector3(outerMaxX - WallThick * 0.5f, wallCy, midZ),
                new Vector3(WallThick, wallH, sizeZ - WallThick * 2f), wood);
            Box(root, "WallW",
                new Vector3(outerMinX + WallThick * 0.5f, wallCy, midZ),
                new Vector3(WallThick, wallH, sizeZ - WallThick * 2f), wood);

            // Top lip / border around the play surface.
            var lipH = 0.1f;
            var lipW = Margin + 0.05f;
            Box(root, "LipN",
                new Vector3(midX, lipY, outerMaxZ - lipW * 0.5f),
                new Vector3(sizeX, lipH, lipW), woodDark);
            Box(root, "LipS",
                new Vector3(midX, lipY, outerMinZ + lipW * 0.5f),
                new Vector3(sizeX, lipH, lipW), woodDark);
            Box(root, "LipE",
                new Vector3(outerMaxX - lipW * 0.5f, lipY, midZ),
                new Vector3(lipW, lipH, sizeZ - lipW * 2f), woodDark);
            Box(root, "LipW",
                new Vector3(outerMinX + lipW * 0.5f, lipY, midZ),
                new Vector3(lipW, lipH, sizeZ - lipW * 2f), woodDark);
        }

        static void ComputeBounds(
            int boardSize, float hexSize,
            out float minX, out float maxX, out float minZ, out float maxZ)
        {
            var r = hexSize * RadiusScale;
            minX = float.PositiveInfinity;
            maxX = float.NegativeInfinity;
            minZ = float.PositiveInfinity;
            maxZ = float.NegativeInfinity;

            for (var row = 0; row < boardSize; row++)
            {
                for (var col = 0; col < boardSize; col++)
                {
                    var c = HexMath.OddRToWorld(col, row, hexSize);
                    for (var i = 0; i < 6; i++)
                    {
                        var a = Mathf.Deg2Rad * (60f * i - 30f);
                        var x = c.x + r * Mathf.Cos(a);
                        var z = c.z + r * Mathf.Sin(a);
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (z < minZ) minZ = z;
                        if (z > maxZ) maxZ = z;
                    }
                }
            }
        }

        static Material WoodMat()
        {
#if UNITY_EDITOR
            var diff = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(
                "Assets/Art/Environment/PolyHavenInterior/_Textures/dark_wooden_planks_diff.jpg");
            if (diff != null)
                return TerrainMaterialFactory.CreateTileInstance(
                    new Color(0.85f, 0.75f, 0.6f), diff, 2.4f, 0.22f, 0.03f, Color.black);
#endif
            return TerrainMaterialFactory.CreateTileInstance(
                new Color(0.42f, 0.28f, 0.16f), null, 1f, 0.18f, 0.03f, Color.black);
        }

        static Material WoodDarkMat()
        {
#if UNITY_EDITOR
            var diff = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(
                "Assets/Art/Environment/PolyHavenInterior/_Textures/dark_wooden_planks_diff.jpg");
            if (diff != null)
                return TerrainMaterialFactory.CreateTileInstance(
                    new Color(0.55f, 0.42f, 0.3f), diff, 2.8f, 0.16f, 0.03f, Color.black);
#endif
            return TerrainMaterialFactory.CreateTileInstance(
                new Color(0.26f, 0.16f, 0.1f), null, 1f, 0.12f, 0.02f, Color.black);
        }

        static void Box(Transform parent, string name, Vector3 localPos, Vector3 localScale, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
        }

        static void ClearPrior(Transform parent)
        {
            var existing = parent.Find("BoardPerimeter");
            if (existing == null) return;
            if (Application.isPlaying) Object.Destroy(existing.gameObject);
            else Object.DestroyImmediate(existing.gameObject);
        }
    }
}
