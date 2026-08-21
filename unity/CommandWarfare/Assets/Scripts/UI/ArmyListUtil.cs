using System;
using System.Collections.Generic;
using System.Text;
using CommandWarfare.Core;
using CommandWarfare.Core.State;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Army list helpers — UV, rarity copy caps, submitArmy JSON (play/shared/army.ts).</summary>
    public static class ArmyListUtil
    {
        const string PrefsKey = "cw-unity-saved-armies";

        public static int MaxCopiesForRarity(string rarity, bool unique = false)
        {
            if (unique) return 1;
            var key = string.IsNullOrWhiteSpace(rarity) ? "Common" : rarity.Trim();
            return key.ToLowerInvariant() switch
            {
                "legendary" or "epic" => 1,
                "rare" => 2,
                "uncommon" => 3,
                _ => 4,
            };
        }

        public static int CountCopies(DemoArmy army, string cardId)
        {
            if (army == null || string.IsNullOrEmpty(cardId)) return 0;
            var n = 0;
            if (army.Commander != null && army.Commander.cardId == cardId) n++;
            if (army.Companies == null) return n;
            foreach (var co in army.Companies)
            {
                if (co?.Officer != null && co.Officer.cardId == cardId) n++;
                if (co?.Units == null) continue;
                foreach (var u in co.Units)
                    if (u != null && u.cardId == cardId) n++;
            }
            return n;
        }

        /// <summary>Unit UV only (company capacity excludes the officer).</summary>
        public static int CompanyUnitsUv(DemoCompany co)
        {
            if (co?.Units == null) return 0;
            var uv = 0;
            foreach (var u in co.Units)
                if (u != null) uv += u.uv;
            return uv;
        }

        public static bool OfficerAlreadyAssigned(DemoArmy army, string cardId, int exceptCompany = -1)
        {
            if (army?.Companies == null || string.IsNullOrEmpty(cardId)) return false;
            for (var i = 0; i < army.Companies.Count; i++)
            {
                if (i == exceptCompany) continue;
                var off = army.Companies[i]?.Officer;
                if (off != null && off.cardId == cardId) return true;
            }
            return false;
        }

        /// <summary>
        /// Whether <paramref name="card"/> can be added (or set) given the selected company.
        /// Officers are unique by card id across companies (web ArmyBuilder).
        /// </summary>
        public static bool CanAdd(DemoArmy army, CardDefinition card, int selectedCompany, out string error)
        {
            error = null;
            if (card == null)
            {
                error = "No card.";
                return false;
            }
            army ??= new DemoArmy();

            if (string.Equals(card.cardType, "Commander", StringComparison.OrdinalIgnoreCase))
            {
                if (army.Commander != null && army.Commander.cardId == card.cardId)
                    return true; // already set
                var have = CountCopies(army, card.cardId);
                // Replacing commander does not leave the old id in the list.
                if (army.Commander != null && army.Commander.cardId == card.cardId)
                    have = 0;
                var max = MaxCopiesForRarity(card.rarity);
                if (have >= max)
                {
                    error = $"{card.displayName} limited to {max} ({card.rarity ?? "Common"}).";
                    return false;
                }
                return true;
            }

            if (string.Equals(card.cardType, "Officer", StringComparison.OrdinalIgnoreCase))
            {
                var coIx = selectedCompany;
                if (army.Companies != null && army.Companies.Count > 0)
                    coIx = Mathf.Clamp(coIx, 0, army.Companies.Count - 1);
                else
                    coIx = -1;

                // Same officer already on another company — never allowed.
                if (OfficerAlreadyAssigned(army, card.cardId, exceptCompany: coIx))
                {
                    error = "That officer is already assigned to another company.";
                    return false;
                }

                // Replacing the selected company's officer with the same card is a no-op OK.
                if (coIx >= 0 && army.Companies[coIx]?.Officer != null &&
                    army.Companies[coIx].Officer.cardId == card.cardId)
                    return true;

                var have = CountCopies(army, card.cardId);
                // If replacing a different officer on this company, that slot is vacated.
                if (coIx >= 0 && army.Companies[coIx]?.Officer != null &&
                    army.Companies[coIx].Officer.cardId != card.cardId)
                {
                    /* have already excludes this card unless it appears elsewhere */
                }
                var max = MaxCopiesForRarity(card.rarity);
                if (have >= max)
                {
                    error = $"{card.displayName} limited to {max} ({card.rarity ?? "Common"}).";
                    return false;
                }

                if (army.Commander != null &&
                    !string.IsNullOrEmpty(army.Commander.race) &&
                    !string.IsNullOrEmpty(card.race) &&
                    !RaceMatchesCommander(card.race, army.Commander.race))
                {
                    error = $"Officer must match commander race ({army.Commander.race}).";
                    return false;
                }
                return true;
            }

            // Unit
            if (army.Companies == null || army.Companies.Count == 0)
            {
                error = "Add an Officer company first.";
                return false;
            }
            var ix = Mathf.Clamp(selectedCompany, 0, army.Companies.Count - 1);
            var co = army.Companies[ix];
            if (co?.Officer == null)
            {
                error = "Set this company's officer first.";
                return false;
            }

            var maxU = MaxCopiesForRarity(card.rarity);
            var haveU = CountCopies(army, card.cardId);
            if (haveU >= maxU)
            {
                error = $"{card.displayName} limited to {maxU} ({card.rarity ?? "Common"}).";
                return false;
            }

            if (army.Commander != null &&
                !string.IsNullOrEmpty(army.Commander.race) &&
                !string.IsNullOrEmpty(card.race) &&
                !RaceMatchesCommander(card.race, army.Commander.race))
            {
                error = $"Unit must match commander race ({army.Commander.race}).";
                return false;
            }

            var unitCap = co.Officer.companyUnitCap > 0 ? co.Officer.companyUnitCap : 0;
            if (unitCap <= 0)
            {
                error = "This officer has no unit cap.";
                return false;
            }
            var models = co.Units?.Count ?? 0;
            if (models + 1 > unitCap)
            {
                error = $"Company already has {models}/{unitCap} units.";
                return false;
            }

            var capUv = co.Officer.companyCapacity;
            if (capUv <= 0)
            {
                error = "Officer has no company capacity.";
                return false;
            }
            var usedUv = CompanyUnitsUv(co);
            if (usedUv + card.uv > capUv)
            {
                error = $"Company UV {usedUv}+{card.uv} exceeds capacity {capUv}.";
                return false;
            }

            if (army.TotalUv + card.uv > GameConstants.ArmyUvMax)
            {
                error = $"Army UV would exceed {GameConstants.ArmyUvMax}.";
                return false;
            }
            return true;
        }

        /// <summary>Legacy overload — uses company 0.</summary>
        public static bool CanAdd(DemoArmy army, CardDefinition card, out string error) =>
            CanAdd(army, card, 0, out error);

        static bool RaceMatchesCommander(string cardRace, string commanderRace)
        {
            if (string.Equals(cardRace, commanderRace, StringComparison.OrdinalIgnoreCase)) return true;
            if (cardRace.StartsWith("Lizard", StringComparison.OrdinalIgnoreCase) &&
                commanderRace.StartsWith("Lizard", StringComparison.OrdinalIgnoreCase))
                return true;
            return false;
        }

        public static string Validate(DemoArmy army)
        {
            if (army?.Commander == null) return "Army needs a Commander.";
            if (army.Commander.cardType != "Commander") return "Commander slot must be a Commander card.";
            if (army.Companies == null || army.Companies.Count == 0)
                return "Army needs at least one Officer company.";
            foreach (var co in army.Companies)
            {
                if (co?.Officer == null) return "Every company needs an Officer.";
                if (co.Officer.cardType != "Officer") return $"{co.Officer.displayName} is not an Officer.";
                if (co.Units == null || co.Units.Count < 1)
                    return $"{co.Officer.displayName} needs at least one unit.";
                var cap = co.Officer.companyUnitCap > 0 ? co.Officer.companyUnitCap : 10;
                if (co.Units.Count > cap)
                    return $"{co.Officer.displayName} exceeds unit cap ({co.Units.Count}/{cap}).";
            }
            if (army.TotalUv > GameConstants.ArmyUvMax)
                return $"UV {army.TotalUv} exceeds list max {GameConstants.ArmyUvMax}.";
            return null;
        }

        public static DemoArmy Clone(DemoArmy src)
        {
            var dst = new DemoArmy();
            if (src == null) return dst;
            dst.Commander = src.Commander;
            if (src.Companies == null) return dst;
            foreach (var co in src.Companies)
            {
                if (co == null) continue;
                var copy = new DemoCompany { Officer = co.Officer };
                if (co.Units != null)
                    copy.Units.AddRange(co.Units);
                dst.Companies.Add(copy);
            }
            return dst;
        }

        public static DemoArmy FromPresetOrEmpty(CardDatabase cards, string race)
        {
            if (cards == null) return new DemoArmy();
            return GameSessionFactory.BuildDemoArmy(cards, race) ?? new DemoArmy();
        }

        public static string BuildSubmitArmyJson(DemoArmy army)
        {
            if (army?.Commander == null) return null;
            var sb = new StringBuilder();
            sb.Append("{\"type\":\"submitArmy\",\"army\":{");
            sb.Append("\"commanderCardId\":\"").Append(Esc(army.Commander.cardId)).Append("\",");
            sb.Append("\"companies\":[");
            var firstCo = true;

            if (army.Companies != null)
            {
                foreach (var co in army.Companies)
                {
                    if (co?.Officer == null) continue;
                    if (!firstCo) sb.Append(',');
                    firstCo = false;
                    sb.Append("{\"officerCardId\":\"").Append(Esc(co.Officer.cardId)).Append("\",\"units\":[");
                    var counts = new Dictionary<string, int>();
                    if (co.Units != null)
                    {
                        foreach (var u in co.Units)
                        {
                            if (u == null) continue;
                            counts.TryGetValue(u.cardId, out var n);
                            counts[u.cardId] = n + 1;
                        }
                    }
                    var firstU = true;
                    foreach (var kv in counts)
                    {
                        if (!firstU) sb.Append(',');
                        firstU = false;
                        sb.Append("{\"cardId\":\"").Append(Esc(kv.Key)).Append("\",\"count\":").Append(kv.Value).Append('}');
                    }
                    sb.Append("]}");
                }
            }

            sb.Append("]},\"cards\":[");
            var list = CollectCards(army);
            for (var i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(CardSnapshotJson(list[i]));
            }
            sb.Append("]}");
            return sb.ToString();
        }

        public static List<SavedArmyEntry> LoadSaved()
        {
            var raw = PlayerPrefs.GetString(PrefsKey, "");
            if (string.IsNullOrWhiteSpace(raw)) return new List<SavedArmyEntry>();
            try
            {
                var root = JsonUtility.FromJson<SavedArmyRoot>(raw);
                return root?.armies != null ? new List<SavedArmyEntry>(root.armies) : new List<SavedArmyEntry>();
            }
            catch
            {
                return new List<SavedArmyEntry>();
            }
        }

        public static void SaveNamed(string name, DemoArmy army)
        {
            if (army?.Commander == null || string.IsNullOrWhiteSpace(name)) return;
            var list = LoadSaved();
            var entry = ToEntry(name.Trim(), army);
            var idx = list.FindIndex(a => string.Equals(a.name, entry.name, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0) list[idx] = entry;
            else list.Add(entry);
            var root = new SavedArmyRoot { armies = list.ToArray() };
            PlayerPrefs.SetString(PrefsKey, JsonUtility.ToJson(root));
            PlayerPrefs.Save();
        }

        public static DemoArmy Resolve(SavedArmyEntry entry, CardDatabase cards)
        {
            var army = new DemoArmy();
            if (entry == null || cards == null) return army;
            army.Commander = cards.FindById(entry.commanderId);
            if (entry.companies == null) return army;
            foreach (var co in entry.companies)
            {
                if (co == null) continue;
                var company = new DemoCompany { Officer = cards.FindById(co.officerId) };
                if (co.unitIds != null)
                {
                    foreach (var id in co.unitIds)
                    {
                        var u = cards.FindById(id);
                        if (u != null) company.Units.Add(u);
                    }
                }
                army.Companies.Add(company);
            }
            return army;
        }

        static SavedArmyEntry ToEntry(string name, DemoArmy army)
        {
            var companies = new List<SavedCompanyEntry>();
            if (army.Companies != null)
            {
                foreach (var co in army.Companies)
                {
                    if (co?.Officer == null) continue;
                    var units = new List<string>();
                    if (co.Units != null)
                        foreach (var u in co.Units)
                            if (u != null) units.Add(u.cardId);
                    companies.Add(new SavedCompanyEntry
                    {
                        officerId = co.Officer.cardId,
                        unitIds = units.ToArray(),
                    });
                }
            }
            return new SavedArmyEntry
            {
                name = name,
                commanderId = army.Commander.cardId,
                race = army.Commander.race,
                totalUv = army.TotalUv,
                companies = companies.ToArray(),
            };
        }

        static List<CardDefinition> CollectCards(DemoArmy army)
        {
            var seen = new HashSet<string>();
            var list = new List<CardDefinition>();
            void Add(CardDefinition c)
            {
                if (c == null || string.IsNullOrEmpty(c.cardId) || !seen.Add(c.cardId)) return;
                list.Add(c);
            }
            Add(army.Commander);
            if (army.Companies == null) return list;
            foreach (var co in army.Companies)
            {
                Add(co?.Officer);
                if (co?.Units == null) continue;
                foreach (var u in co.Units) Add(u);
            }
            return list;
        }

        static string CardSnapshotJson(CardDefinition c)
        {
            var kw = JoinArr(c.keywords);
            var ab = JoinArr(c.abilities);
            return "{"
                + "\"id\":\"" + Esc(c.cardId) + "\","
                + "\"name\":\"" + Esc(c.displayName) + "\","
                + "\"cardType\":\"" + Esc(c.cardType) + "\","
                + "\"rarity\":\"" + Esc(c.rarity) + "\","
                + "\"unique\":false,"
                + "\"race\":\"" + Esc(c.race) + "\","
                + "\"uv\":" + c.uv + ","
                + "\"move\":" + c.move + ","
                + "\"damage\":" + c.damage + ","
                + "\"range\":" + c.range + ","
                + "\"toughness\":" + c.toughness + ","
                + "\"companyCapacity\":" + c.companyCapacity + ","
                + "\"companyUnitCap\":" + c.companyUnitCap + ","
                + "\"commandRadius\":" + c.commandRadius + ","
                + "\"companyAp\":" + c.companyAp + ","
                + "\"apGeneration\":" + c.apGeneration + ","
                + "\"ccGeneration\":" + c.ccGeneration + ","
                + "\"favoredTerrain\":\"" + Esc(c.favoredTerrain) + "\","
                + "\"keywords\":" + kw + ","
                + "\"abilities\":" + ab + ","
                + "\"ultimate\":\"" + Esc(c.ultimate) + "\","
                + "\"primaryType\":\"" + Esc(c.primaryType) + "\","
                + "\"secondaryType\":\"" + Esc(c.secondaryType) + "\","
                + "\"role\":\"" + Esc(c.role) + "\""
                + "}";
        }

        static string JoinArr(string[] arr)
        {
            if (arr == null || arr.Length == 0) return "[]";
            var sb = new StringBuilder("[");
            for (var i = 0; i < arr.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(Esc(arr[i])).Append('"');
            }
            sb.Append(']');
            return sb.ToString();
        }

        static string Esc(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "");
        }

        [Serializable]
        public class SavedArmyRoot
        {
            public SavedArmyEntry[] armies;
        }

        [Serializable]
        public class SavedArmyEntry
        {
            public string name;
            public string commanderId;
            public string race;
            public int totalUv;
            public SavedCompanyEntry[] companies;
        }

        [Serializable]
        public class SavedCompanyEntry
        {
            public string officerId;
            public string[] unitIds;
        }
    }
}
