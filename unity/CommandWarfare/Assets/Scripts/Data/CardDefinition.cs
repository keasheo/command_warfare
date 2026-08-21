using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "Card", menuName = "CommandWarfare/Card")]
    public class CardDefinition : ScriptableObject
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
}
