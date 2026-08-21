using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loads abilities from exported JSON (Unity-friendly camelCase).</summary>
    public static class AbilityJsonLoader
    {
        [Serializable]
        class Root
        {
            public AbilityJsonDto[] abilities;
        }

        [Serializable]
        public class AbilityJsonDto
        {
            public string name;
            public string type;
            public string cost;
            public int costAmount;
            public string costResource;
            public string description;
            public string affects;
            public string usedBy;
            public int cooldown;
            public string[] tags;
        }

        public static AbilityDatabase BuildDatabase(TextAsset json)
        {
            var db = ScriptableObject.CreateInstance<AbilityDatabase>();
            db.abilities = LoadFromTextAsset(json);
            db.RebuildIndex();
            return db;
        }

        public static List<AbilityDefinition> LoadFromTextAsset(TextAsset json)
        {
            var result = new List<AbilityDefinition>();
            if (json == null || string.IsNullOrWhiteSpace(json.text)) return result;

            var root = JsonUtility.FromJson<Root>(WrapArray(json.text));
            if (root?.abilities == null) return result;

            foreach (var dto in root.abilities)
            {
                if (dto == null || string.IsNullOrEmpty(dto.name)) continue;
                var ability = ScriptableObject.CreateInstance<AbilityDefinition>();
                ability.name = dto.name; // Unity Object asset name
                ability.displayName = dto.name;
                ability.type = dto.type;
                ability.cost = dto.cost;
                ability.costAmount = dto.costAmount;
                ability.costResource = dto.costResource;
                ability.description = dto.description;
                ability.affects = dto.affects;
                ability.usedBy = dto.usedBy;
                ability.cooldown = dto.cooldown;
                ability.tags = dto.tags ?? Array.Empty<string>();
                result.Add(ability);
            }
            return result;
        }

        static string WrapArray(string text)
        {
            var trimmed = text.TrimStart();
            return trimmed.StartsWith("[") ? "{\"abilities\":" + text + "}" : text;
        }
    }
}
