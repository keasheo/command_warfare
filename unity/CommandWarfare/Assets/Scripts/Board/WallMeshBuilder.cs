using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Stone wall dressing so Wall hexes read as fortifications, not tall flat prisms.</summary>
    public static class WallMeshBuilder
    {
        public static void DressWallHex(Transform tile, float hexSize, float wallHeight, Color stoneColor)
        {
            ClearPrior(tile);

            var root = new GameObject("WallDressing").transform;
            root.SetParent(tile, false);

            var dark = Color.Lerp(stoneColor, Color.black, 0.35f);
            var light = Color.Lerp(stoneColor, Color.white, 0.2f);

            // Walkway rim
            Prim(PrimitiveType.Cylinder, "Walkway", root,
                new Vector3(0f, wallHeight + 0.04f, 0f),
                new Vector3(hexSize * 1.55f, 0.06f, hexSize * 1.55f),
                dark);

            // Curtain wall strips along each hex edge (reads as real walls from distance).
            for (var i = 0; i < 6; i++)
            {
                var a0 = Mathf.Deg2Rad * (60f * i - 30f);
                var a1 = Mathf.Deg2Rad * (60f * ((i + 1) % 6) - 30f);
                var p0 = new Vector3(Mathf.Cos(a0) * hexSize * 0.92f, 0f, Mathf.Sin(a0) * hexSize * 0.92f);
                var p1 = new Vector3(Mathf.Cos(a1) * hexSize * 0.92f, 0f, Mathf.Sin(a1) * hexSize * 0.92f);
                var mid = (p0 + p1) * 0.5f;
                mid.y = wallHeight * 0.42f;
                var edge = p1 - p0;
                var len = edge.magnitude;
                var yaw = Mathf.Atan2(edge.x, edge.z) * Mathf.Rad2Deg;
                var strip = Prim(PrimitiveType.Cube, $"Curtain_{i}", root,
                    mid,
                    new Vector3(0.22f, wallHeight * 0.78f, len * 0.98f),
                    stoneColor);
                strip.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            }

            // Merlons (battlements) on six corners
            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                var x = Mathf.Cos(angle) * hexSize * 0.78f;
                var z = Mathf.Sin(angle) * hexSize * 0.78f;
                Prim(PrimitiveType.Cube, $"Merlon_{i}", root,
                    new Vector3(x, wallHeight + 0.28f, z),
                    new Vector3(0.28f, 0.42f, 0.22f),
                    light);
            }

            // Mid-height buttress pillars
            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i);
                var x = Mathf.Cos(angle) * hexSize * 0.92f;
                var z = Mathf.Sin(angle) * hexSize * 0.92f;
                Prim(PrimitiveType.Cube, $"Buttress_{i}", root,
                    new Vector3(x, wallHeight * 0.45f, z),
                    new Vector3(0.22f, wallHeight * 0.85f, 0.22f),
                    dark);
            }

            // Gate arch cue on +Z face
            Prim(PrimitiveType.Cube, "ArchLintel", root,
                new Vector3(0f, wallHeight * 0.55f, hexSize * 0.95f),
                new Vector3(0.55f, 0.18f, 0.12f),
                light);
        }

        static void ClearPrior(Transform tile)
        {
            var existing = tile.Find("WallDressing");
            if (existing == null) return;
            if (Application.isPlaying) Object.Destroy(existing.gameObject);
            else Object.DestroyImmediate(existing.gameObject);
        }

        static GameObject Prim(
            PrimitiveType type,
            string name,
            Transform parent,
            Vector3 localPos,
            Vector3 localScale,
            Color color)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            var col = go.GetComponent<Collider>();
            if (col != null)
            {
                if (Application.isPlaying) Object.Destroy(col);
                else Object.DestroyImmediate(col);
            }
            var r = go.GetComponent<Renderer>();
            if (r != null)
            {
                r.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(color, null, 1f, 0.25f, 0.05f, Color.black);
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            return go;
        }
    }
}
