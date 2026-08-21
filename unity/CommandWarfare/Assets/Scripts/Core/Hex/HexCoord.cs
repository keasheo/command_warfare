using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Core.Hex
{
    /// <summary>Odd-r offset hex coordinate (matches play/shared/hex.ts).</summary>
    [Serializable]
    public struct HexCoord : IEquatable<HexCoord>
    {
        public int Col;
        public int Row;

        public HexCoord(int col, int row)
        {
            Col = col;
            Row = row;
        }

        public bool Equals(HexCoord other) => Col == other.Col && Row == other.Row;
        public override bool Equals(object obj) => obj is HexCoord other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(Col, Row);
        public override string ToString() => $"{Col},{Row}";

        public static bool operator ==(HexCoord a, HexCoord b) => a.Equals(b);
        public static bool operator !=(HexCoord a, HexCoord b) => !a.Equals(b);
    }

    public struct AxialCoord
    {
        public int Q;
        public int R;

        public AxialCoord(int q, int r)
        {
            Q = q;
            R = r;
        }
    }

    public static class HexMath
    {
        private static readonly AxialCoord[] AxialDirs =
        {
            new(1, 0), new(1, -1), new(0, -1),
            new(-1, 0), new(-1, 1), new(0, 1),
        };

        public static AxialCoord OddRToAxial(int col, int row) =>
            new(col - (row - (row & 1)) / 2, row);

        public static HexCoord AxialToOddR(int q, int r) =>
            new(q + (r - (r & 1)) / 2, r);

        public static AxialCoord RotateAxial(int q, int r, int steps)
        {
            var x = q;
            var z = r;
            var y = -x - z;
            var n = ((steps % 6) + 6) % 6;
            for (var i = 0; i < n; i++)
            {
                var nx = -z;
                var ny = -x;
                var nz = -y;
                x = nx;
                y = ny;
                z = nz;
            }
            return new AxialCoord(x, z);
        }

        public static AxialCoord ReflectAxial(int q, int r) => new(q, -r - q);

        public static int Distance(HexCoord a, HexCoord b)
        {
            var aa = OddRToAxial(a.Col, a.Row);
            var bb = OddRToAxial(b.Col, b.Row);
            var dq = aa.Q - bb.Q;
            var dr = aa.R - bb.R;
            return (Math.Abs(dq) + Math.Abs(dq + dr) + Math.Abs(dr)) / 2;
        }

        public static string Key(int col, int row) => $"{col},{row}";

        public static HexCoord ParseKey(string key)
        {
            var parts = key.Split(',');
            return new HexCoord(int.Parse(parts[0]), int.Parse(parts[1]));
        }

        /// <summary>Pointy-top XZ world position (Y-up). Matches oddRToWorld3D in hexTerrainMesh.ts.</summary>
        public static Vector3 OddRToWorld(int col, int row, float hexSize)
        {
            var p = OddRToPixel(col, row, hexSize);
            return new Vector3(p.x, 0f, p.y);
        }

        /// <summary>2D layout helpers — x horizontal, y vertical (maps to world X/Z).</summary>
        public static Vector2 OddRToPixel(int col, int row, float hexSize)
        {
            return new Vector2(
                hexSize * Mathf.Sqrt(3f) * (col + 0.5f * (row & 1)),
                hexSize * 1.5f * row);
        }

        public static IEnumerable<HexCoord> Neighbors(HexCoord cell)
        {
            var a = OddRToAxial(cell.Col, cell.Row);
            foreach (var d in AxialDirs)
                yield return AxialToOddR(a.Q + d.Q, a.R + d.R);
        }

        public static HexCoord? HexBehind(HexCoord origin, HexCoord target)
        {
            var a = OddRToAxial(origin.Col, origin.Row);
            var t = OddRToAxial(target.Col, target.Row);
            var vq = t.Q - a.Q;
            var vr = t.R - a.R;
            if (vq == 0 && vr == 0) return null;

            HexCoord? best = null;
            var bestDot = float.NegativeInfinity;
            foreach (var n in Neighbors(target))
            {
                if (Distance(origin, n) <= Distance(origin, target)) continue;
                var nn = OddRToAxial(n.Col, n.Row);
                var dot = (nn.Q - t.Q) * vq + (nn.R - t.R) * vr;
                if (dot > bestDot)
                {
                    bestDot = dot;
                    best = n;
                }
            }
            return best;
        }

        public static bool InBounds(HexCoord cell, int boardSize) =>
            cell.Col >= 0 && cell.Row >= 0 && cell.Col < boardSize && cell.Row < boardSize;
    }
}
