using System;
using System.Collections.Generic;

namespace CommandWarfare.Core.Util
{
    /// <summary>Port of mulberry32 from play/shared/randomMap.ts.</summary>
    public sealed class SeededRng
    {
        uint _state;

        public SeededRng(uint seed) => _state = seed;

        public static uint SeedFromRoomCode(string roomCode, string salt = "biome")
        {
            var s = $"{roomCode}|{salt}";
            uint h = 2166136261;
            foreach (var c in s)
            {
                h ^= c;
                h *= 16777619;
            }
            return h;
        }

        public float NextFloat()
        {
            unchecked
            {
                _state += 0x6d2b79f5;
                var t = _state;
                var r = (t ^ (t >> 15)) * (1u | t);
                r ^= r + ((r ^ (r >> 7)) * (61u | r));
                return (r ^ (r >> 14)) / 4294967296f;
            }
        }

        public int NextInt(int maxExclusive) => (int)(NextFloat() * maxExclusive);

        public void Shuffle<T>(IList<T> list)
        {
            for (var i = list.Count - 1; i > 0; i--)
            {
                var j = NextInt(i + 1);
                (list[i], list[j]) = (list[j], list[i]);
            }
        }
    }
}
