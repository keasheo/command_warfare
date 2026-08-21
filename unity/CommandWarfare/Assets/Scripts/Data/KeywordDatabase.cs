using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "KeywordDatabase", menuName = "CommandWarfare/Keyword Database")]
    public class KeywordDatabase : ScriptableObject
    {
        public List<KeywordDefinition> keywords = new();

        readonly Dictionary<string, KeywordDefinition> _byName = new();

        public void RebuildIndex()
        {
            _byName.Clear();
            foreach (var k in keywords)
            {
                if (k != null && !string.IsNullOrEmpty(k.displayName))
                    _byName[k.displayName] = k;
            }
        }

        public KeywordDefinition FindByName(string keywordName)
        {
            if (_byName.Count == 0) RebuildIndex();
            if (string.IsNullOrEmpty(keywordName)) return null;
            return _byName.TryGetValue(keywordName, out var k) ? k : null;
        }

        public IReadOnlyList<KeywordDefinition> All => keywords;
    }
}
