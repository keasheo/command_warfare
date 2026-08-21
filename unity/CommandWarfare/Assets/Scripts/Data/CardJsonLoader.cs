using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loads cards from exported JSON (Unity-friendly camelCase).</summary>
    public static class CardJsonLoader
    {
        [Serializable]
        class Root
        {
            public CardJsonDto[] cards;
        }

        [Serializable]
        public class CardJsonDto
        {
            public string cardId;
            public string displayName;
            public string cardType;
            public string race;
            public string rarity;
            public string primaryType;
            public string secondaryType;
            public string role;
            public string favoredTerrain;
            public int uv;
            public int move;
            public int damage;
            public int range;
            public int toughness;
            public int commandRadius;
            public int companyAp;
            public int companyCapacity;
            public int companyUnitCap;
            public int apGeneration;
            public int ccGeneration;
            public string[] keywords;
            public string[] abilities;
            public string ultimate;
            public string flavorText;
            public string sourceFile;
        }

        public static List<CardDefinition> LoadFromTextAsset(TextAsset json)
        {
            var result = new List<CardDefinition>();
            if (json == null || string.IsNullOrWhiteSpace(json.text)) return result;

            var root = JsonUtility.FromJson<Root>(WrapArray(json.text));
            if (root?.cards == null) return result;

            foreach (var dto in root.cards)
            {
                if (dto == null || string.IsNullOrEmpty(dto.cardId)) continue;
                var card = ScriptableObject.CreateInstance<CardDefinition>();
                card.cardId = dto.cardId;
                card.displayName = dto.displayName;
                card.cardType = dto.cardType;
                card.race = dto.race;
                card.rarity = dto.rarity;
                card.primaryType = dto.primaryType;
                card.secondaryType = dto.secondaryType;
                card.role = dto.role;
                card.favoredTerrain = dto.favoredTerrain;
                card.uv = dto.uv;
                card.move = dto.move;
                card.damage = dto.damage;
                card.range = dto.range;
                card.toughness = dto.toughness;
                card.commandRadius = dto.commandRadius;
                card.companyAp = dto.companyAp;
                card.companyCapacity = dto.companyCapacity;
                card.companyUnitCap = dto.companyUnitCap;
                card.apGeneration = dto.apGeneration;
                card.ccGeneration = dto.ccGeneration;
                card.keywords = dto.keywords ?? Array.Empty<string>();
                card.abilities = dto.abilities ?? Array.Empty<string>();
                card.ultimate = dto.ultimate;
                card.flavorText = dto.flavorText;
                card.sourceFile = dto.sourceFile;
                result.Add(card);
            }
            return result;
        }

        public static CardDatabase BuildDatabase(TextAsset json)
        {
            var db = ScriptableObject.CreateInstance<CardDatabase>();
            db.cards = LoadFromTextAsset(json);
            db.RebuildIndex();
            return db;
        }

        /// <summary>JsonUtility cannot parse bare arrays; cards.json is already wrapped.</summary>
        static string WrapArray(string text)
        {
            var trimmed = text.TrimStart();
            return trimmed.StartsWith("[") ? "{\"cards\":" + text + "}" : text;
        }
    }
}
