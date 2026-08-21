using UnityEngine;

namespace CommandWarfare.Data
{
    [CreateAssetMenu(fileName = "Ability", menuName = "CommandWarfare/Ability")]
    public class AbilityDefinition : ScriptableObject
    {
        public string displayName;
        public string type;
        public string cost;
        public int costAmount;
        public string costResource;
        public string description;
        public string affects;
        public string usedBy;
        public int cooldown;
        public string[] tags;
    }
}
