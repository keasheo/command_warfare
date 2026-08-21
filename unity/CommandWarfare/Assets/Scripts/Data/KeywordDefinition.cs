using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "Keyword", menuName = "CommandWarfare/Keyword")]
    public class KeywordDefinition : ScriptableObject
    {
        public string displayName;
        [TextArea(2, 8)]
        public string description;
        public string[] tags;
    }
}
