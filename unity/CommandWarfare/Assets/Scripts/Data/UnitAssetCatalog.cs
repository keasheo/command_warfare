using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Unit model prefabs keyed by role — drop Asset Store meshes here.</summary>
    [CreateAssetMenu(fileName = "UnitAssetCatalog", menuName = "CommandWarfare/Unit Asset Catalog")]
    public class UnitAssetCatalog : ScriptableObject
    {
        [Header("Generic placeholders (any race)")]
        public GameObject commanderPrefab;
        public GameObject officerPrefab;
        public GameObject unitPrefab;

        [Header("Optional race-specific overrides")]
        public GameObject humanUnitPrefab;
        public GameObject dwarfUnitPrefab;
        public GameObject elfUnitPrefab;
        public GameObject undeadUnitPrefab;
        public GameObject demonUnitPrefab;
        public GameObject dragonUnitPrefab;
        public GameObject beastfolkUnitPrefab;
        public GameObject lizardmenUnitPrefab;
        public GameObject constructUnitPrefab;

        public GameObject ForRole(string cardType, string race)
        {
            if (cardType == "Commander" && commanderPrefab != null) return commanderPrefab;
            if (cardType == "Officer" && officerPrefab != null) return officerPrefab;
            var racePrefab = race switch
            {
                "Dwarf" => dwarfUnitPrefab,
                "Human" => humanUnitPrefab,
                "Elf" => elfUnitPrefab,
                "Undead" => undeadUnitPrefab,
                "Demon" => demonUnitPrefab,
                "Dragon" => dragonUnitPrefab,
                "Beastfolk" => beastfolkUnitPrefab,
                "Lizardmen" or "Lizardman" => lizardmenUnitPrefab,
                "Construct" => constructUnitPrefab,
                _ => null,
            };
            return racePrefab != null ? racePrefab : unitPrefab;
        }
    }
}
