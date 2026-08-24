using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Unit model prefabs keyed by role / race / optional cardId — drop Asset Store meshes here.</summary>
    [CreateAssetMenu(fileName = "UnitAssetCatalog", menuName = "CommandWarfare/Unit Asset Catalog")]
    public class UnitAssetCatalog : ScriptableObject
    {
        [System.Serializable]
        public class CardVariant
        {
            public string cardId;
            public GameObject prefab;
            public Color tint = Color.white;
        }

        [Header("Generic placeholders (any race)")]
        public GameObject commanderPrefab;
        public GameObject officerPrefab;
        public GameObject unitPrefab;

        [Header("Optional race-specific unit overrides")]
        public GameObject humanUnitPrefab;
        public GameObject dwarfUnitPrefab;
        public GameObject elfUnitPrefab;
        public GameObject undeadUnitPrefab;
        public GameObject demonUnitPrefab;
        public GameObject dragonUnitPrefab;
        public GameObject beastfolkUnitPrefab;
        public GameObject lizardmenUnitPrefab;
        public GameObject constructUnitPrefab;

        [Header("Optional race commanders / officers")]
        public GameObject humanCommanderPrefab;
        public GameObject dwarfCommanderPrefab;
        public GameObject elfCommanderPrefab;
        public GameObject undeadCommanderPrefab;
        public GameObject demonCommanderPrefab;
        public GameObject humanOfficerPrefab;
        public GameObject dwarfOfficerPrefab;
        public GameObject elfOfficerPrefab;

        [Header("Per-card / weapon variants")]
        public CardVariant[] cardVariants;

        [Header("Seat tint multipliers (applied when no material override)")]
        public Color northTint = new Color(0.55f, 0.72f, 1f, 1f);
        public Color southTint = new Color(1f, 0.62f, 0.45f, 1f);

        public GameObject Resolve(UnitKind kind, string race, string cardId = null)
        {
            if (!string.IsNullOrEmpty(cardId) && cardVariants != null)
            {
                foreach (var v in cardVariants)
                {
                    if (v != null && v.prefab != null &&
                        string.Equals(v.cardId, cardId, System.StringComparison.OrdinalIgnoreCase))
                        return v.prefab;
                }
            }

            var cardType = kind switch
            {
                UnitKind.Commander => "Commander",
                UnitKind.Officer => "Officer",
                _ => "Unit",
            };
            return ForRole(cardType, race);
        }

        public Color TintFor(UnitKind kind, string race, string cardId, SeatId seat)
        {
            if (!string.IsNullOrEmpty(cardId) && cardVariants != null)
            {
                foreach (var v in cardVariants)
                {
                    if (v != null &&
                        string.Equals(v.cardId, cardId, System.StringComparison.OrdinalIgnoreCase) &&
                        v.tint.a > 0.01f && v.tint != Color.white)
                        return v.tint;
                }
            }
            return seat == SeatId.S ? southTint : northTint;
        }

        public GameObject ForRole(string cardType, string race)
        {
            if (cardType == "Commander")
            {
                var raceCmd = race switch
                {
                    "Human" => humanCommanderPrefab,
                    "Dwarf" => dwarfCommanderPrefab,
                    "Elf" => elfCommanderPrefab,
                    "Undead" => undeadCommanderPrefab,
                    "Demon" => demonCommanderPrefab,
                    "Dragon" => dragonUnitPrefab,
                    "Beastfolk" => beastfolkUnitPrefab,
                    "Lizardmen" or "Lizardman" => lizardmenUnitPrefab,
                    "Construct" => constructUnitPrefab,
                    _ => null,
                };
                if (IsUsableMesh(raceCmd)) return raceCmd;
            }
            if (cardType == "Officer")
            {
                var raceOff = race switch
                {
                    "Human" => humanOfficerPrefab,
                    "Dwarf" => dwarfOfficerPrefab,
                    "Elf" => elfOfficerPrefab,
                    "Undead" => undeadUnitPrefab,
                    "Demon" => demonUnitPrefab,
                    "Dragon" => dragonUnitPrefab,
                    "Beastfolk" => beastfolkUnitPrefab,
                    "Lizardmen" or "Lizardman" => lizardmenUnitPrefab,
                    "Construct" => constructUnitPrefab,
                    _ => null,
                };
                if (IsUsableMesh(raceOff)) return raceOff;
            }

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
            if (IsUsableMesh(racePrefab)) return racePrefab;

            // Generic role slots — skip CW_/Placeholder capsules so MiniFigureBuilder
            // only runs when we truly have no race mesh (e.g. Construct).
            if (cardType == "Commander" && IsUsableMesh(commanderPrefab)) return commanderPrefab;
            if (cardType == "Officer" && IsUsableMesh(officerPrefab)) return officerPrefab;
            if (IsUsableMesh(unitPrefab)) return unitPrefab;
            return null;
        }

        static bool IsUsableMesh(GameObject prefab)
        {
            if (prefab == null) return false;
            var n = prefab.name ?? "";
            if (n.StartsWith("CW_", System.StringComparison.OrdinalIgnoreCase)) return false;
            if (n.IndexOf("Placeholder", System.StringComparison.OrdinalIgnoreCase) >= 0) return false;
            return true;
        }
    }
}
