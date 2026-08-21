using System.Collections.Generic;
using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "CardDatabase", menuName = "CommandWarfare/Card Database")]
    public class CardDatabase : ScriptableObject
    {
        public List<CardDefinition> cards = new();

        readonly Dictionary<string, CardDefinition> _byId = new();

        public void RebuildIndex()
        {
            _byId.Clear();
            foreach (var c in cards)
            {
                if (c != null && !string.IsNullOrEmpty(c.cardId))
                    _byId[c.cardId] = c;
            }
        }

        public CardDefinition FindById(string cardId)
        {
            if (_byId.Count == 0) RebuildIndex();
            return _byId.TryGetValue(cardId, out var c) ? c : null;
        }

        public IReadOnlyList<CardDefinition> All => cards;
    }
}
