using System.Collections.Generic;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Procedural pointy-top hex prism mesh (XZ plane, Y-up).</summary>
    public static class HexMeshBuilder
    {
        const float RadiusScale = 1.001f;

        public static Mesh CreatePrism(float radius, float height)
        {
            var r = radius * RadiusScale;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            var uvs = new List<Vector2>();

            // Top cap center
            var topCenter = verts.Count;
            verts.Add(new Vector3(0f, height, 0f));
            uvs.Add(new Vector2(0.5f, 0.5f));

            // Top ring
            var topRingStart = verts.Count;
            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                verts.Add(new Vector3(r * Mathf.Cos(angle), height, r * Mathf.Sin(angle)));
                uvs.Add(new Vector2(0.5f + 0.45f * Mathf.Cos(angle), 0.5f + 0.45f * Mathf.Sin(angle)));
            }

            for (var i = 0; i < 6; i++)
            {
                var a = topRingStart + i;
                var b = topRingStart + (i + 1) % 6;
                tris.Add(topCenter);
                tris.Add(b);
                tris.Add(a);
            }

            // Bottom ring + sides
            var bottomRingStart = verts.Count;
            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                verts.Add(new Vector3(r * Mathf.Cos(angle), 0f, r * Mathf.Sin(angle)));
                uvs.Add(new Vector2((float)i / 6f, 0f));
            }

            for (var i = 0; i < 6; i++)
            {
                var t0 = topRingStart + i;
                var t1 = topRingStart + (i + 1) % 6;
                var b0 = bottomRingStart + i;
                var b1 = bottomRingStart + (i + 1) % 6;
                tris.Add(t0); tris.Add(b0); tris.Add(b1);
                tris.Add(t0); tris.Add(b1); tris.Add(t1);
            }

            var mesh = new Mesh { name = "HexPrism" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
