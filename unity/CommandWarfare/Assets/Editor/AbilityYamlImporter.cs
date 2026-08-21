using System;
using System.Collections.Generic;
using System.IO;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>Imports data/abilities.yaml into AbilityDefinition assets.</summary>
    public static class AbilityYamlImporter
    {
        const string OutputFolder = "Assets/Data/Abilities";
        const string DatabasePath = "Assets/Data/AbilityDatabase.asset";

        [MenuItem("CommandWarfare/Import Abilities From YAML")]
        public static void ImportAll()
        {
            var dataRoot = EditorPrefs.GetString("CommandWarfare.DataRoot",
                @"C:\Users\keash\Projects\CommandWarfare\data");
            var yamlPath = Path.Combine(dataRoot, "abilities.yaml");
            if (!File.Exists(yamlPath))
            {
                EditorUtility.DisplayDialog("Import Abilities",
                    $"abilities.yaml not found:\n{yamlPath}", "OK");
                return;
            }

            Directory.CreateDirectory(OutputFolder);
            var imported = new List<AbilityDefinition>();
            AbilityDefinition current = null;
            string currentName = null;
            var tags = new List<string>();
            var inTags = false;

            void Flush()
            {
                if (current == null || string.IsNullOrEmpty(currentName)) return;
                current.name = currentName;
                current.tags = tags.ToArray();
                var safe = currentName;
                foreach (var c in Path.GetInvalidFileNameChars())
                    safe = safe.Replace(c, '_');
                var assetPath = $"{OutputFolder}/{safe}.asset";
                var existing = AssetDatabase.LoadAssetAtPath<AbilityDefinition>(assetPath);
                if (existing == null)
                {
                    AssetDatabase.CreateAsset(current, assetPath);
                    existing = current;
                }
                else
                {
                    EditorUtility.CopySerialized(current, existing);
                    UnityEngine.Object.DestroyImmediate(current);
                }
                EditorUtility.SetDirty(existing);
                imported.Add(existing);
            }

            foreach (var rawLine in File.ReadAllLines(yamlPath))
            {
                if (string.IsNullOrWhiteSpace(rawLine) || rawLine.TrimStart().StartsWith("#"))
                    continue;

                if (!rawLine.StartsWith(" ", StringComparison.Ordinal) && rawLine.EndsWith(":"))
                {
                    Flush();
                    currentName = rawLine.TrimEnd(':').Trim();
                    current = ScriptableObject.CreateInstance<AbilityDefinition>();
                    tags = new List<string>();
                    inTags = false;
                    continue;
                }

                if (current == null) continue;
                var line = rawLine.Trim();
                if (line.StartsWith("- ", StringComparison.Ordinal) && inTags)
                {
                    tags.Add(line[2..].Trim());
                    continue;
                }
                if (!line.Contains(':')) continue;
                var colon = line.IndexOf(':');
                var key = line[..colon].Trim();
                var val = line[(colon + 1)..].Trim().Trim('"');
                inTags = key == "tags";
                switch (key)
                {
                    case "type": current.type = val; break;
                    case "cost": current.cost = val; break;
                    case "cost_amount":
                        int.TryParse(val, out current.costAmount);
                        break;
                    case "cost_resource": current.costResource = val; break;
                    case "description": current.description = val; break;
                    case "affects": current.affects = val; break;
                    case "used_by": current.usedBy = val; break;
                    case "cooldown":
                        int.TryParse(val, out current.cooldown);
                        break;
                }
            }
            Flush();

            var db = AssetDatabase.LoadAssetAtPath<AbilityDatabase>(DatabasePath);
            if (db == null)
            {
                db = ScriptableObject.CreateInstance<AbilityDatabase>();
                AssetDatabase.CreateAsset(db, DatabasePath);
            }
            db.abilities = imported;
            db.RebuildIndex();
            EditorUtility.SetDirty(db);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[CommandWarfare] Imported {imported.Count} abilities into {OutputFolder}");
        }
    }
}
