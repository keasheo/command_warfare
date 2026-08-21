using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Loads card art from StreamingAssets/CardArt/{cardId}.{png|jpg|jpeg|webp}.</summary>
    public static class CardArtLoader
    {
        static readonly Dictionary<string, Texture2D> Cache = new();
        static readonly string[] Exts = { ".png", ".jpg", ".jpeg", ".webp" };

        public static string ArtRoot => Path.Combine(Application.streamingAssetsPath, "CardArt");

        public static Texture2D Get(string cardId)
        {
            if (string.IsNullOrEmpty(cardId)) return null;
            if (Cache.TryGetValue(cardId, out var cached) && cached != null) return cached;

            var tex = LoadFromDisk(cardId);
            if (tex != null) Cache[cardId] = tex;
            return tex;
        }

        public static bool HasArt(string cardId) => FindPath(cardId) != null;

        public static int CountOnDisk()
        {
            var root = ArtRoot;
            if (!Directory.Exists(root)) return 0;
            var n = 0;
            foreach (var ext in Exts)
                n += Directory.GetFiles(root, "*" + ext).Length;
            return n;
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
            var root = ArtRoot;
            if (!Directory.Exists(root)) return null;
            foreach (var ext in Exts)
            {
                var path = Path.Combine(root, cardId + ext);
                if (File.Exists(path)) return path;
            }
            return null;
        }
    }
}
