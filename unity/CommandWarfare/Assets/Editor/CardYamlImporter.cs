using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Imports card YAML from the main repo data/cards folder into ScriptableObjects.
    /// Menu: CommandWarfare → Import Cards From YAML
    /// </summary>
    public static class CardYamlImporter
    {
        const string DefaultDataRoot = @"C:\Users\keash\Projects\CommandWarfare\data";
        const string OutputFolder = "Assets/Data/Cards";
        const string DatabasePath = "Assets/Data/CardDatabase.asset";

        [MenuItem("CommandWarfare/Import Cards From YAML")]
        public static void ImportAll()
        {
            var dataRoot = EditorPrefs.GetString("CommandWarfare.DataRoot", DefaultDataRoot);
            if (!Directory.Exists(dataRoot))
            {
                EditorUtility.DisplayDialog("Import Cards",
                    $"Data folder not found:\n{dataRoot}\n\nSet path via CommandWarfare → Set Data Root…",
                    "OK");
                return;
            }

            Directory.CreateDirectory(OutputFolder);
            var imported = new List<CardDefinition>();
            var cardsDir = Path.Combine(dataRoot, "cards");
            foreach (var yamlPath in Directory.GetFiles(cardsDir, "*.yaml", SearchOption.AllDirectories))
            {
                foreach (var raw in ParseCardFile(yamlPath))
                {
                    var asset = CreateOrUpdateCard(raw, yamlPath);
                    imported.Add(asset);
                }
            }

            var db = AssetDatabase.LoadAssetAtPath<CardDatabase>(DatabasePath);
            if (db == null)
            {
                db = ScriptableObject.CreateInstance<CardDatabase>();
                AssetDatabase.CreateAsset(db, DatabasePath);
            }
            db.cards = imported;
            db.RebuildIndex();
            EditorUtility.SetDirty(db);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[CommandWarfare] Imported {imported.Count} cards into {OutputFolder}");
        }

        [MenuItem("CommandWarfare/Set Data Root…")]
        public static void SetDataRoot()
        {
            var picked = EditorUtility.OpenFolderPanel("Select CommandWarfare data folder", DefaultDataRoot, "");
            if (!string.IsNullOrEmpty(picked))
            {
                EditorPrefs.SetString("CommandWarfare.DataRoot", picked);
                Debug.Log($"[CommandWarfare] Data root set to: {picked}");
            }
        }

        static CardDefinition CreateOrUpdateCard(Dictionary<string, object> raw, string yamlPath)
        {
            var id = GetString(raw, "id");
            var safeName = SanitizeFileName(GetString(raw, "name") ?? id);
            var rel = yamlPath.Replace('\\', '/');
            var raceFolder = "misc";
            var idx = rel.IndexOf("/cards/", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0)
            {
                var tail = rel[(idx + 7)..];
                var slash = tail.IndexOf('/');
                if (slash > 0) raceFolder = tail[..slash];
            }
            var outDir = $"{OutputFolder}/{raceFolder}";
            Directory.CreateDirectory(outDir);
            var assetPath = $"{outDir}/{safeName}.asset";

            var card = AssetDatabase.LoadAssetAtPath<CardDefinition>(assetPath);
            if (card == null)
            {
                card = ScriptableObject.CreateInstance<CardDefinition>();
                AssetDatabase.CreateAsset(card, assetPath);
            }

            card.cardId = id;
            card.displayName = GetString(raw, "name");
            card.cardType = GetString(raw, "card_type");
            card.race = GetString(raw, "race");
            card.rarity = GetString(raw, "rarity");
            card.primaryType = GetString(raw, "primary_type");
            card.secondaryType = GetString(raw, "secondary_type");
            card.role = GetString(raw, "role");
            card.favoredTerrain = GetString(raw, "favored_terrain");
            card.uv = GetInt(raw, "uv");
            card.move = GetInt(raw, "move");
            card.damage = GetInt(raw, "damage");
            card.range = GetInt(raw, "range");
            card.toughness = GetInt(raw, "toughness");
            card.commandRadius = GetInt(raw, "command_radius");
            card.companyAp = GetInt(raw, "company_ap");
            card.companyCapacity = GetInt(raw, "company_capacity");
            card.companyUnitCap = GetInt(raw, "company_unit_cap");
            card.keywords = GetStringArray(raw, "keywords");
            card.abilities = GetStringArray(raw, "abilities");
            card.ultimate = GetString(raw, "ultimate");
            card.flavorText = GetString(raw, "flavor_text");
            card.sourceFile = yamlPath;
            EditorUtility.SetDirty(card);
            return card;
        }

        static List<Dictionary<string, object>> ParseCardFile(string path)
        {
            var cards = new List<Dictionary<string, object>>();
            Dictionary<string, object> current = null;
            string listKey = null;
            var list = new List<string>();

            foreach (var line in File.ReadAllLines(path))
            {
                if (string.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith("#"))
                    continue;

                if (line.StartsWith("  - id:", StringComparison.Ordinal))
                {
                    if (current != null)
                    {
                        if (listKey != null) current[listKey] = list.ToArray();
                        cards.Add(current);
                    }
                    current = new Dictionary<string, object>();
                    listKey = null;
                    list = new List<string>();
                    current["id"] = line["  - id:".Length..].Trim();
                    continue;
                }

                if (current == null) continue;

                if (line.StartsWith("      - ", StringComparison.Ordinal) && listKey != null)
                {
                    list.Add(line[8..].Trim());
                    continue;
                }

                if (line.StartsWith("    ", StringComparison.Ordinal) && line.Contains(':'))
                {
                    if (listKey != null)
                    {
                        current[listKey] = list.ToArray();
                        listKey = null;
                        list = new List<string>();
                    }

                    var trimmed = line[4..];
                    var colon = trimmed.IndexOf(':');
                    var key = trimmed[..colon].Trim();
                    var val = trimmed[(colon + 1)..].Trim();
                    if (val == "null" || val.Length == 0)
                        current[key] = null;
                    else if (int.TryParse(val, out var n))
                        current[key] = n;
                    else
                        current[key] = val;

                    if (val.Length == 0)
                        listKey = key;
                }
            }

            if (current != null)
            {
                if (listKey != null) current[listKey] = list.ToArray();
                cards.Add(current);
            }
            return cards;
        }

        static string GetString(Dictionary<string, object> raw, string key) =>
            raw.TryGetValue(key, out var v) ? v as string : null;

        static int GetInt(Dictionary<string, object> raw, string key) =>
            raw.TryGetValue(key, out var v) && v is int n ? n : 0;

        static string[] GetStringArray(Dictionary<string, object> raw, string key) =>
            raw.TryGetValue(key, out var v) && v is string[] arr ? arr : Array.Empty<string>();

        static string SanitizeFileName(string name)
        {
            var sb = new StringBuilder(name.Length);
            foreach (var c in name)
                sb.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 ? '_' : c);
            return sb.ToString();
        }
    }
}
