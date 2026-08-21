using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loads pre-built submitArmy / confirmForceSelect JSON from quick-pick-armies-unity.json.</summary>
    public static class QuickPickArmyLoader
    {
        [Serializable]
        class RootDto
        {
            public int version;
            public string generatedAt;
            public int presetCount;
            public PresetDto[] presets;
        }

        [Serializable]
        public class PresetDto
        {
            public string commanderId;
            public string commanderName;
            public string race;
            public int totalUv;
            public int companyCount;
            public string submitArmyJson;
            public string confirmForceSelectJson;
        }

        static RootDto _cached;

        public static IReadOnlyList<PresetDto> LoadPresets(TextAsset json)
        {
            if (json == null || string.IsNullOrWhiteSpace(json.text))
                return Array.Empty<PresetDto>();

            _cached = JsonUtility.FromJson<RootDto>(json.text);
            return _cached?.presets ?? Array.Empty<PresetDto>();
        }

        public static IEnumerable<PresetDto> PresetsForRace(TextAsset json, string race)
        {
            if (string.IsNullOrWhiteSpace(race)) return Enumerable.Empty<PresetDto>();
            return LoadPresets(json).Where(p =>
                string.Equals(p.race, race, StringComparison.OrdinalIgnoreCase));
        }

        public static PresetDto DefaultForRace(TextAsset json, string race) =>
            PresetsForRace(json, race).FirstOrDefault();

        public static PresetDto FindByCommanderId(TextAsset json, string commanderId) =>
            LoadPresets(json).FirstOrDefault(p => p.commanderId == commanderId);

        public static string[] DistinctRaces(TextAsset json) =>
            LoadPresets(json)
                .Select(p => p.race)
                .Where(r => !string.IsNullOrEmpty(r))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(r => r, StringComparer.OrdinalIgnoreCase)
                .ToArray();
    }
}
