using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Lazy-loads card art PNGs keyed by cardId (data/art → Assets/Art/Cards).</summary>
    public static class CardArtLibrary
    {
        static readonly Dictionary<string, Texture2D> Cache = new();
        static string[] _searchRoots;

        public static Texture2D Get(string cardId)
        {
            if (string.IsNullOrEmpty(cardId)) return null;
            if (Cache.TryGetValue(cardId, out var tex) && tex != null) return tex;

            foreach (var root in GetRoots())
            {
                var path = Path.Combine(root, cardId + ".png");
                if (!File.Exists(path)) continue;
                try
                {
                    var bytes = File.ReadAllBytes(path);
                    tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                    if (!tex.LoadImage(bytes))
                    {
                        UnityEngine.Object.Destroy(tex);
                        continue;
                    }
                    tex.name = "CardArt_" + cardId;
                    tex.hideFlags = HideFlags.HideAndDontSave;
                    Cache[cardId] = tex;
                    return tex;
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[CardArt] Failed {path}: {e.Message}");
                }
            }

            Cache[cardId] = null;
            return null;
        }

        public static void ClearCache()
        {
            foreach (var kv in Cache)
                if (kv.Value != null) UnityEngine.Object.Destroy(kv.Value);
            Cache.Clear();
            _searchRoots = null;
        }

        static string[] GetRoots()
        {
            if (_searchRoots != null) return _searchRoots;
            var list = new List<string>();
            // Preferred Unity copies
            list.Add(Path.Combine(Application.dataPath, "Art", "Cards"));
            list.Add(Path.Combine(Application.streamingAssetsPath, "CardArt"));
#if UNITY_EDITOR
            // Repo data/art from git mirror: Assets/../../data/art
            var fromAssets = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "data", "art"));
            if (Directory.Exists(fromAssets)) list.Add(fromAssets);
            // Runtime project on D: may sit beside a clone — also try sibling CommandWarfare/data/art
            var sibling = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "CommandWarfare", "data", "art"));
            if (Directory.Exists(sibling)) list.Add(sibling);
            var keash = @"C:\Users\keash\Projects\CommandWarfare\data\art";
            if (Directory.Exists(keash)) list.Add(keash);
#endif
            _searchRoots = list.ToArray();
            return _searchRoots;
        }
    }
}
