using System;
using System.Collections.Generic;
using System.IO;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>Imports data/keywords.yaml into KeywordDefinition assets.</summary>
    public static class KeywordYamlImporter
    {
        const string OutputFolder = "Assets/Data/Keywords";
        const string DatabasePath = "Assets/Data/KeywordDatabase.asset";

        [MenuItem("CommandWarfare/Import Keywords From YAML")]
        public static void ImportAll()
        {
            var dataRoot = EditorPrefs.GetString("CommandWarfare.DataRoot",
                @"C:\Users\keash\Projects\CommandWarfare\data");
            var yamlPath = Path.Combine(dataRoot, "keywords.yaml");
            if (!File.Exists(yamlPath))
            {
                EditorUtility.DisplayDialog("Import Keywords",
                    $"keywords.yaml not found:\n{yamlPath}", "OK");
                return;
            }

            Directory.CreateDirectory(OutputFolder);
            var imported = new List<KeywordDefinition>();
            KeywordDefinition current = null;
            string currentName = null;
            var tags = new List<string>();
            var inTags = false;
            var inDescription = false;
            var descriptionParts = new List<string>();

            void Flush()
            {
                if (current == null || string.IsNullOrEmpty(currentName)) return;
                if (descriptionParts.Count > 0)
                    current.description = string.Join(" ", descriptionParts).Trim();
                current.displayName = currentName;
                current.name = currentName;
                current.tags = tags.ToArray();
                var safe = currentName;
                foreach (var c in Path.GetInvalidFileNameChars())
                    safe = safe.Replace(c, '_');
                var assetPath = $"{OutputFolder}/{safe}.asset";
                var existing = AssetDatabase.LoadAssetAtPath<KeywordDefinition>(assetPath);
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
                    current = ScriptableObject.CreateInstance<KeywordDefinition>();
                    tags = new List<string>();
                    descriptionParts = new List<string>();
                    inTags = false;
                    inDescription = false;
                    continue;
                }

                if (current == null) continue;
                var line = rawLine.Trim();
                if (line.StartsWith("- ", StringComparison.Ordinal) && inTags)
                {
                    tags.Add(line[2..].Trim());
                    continue;
                }
                if (!line.Contains(':'))
                {
                    if (inDescription)
                        descriptionParts.Add(line.Trim('\'').Trim('"'));
                    continue;
                }
                var colon = line.IndexOf(':');
                var key = line[..colon].Trim();
                var val = line[(colon + 1)..].Trim().Trim('"').Trim('\'');
                inTags = key == "tags";
                inDescription = key == "description";
                if (key == "description" && !string.IsNullOrEmpty(val) && val != ">" && val != "|")
                    descriptionParts.Add(val);
            }
            Flush();

            var db = AssetDatabase.LoadAssetAtPath<KeywordDatabase>(DatabasePath);
            if (db == null)
            {
                db = ScriptableObject.CreateInstance<KeywordDatabase>();
                AssetDatabase.CreateAsset(db, DatabasePath);
            }
            db.keywords = imported;
            db.RebuildIndex();
            EditorUtility.SetDirty(db);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"[CommandWarfare] Imported {imported.Count} keywords into {OutputFolder}");
        }
    }
}
