using UnityEngine;

namespace CommandWarfare.Core.Util
{
    /// <summary>Random room codes for offline skirmish (same alphabet as play/server/index.ts).</summary>
    public static class RoomSeedGenerator
    {
        const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        public static string Generate()
        {
            var chars = new char[6];
            for (var i = 0; i < chars.Length; i++)
                chars[i] = Alphabet[Random.Range(0, Alphabet.Length)];
            return new string(chars);
        }
    }
}
