using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Procedural pointy-top hex prism mesh (XZ plane, Y-up).</summary>
    public static class HexMeshBuilder
    {
        // Overlap so same-biome tops fuse; no rounded silhouettes.
        const float RadiusScale = 1.035f;

        /// <summary>Local-UV prism (highlights / utilities).</summary>
        public static Mesh CreatePrism(float radius, float height) =>
            CreatePrism(radius, height, Vector2.zero, 0f, flattenTopNormals: true);

        /// <summary>
        /// Prism with planar world XZ UVs so albedo flows continuously across tiles
        /// (no per-hex centered stamp / repeating dark spots).
        /// </summary>
        public static Mesh CreatePrism(
            float radius,
            float height,
            Vector2 worldXZ,
            float uvScale,
            bool flattenTopNormals = true)
        {
            var r = radius * RadiusScale;
            var verts = new List<Vector3>(14);
            var tris = new List<int>(48);
            var uvs = new List<Vector2>(14);

            Vector2 Uv(float localX, float localZ) =>
                uvScale <= 0.0001f
                    ? new Vector2(0.5f + localX / (r * 2f), 0.5f + localZ / (r * 2f))
                    : new Vector2((worldXZ.x + localX) * uvScale, (worldXZ.y + localZ) * uvScale);

            // Top center
            verts.Add(new Vector3(0f, height, 0f));
            uvs.Add(Uv(0f, 0f));

            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                var x = r * Mathf.Cos(angle);
                var z = r * Mathf.Sin(angle);
                verts.Add(new Vector3(x, height, z));
                uvs.Add(Uv(x, z));
            }

            for (var i = 0; i < 6; i++)
            {
                tris.Add(0);
                tris.Add(1 + ((i + 1) % 6));
                tris.Add(1 + i);
            }

            var bottomStart = verts.Count;
            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                var x = r * Mathf.Cos(angle);
                var z = r * Mathf.Sin(angle);
                verts.Add(new Vector3(x, 0f, z));
                uvs.Add(Uv(x, z));
            }

            for (var i = 0; i < 6; i++)
            {
                var t0 = 1 + i;
                var t1 = 1 + ((i + 1) % 6);
                var b0 = bottomStart + i;
                var b1 = bottomStart + ((i + 1) % 6);
                tris.Add(t0); tris.Add(b0); tris.Add(b1);
                tris.Add(t0); tris.Add(b1); tris.Add(t1);
            }

            var mesh = new Mesh { name = "HexPrism" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            if (flattenTopNormals)
            {
                // Even lighting across the top so adjacent same-biome tiles don't shade differently.
                var normals = mesh.normals;
                for (var i = 0; i < 7; i++)
                    normals[i] = Vector3.up;
                mesh.normals = normals;
            }

            return mesh;
        }

        public static Mesh CreateOutlineRing(float radius, float y, float thickness = 0.04f)
        {
            var rOuter = radius * RadiusScale;
            var rInner = Mathf.Max(0.05f, rOuter - thickness);
            var verts = new List<Vector3>();
            var tris = new List<int>();
            var uvs = new List<Vector2>();

            for (var i = 0; i < 6; i++)
            {
                var angle = Mathf.Deg2Rad * (60f * i - 30f);
                var c = Mathf.Cos(angle);
                var s = Mathf.Sin(angle);
                verts.Add(new Vector3(rOuter * c, y, rOuter * s));
                verts.Add(new Vector3(rInner * c, y, rInner * s));
                uvs.Add(new Vector2(i / 6f, 1f));
                uvs.Add(new Vector2(i / 6f, 0f));
            }

            for (var i = 0; i < 6; i++)
            {
                var i0 = i * 2;
                var i1 = i * 2 + 1;
                var j0 = ((i + 1) % 6) * 2;
                var j1 = ((i + 1) % 6) * 2 + 1;
                tris.Add(i0); tris.Add(j0); tris.Add(i1);
                tris.Add(i1); tris.Add(j0); tris.Add(j1);
            }

            var mesh = new Mesh { name = "HexOutline" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
