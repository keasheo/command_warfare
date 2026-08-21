using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Loads card art by cardId. Prefers Assets/Art/Cards (local, git-ignored),
    /// then StreamingAssets/CardArt for builds.
    /// </summary>
    public static class CardArtLoader
    {
        static readonly Dictionary<string, Texture2D> Cache = new();
        static readonly string[] Exts = { ".png", ".jpg", ".jpeg", ".webp" };
        static string[] _roots;

        public static string ArtRoot => Path.Combine(Application.dataPath, "Art", "Cards");

        public static Texture2D Get(string cardId)
        {
            if (string.IsNullOrEmpty(cardId)) return null;
            if (Cache.TryGetValue(cardId, out var cached) && cached != null) return cached;

            var tex = LoadFromDisk(cardId);
            Cache[cardId] = tex;
            return tex;
        }

        public static bool HasArt(string cardId) => FindPath(cardId) != null;

        public static int CountOnDisk()
        {
            var n = 0;
            foreach (var root in GetRoots())
            {
                if (!Directory.Exists(root)) continue;
                foreach (var ext in Exts)
                    n += Directory.GetFiles(root, "*" + ext).Length;
            }
            return n;
        }

        public static void ClearCache()
        {
            foreach (var kv in Cache)
                if (kv.Value != null) UnityEngine.Object.Destroy(kv.Value);
            Cache.Clear();
            _roots = null;
        }

        static Texture2D LoadFromDisk(string cardId)
        {
            var path = FindPath(cardId);
            if (path == null) return null;
            try
            {
                var bytes = File.ReadAllBytes(path);
                var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!tex.LoadImage(bytes))
                {
                    UnityEngine.Object.Destroy(tex);
                    return null;
                }
                tex.name = "CardArt_" + cardId;
                tex.hideFlags = HideFlags.HideAndDontSave;
                return tex;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[CardArt] Failed {cardId}: {e.Message}");
                return null;
            }
        }

        static string FindPath(string cardId)
        {
            foreach (var root in GetRoots())
            {
                if (!Directory.Exists(root)) continue;
                foreach (var ext in Exts)
                {
                    var path = Path.Combine(root, cardId + ext);
                    if (File.Exists(path)) return path;
                }
            }
            return null;
        }

        static string[] GetRoots()
        {
            if (_roots != null) return _roots;
            var list = new List<string>
            {
                // Primary local art (Plastic / git-ignored).
                Path.Combine(Application.dataPath, "Art", "Cards"),
                // Build / StreamingAssets copy when present.
                Path.Combine(Application.streamingAssetsPath, "CardArt"),
            };
#if UNITY_EDITOR
            var fromMirror = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "data", "art"));
            if (Directory.Exists(fromMirror)) list.Add(fromMirror);
            var keash = @"C:\Users\keash\Projects\CommandWarfare\data\art";
            if (Directory.Exists(keash)) list.Add(keash);
#endif
            _roots = list.ToArray();
            return _roots;
        }
    }
}
