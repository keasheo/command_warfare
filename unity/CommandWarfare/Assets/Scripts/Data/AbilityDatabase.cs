using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "AbilityDatabase", menuName = "CommandWarfare/Ability Database")]
    public class AbilityDatabase : ScriptableObject
    {
        public List<AbilityDefinition> abilities = new();

        readonly Dictionary<string, AbilityDefinition> _byName = new();

        public void RebuildIndex()
        {
            _byName.Clear();
            foreach (var a in abilities)
            {
                if (a != null && !string.IsNullOrEmpty(a.displayName))
                    _byName[a.displayName] = a;
            }
        }

        public AbilityDefinition FindByName(string abilityName)
        {
            if (_byName.Count == 0) RebuildIndex();
            if (string.IsNullOrEmpty(abilityName)) return null;
            if (_byName.TryGetValue(abilityName, out var a)) return a;
            foreach (var kv in _byName)
            {
                if (string.Equals(kv.Key, abilityName, System.StringComparison.OrdinalIgnoreCase))
                    return kv.Value;
            }
            return null;
        }

        public IReadOnlyList<AbilityDefinition> All => abilities;
    }
}
