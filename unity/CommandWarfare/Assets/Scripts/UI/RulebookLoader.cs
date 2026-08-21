using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Loads flat rulebook-unity.json (JsonUtility-safe).</summary>
    public static class RulebookLoader
    {
        [Serializable]
        public class Root
        {
            public string title;
            public string exportedAt;
            public Section[] sections;
        }

        [Serializable]
        public class Section
        {
            public string id;
            public string title;
            public string body;
            public int depth;
        }

        public static Root Load(TextAsset json)
        {
            if (json == null || string.IsNullOrWhiteSpace(json.text)) return null;
            return JsonUtility.FromJson<Root>(json.text);
        }

        public static void Flatten(Section[] sections, List<(Section section, int depth)> outList)
        {
            if (sections == null) return;
            foreach (var s in sections)
            {
                if (s == null) continue;
                outList.Add((s, s.depth));
            }
        }
    }
}
