using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loads keywords from exported JSON (Unity-friendly camelCase).</summary>
    public static class KeywordJsonLoader
    {
        [Serializable]
        class Root
        {
            public KeywordJsonDto[] keywords;
        }

        [Serializable]
        public class KeywordJsonDto
        {
            public string name;
            public string description;
            public string[] tags;
        }

        public static KeywordDatabase BuildDatabase(TextAsset json)
        {
            var db = ScriptableObject.CreateInstance<KeywordDatabase>();
            db.keywords = LoadFromTextAsset(json);
            db.RebuildIndex();
            return db;
        }

        public static List<KeywordDefinition> LoadFromTextAsset(TextAsset json)
        {
            var result = new List<KeywordDefinition>();
            if (json == null || string.IsNullOrWhiteSpace(json.text)) return result;

            var root = JsonUtility.FromJson<Root>(WrapArray(json.text));
            if (root?.keywords == null) return result;

            foreach (var dto in root.keywords)
            {
                if (dto == null || string.IsNullOrEmpty(dto.name)) continue;
                var keyword = ScriptableObject.CreateInstance<KeywordDefinition>();
                keyword.displayName = dto.name;
                keyword.name = dto.name;
                keyword.description = dto.description;
                keyword.tags = dto.tags ?? Array.Empty<string>();
                result.Add(keyword);
            }
            return result;
        }

        static string WrapArray(string text)
        {
            var trimmed = text.TrimStart();
            return trimmed.StartsWith("[") ? "{\"keywords\":" + text + "}" : text;
        }
    }
}
