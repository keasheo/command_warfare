using System;
using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Loads commander effect aliases from play/shared/commanderEffectAliases.json.</summary>
    public static class AbilityAliasMap
    {
        [Serializable]
        class AliasRoot
        {
            // JsonUtility cannot parse arbitrary string keys — use manual parse fallback.
        }

        static Dictionary<string, string> _aliases;

        public static void LoadFromTextAsset(TextAsset json)
        {
            _aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (json == null || string.IsNullOrWhiteSpace(json.text)) return;

            // Simple key:value parse for flat JSON object.
            var text = json.text.Trim();
            if (!text.StartsWith("{")) return;
            foreach (var line in text.Split('\n'))
            {
                var trimmed = line.Trim().TrimEnd(',');
                if (!trimmed.StartsWith("\"")) continue;
                var colon = trimmed.IndexOf(':');
                if (colon < 0) continue;
                var key = trimmed.Substring(1, colon - 2).Trim('"');
                var valPart = trimmed.Substring(colon + 1).Trim().Trim('"');
                if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(valPart))
                    _aliases[key] = valPart;
            }
        }

        public static string ResolveEffectName(string abilityName)
        {
            if (string.IsNullOrEmpty(abilityName)) return abilityName;
            if (_aliases != null && _aliases.TryGetValue(abilityName, out var alias))
                return alias;
            return abilityName;
        }

        public static bool RequiresUnitTarget(string abilityName)
        {
            var resolved = ResolveEffectName(abilityName).ToLowerInvariant();
            return resolved is "harden order" or "overdrive" or "withering gaze" or "heal" or "medic"
                or "repair" or "rebuild protocol" or "counterattack" or "spectral strike"
                or "forge mend" or "repair rites";
        }
    }
}
