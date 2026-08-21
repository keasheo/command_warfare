using System;
using System.Collections.Generic;
using System.Text;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Net
{
    /// <summary>DTOs + helpers for play server JSON (camelCase, matches play/shared/types.ts).</summary>
    public static class PlayJson
    {
        [Serializable]
        public class WelcomeDto
        {
            public string type;
            public string token;
            public string seat;
            public string yourIp;
            public GameStateDto state;
        }

        [Serializable]
        public class StateDto
        {
            public string type;
            public GameStateDto state;
        }

        [Serializable]
        public class ErrorDto
        {
            public string type;
            public string message;
        }

        [Serializable]
        public class GameStateDto
        {
            public string roomCode;
            public int maxPlayers;
            public int boardSize;
            public string phase;
            public string activeSeat;
            public int round;
            public string activeCompanyOfficerId;
            public string winner;
            public UnitDto[] units;
        }

        [Serializable]
        public class UnitDto
        {
            public string id;
            public string seat;
            public string kind;
            public string cardId;
            public string cardName;
            public string officerCardId;
            public int col;
            public int row;
            public int move;
            public int moveRemaining;
            public int damage;
            public int range;
            public int toughness;
            public int toughnessCurrent;
            public int commandRadius;
            public string[] keywords;
            public string[] abilities;
            public string ultimate;
            public bool rooted;
            public bool fear;
            public bool terrorFear;
            public bool slow;
            public bool slowPendingClear;
            public bool evadeActive;
            public bool unyielding;
            public int harden;
            public int tempDamage;
            public int tempMove;
            public bool counterattack;
            public int poisonTokens;
            public int trampleLeftoverDamage;
            public bool attackedThisTurn;
            public int activationCol = int.MinValue;
            public int activationRow = int.MinValue;
            public bool frenzyAttackPending;
            public bool harassMovePending;
        }

        public static bool TryParseWelcome(string json, out WelcomeDto welcome)
        {
            welcome = null;
            if (string.IsNullOrEmpty(json) || !json.Contains("\"type\":\"welcome\""))
                return false;
            try
            {
                welcome = JsonUtility.FromJson<WelcomeDto>(json);
                return welcome != null && welcome.state != null;
            }
            catch
            {
                return false;
            }
        }

        public static bool TryParseState(string json, out GameStateDto state)
        {
            state = null;
            if (string.IsNullOrEmpty(json)) return false;
            if (!json.Contains("\"type\":\"state\"")) return false;
            try
            {
                var wrapper = JsonUtility.FromJson<StateDto>(json);
                state = wrapper?.state;
                return state != null;
            }
            catch
            {
                return false;
            }
        }

        public static bool TryParseError(string json, out string message)
        {
            message = null;
            if (string.IsNullOrEmpty(json) || !json.Contains("\"type\":\"error\""))
                return false;
            try
            {
                var err = JsonUtility.FromJson<ErrorDto>(json);
                message = err?.message ?? "Unknown error";
                return true;
            }
            catch
            {
                message = json;
                return true;
            }
        }

        /// <summary>Extract terrain map from raw state JSON (JsonUtility cannot parse dynamic keys).</summary>
        public static Dictionary<string, TerrainKind> ParseTerrainMap(string json)
        {
            var result = new Dictionary<string, TerrainKind>();
            if (string.IsNullOrEmpty(json)) return result;

            var key = "\"terrain\"";
            var idx = json.IndexOf(key, StringComparison.Ordinal);
            if (idx < 0) return result;

            idx = json.IndexOf('{', idx);
            if (idx < 0) return result;

            var end = FindMatchingBrace(json, idx);
            if (end < 0) return result;

            var block = json.Substring(idx + 1, end - idx - 1);
            var i = 0;
            while (i < block.Length)
            {
                var q1 = block.IndexOf('"', i);
                if (q1 < 0) break;
                var q2 = block.IndexOf('"', q1 + 1);
                if (q2 < 0) break;
                var hexKey = block.Substring(q1 + 1, q2 - q1 - 1);

                var q3 = block.IndexOf('"', q2 + 1);
                if (q3 < 0) break;
                var q4 = block.IndexOf('"', q3 + 1);
                if (q4 < 0) break;
                var kindSlug = block.Substring(q3 + 1, q4 - q3 - 1);

                if (TryParseTerrainKind(kindSlug, out var kind))
                    result[hexKey] = kind;

                i = q4 + 1;
            }
            return result;
        }

        public static string ParseNullableString(string json, string fieldName)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var needle = $"\"{fieldName}\":";
            var idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return null;
            idx += needle.Length;
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
            if (idx >= json.Length) return null;
            if (json[idx] == 'n') return null; // null
            if (json[idx] != '"') return null;
            var end = json.IndexOf('"', idx + 1);
            return end < 0 ? null : json.Substring(idx + 1, end - idx - 1);
        }

        public static int ParseIntField(string json, string fieldName, int fallback = 0)
        {
            if (string.IsNullOrEmpty(json)) return fallback;
            var needle = $"\"{fieldName}\":";
            var idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return fallback;
            idx += needle.Length;
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
            var start = idx;
            while (idx < json.Length && (char.IsDigit(json[idx]) || json[idx] == '-')) idx++;
            return int.TryParse(json.Substring(start, idx - start), out var n) ? n : fallback;
        }

        public static string ExtractJsonObject(string json, string propertyName)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var needle = $"\"{propertyName}\":";
            var idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return null;
            idx += needle.Length;
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
            if (idx >= json.Length || json[idx] != '{') return null;
            var end = FindMatchingBrace(json, idx);
            return end < 0 ? null : json.Substring(idx, end - idx + 1);
        }

        public static void ParseCommanderPools(string json, Dictionary<SeatId, CommanderPoolDto> target)
        {
            target.Clear();
            var block = ExtractJsonObject(json, "commanderPools");
            if (string.IsNullOrEmpty(block)) return;

            foreach (var seat in new[] { "N", "S", "E", "W" })
            {
                var seatObj = ExtractJsonObject(block, seat);
                if (string.IsNullOrEmpty(seatObj)) continue;
                if (!TryParseSeat(seat, out var seatId)) continue;
                target[seatId] = new CommanderPoolDto
                {
                    Ap = ParseIntField(seatObj, "ap"),
                    Cc = ParseIntField(seatObj, "cc"),
                    ApMax = ParseIntField(seatObj, "apMax"),
                    CcMax = ParseIntField(seatObj, "ccMax"),
                };
            }
        }

        public static void ParseCompanyPools(string json, Dictionary<string, CompanyPoolDto> target)
        {
            target.Clear();
            var block = ExtractJsonObject(json, "companyPools");
            if (string.IsNullOrEmpty(block)) return;

            var i = 0;
            while (i < block.Length)
            {
                var q1 = block.IndexOf('"', i);
                if (q1 < 0) break;
                var q2 = block.IndexOf('"', q1 + 1);
                if (q2 < 0) break;
                var officerId = block.Substring(q1 + 1, q2 - q1 - 1);
                if (officerId is "ap" or "apMax") { i = q2 + 1; continue; }

                var objStart = block.IndexOf('{', q2);
                if (objStart < 0) break;
                var objEnd = FindMatchingBrace(block, objStart);
                if (objEnd < 0) break;
                var obj = block.Substring(objStart, objEnd - objStart + 1);
                target[officerId] = new CompanyPoolDto
                {
                    Ap = ParseIntField(obj, "ap"),
                    ApMax = ParseIntField(obj, "apMax"),
                };
                i = objEnd + 1;
            }
        }

        public static string ParseLastCombatSummary(string json)
        {
            var block = ExtractJsonObject(json, "lastCombatResult");
            if (string.IsNullOrEmpty(block)) return null;
            var hit = block.Contains("\"hit\":true");
            var attacker = ParseNullableString(block, "attackerName") ?? "Attacker";
            var defender = ParseNullableString(block, "defenderName") ?? "Defender";
            var roll = ParseIntField(block, "roll");
            var hitNeed = ParseIntField(block, "hitNeed");
            if (!hit)
                return $"{attacker} missed {defender} (roll {roll} vs {hitNeed})";
            var dealt = ParseIntField(block, "dealt");
            return $"{attacker} hit {defender} for {dealt} (roll {roll} vs {hitNeed})";
        }

        static bool TryParseSeat(string seat, out SeatId seatId)
        {
            seatId = SeatId.N;
            switch (seat)
            {
                case "N": seatId = SeatId.N; return true;
                case "S": seatId = SeatId.S; return true;
                case "E": seatId = SeatId.E; return true;
                case "W": seatId = SeatId.W; return true;
                default: return false;
            }
        }

        public struct CommanderPoolDto
        {
            public int Ap;
            public int Cc;
            public int ApMax;
            public int CcMax;
        }

        public struct CompanyPoolDto
        {
            public int Ap;
            public int ApMax;
        }

        static int FindMatchingBrace(string json, int openIdx)
        {
            var depth = 0;
            for (var i = openIdx; i < json.Length; i++)
            {
                if (json[i] == '{') depth++;
                else if (json[i] == '}')
                {
                    depth--;
                    if (depth == 0) return i;
                }
            }
            return -1;
        }

        static bool TryParseTerrainKind(string slug, out TerrainKind kind)
        {
            kind = TerrainKind.Plains;
            if (string.IsNullOrEmpty(slug)) return false;
            return slug.ToLowerInvariant() switch
            {
                "plains" => Set(TerrainKind.Plains, out kind),
                "forest" => Set(TerrainKind.Forest, out kind),
                "swamp" => Set(TerrainKind.Swamp, out kind),
                "desert" => Set(TerrainKind.Desert, out kind),
                "water" => Set(TerrainKind.Water, out kind),
                "wall" => Set(TerrainKind.Wall, out kind),
                "volcanic" => Set(TerrainKind.Volcanic, out kind),
                "mountains" => Set(TerrainKind.Mountains, out kind),
                _ => false,
            };
        }

        static bool Set(TerrainKind value, out TerrainKind kind)
        {
            kind = value;
            return true;
        }

        public static string BuildJoin(string roomCode, string playerName, string token = null)
        {
            var name = EscapeJson(playerName);
            var room = EscapeJson(roomCode);
            if (!string.IsNullOrEmpty(token))
                return $"{{\"type\":\"join\",\"roomCode\":\"{room}\",\"name\":\"{name}\",\"token\":\"{EscapeJson(token)}\"}}";
            return $"{{\"type\":\"join\",\"roomCode\":\"{room}\",\"name\":\"{name}\"}}";
        }

        public static string BuildCreate(
            string playerName,
            bool vsAi = true,
            bool randomMap = true,
            int deployMax = 110,
            int reserveMax = 60)
        {
            var map = randomMap ? "true" : "false";
            return "{"
                + "\"type\":\"create\","
                + "\"name\":\"" + EscapeJson(playerName) + "\","
                + "\"opponent\":\"" + (vsAi ? "ai" : "human") + "\","
                + "\"maxPlayers\":2,"
                + "\"randomMap\":" + map + ","
                + "\"loadoutPools\":{\"deployMax\":" + deployMax + ",\"reserveMax\":" + reserveMax + "}"
                + "}";
        }

        public static string BuildMove(string unitId, int col, int row) =>
            $"{{\"type\":\"move\",\"unitId\":\"{EscapeJson(unitId)}\",\"col\":{col},\"row\":{row}}}";

        public static string BuildEndTurn() => "{\"type\":\"endTurn\"}";

        public static string BuildResolveAttack(string attackerId, string defenderId) =>
            $"{{\"type\":\"resolveAttack\",\"attackerUnitId\":\"{EscapeJson(attackerId)}\",\"defenderUnitId\":\"{EscapeJson(defenderId)}\"}}";

        public static string BuildActivateCompany(string officerUnitId) =>
            $"{{\"type\":\"activateCompany\",\"officerUnitId\":\"{EscapeJson(officerUnitId)}\"}}";

        public static string BuildActivateCommander() => "{\"type\":\"activateCommander\"}";

        public static string BuildActivateEvade(string unitId) =>
            $"{{\"type\":\"activateEvade\",\"unitId\":\"{EscapeJson(unitId)}\"}}";

        public static string BuildCastAbility(string casterUnitId, string abilityName, string targetUnitId = null)
        {
            if (!string.IsNullOrEmpty(targetUnitId))
                return $"{{\"type\":\"castAbility\",\"casterUnitId\":\"{EscapeJson(casterUnitId)}\",\"abilityName\":\"{EscapeJson(abilityName)}\",\"targetUnitId\":\"{EscapeJson(targetUnitId)}\"}}";
            return $"{{\"type\":\"castAbility\",\"casterUnitId\":\"{EscapeJson(casterUnitId)}\",\"abilityName\":\"{EscapeJson(abilityName)}\"}}";
        }

        public static string BuildPing() => "{\"type\":\"ping\"}";

        public static string BuildForceStart() => "{\"type\":\"forceStart\"}";

        public static string BuildConfirmTerrain() => "{\"type\":\"confirmTerrain\"}";

        public static string BuildSkipTerrain() => "{\"type\":\"skipTerrain\"}";

        public static string BuildConfirmDeploy() => "{\"type\":\"confirmDeploy\"}";

        public static string BuildContinueTrample() => "{\"type\":\"continueTrample\"}";

        public static string BuildDeclineTrample() => "{\"type\":\"declineTrample\"}";

        public static string BuildDeploy(int queueIndex, int col, int row) =>
            $"{{\"type\":\"deploy\",\"queueIndex\":{queueIndex},\"col\":{col},\"row\":{row}}}";

        public static string BuildChooseCommandZoneMode(string mode) =>
            $"{{\"type\":\"chooseCommandZoneMode\",\"mode\":\"{EscapeJson(mode)}\"}}";

        public static string BuildFloodCommandZone(string kind) =>
            $"{{\"type\":\"floodCommandZone\",\"kind\":\"{EscapeJson(kind)}\"}}";

        public static string BuildPickTerrain(string pieceId) =>
            $"{{\"type\":\"pickTerrain\",\"pieceId\":\"{EscapeJson(pieceId)}\"}}";

        public static string BuildUnpickTerrain(int handIndex) =>
            $"{{\"type\":\"unpickTerrain\",\"handIndex\":{handIndex}}}";

        public static string BuildPlaceTerrain(int col, int row, int rotation = 0, int? handIndex = null, string pieceId = null)
        {
            var sb = new StringBuilder();
            sb.Append($"{{\"type\":\"placeTerrain\",\"col\":{col},\"row\":{row},\"rotation\":{rotation}");
            if (handIndex.HasValue)
                sb.Append($",\"handIndex\":{handIndex.Value}");
            if (!string.IsNullOrEmpty(pieceId))
                sb.Append($",\"pieceId\":\"{EscapeJson(pieceId)}\"");
            sb.Append('}');
            return sb.ToString();
        }

        public static string BuildUndoMove(string unitId) =>
            $"{{\"type\":\"undoMove\",\"unitId\":\"{EscapeJson(unitId)}\"}}";

        public static string BuildToggleFortifyHex(int col, int row) =>
            $"{{\"type\":\"toggleFortifyHex\",\"col\":{col},\"row\":{row}}}";

        public static string BuildReviveFromGrave(string deathId, int? col = null, int? row = null, int toughness = 1)
        {
            var sb = new StringBuilder();
            sb.Append($"{{\"type\":\"reviveFromGrave\",\"deathId\":\"{EscapeJson(deathId)}\",\"toughness\":{toughness}");
            if (col.HasValue) sb.Append($",\"col\":{col.Value}");
            if (row.HasValue) sb.Append($",\"row\":{row.Value}");
            sb.Append('}');
            return sb.ToString();
        }

        public static string BuildSpendPool(string pool, int amount, string companyOfficerId = null)
        {
            if (!string.IsNullOrEmpty(companyOfficerId))
                return $"{{\"type\":\"spendPool\",\"pool\":\"{EscapeJson(pool)}\",\"amount\":{amount},\"companyOfficerId\":\"{EscapeJson(companyOfficerId)}\"}}";
            return $"{{\"type\":\"spendPool\",\"pool\":\"{EscapeJson(pool)}\",\"amount\":{amount}}}";
        }

        public static string BuildRollDice(int count, int sides = 6, string note = null)
        {
            if (!string.IsNullOrEmpty(note))
                return $"{{\"type\":\"rollDice\",\"count\":{count},\"sides\":{sides},\"note\":\"{EscapeJson(note)}\"}}";
            return $"{{\"type\":\"rollDice\",\"count\":{count},\"sides\":{sides}}}";
        }

        public static string BuildApplyDamage(string unitId, int amount) =>
            $"{{\"type\":\"applyDamage\",\"unitId\":\"{EscapeJson(unitId)}\",\"amount\":{amount}}}";

        public static string BuildApplyHeal(string unitId, int amount) =>
            $"{{\"type\":\"applyHeal\",\"unitId\":\"{EscapeJson(unitId)}\",\"amount\":{amount}}}";

        public struct DeathRecordDto
        {
            public string Id;
            public string UnitId;
            public string Seat;
            public string Kind;
            public string CardId;
            public string CardName;
            public string OfficerCardId;
            public int Col;
            public int Row;
            public int Round;
            public int Move;
            public int Damage;
            public int Range;
            public int Toughness;
            public int CommandRadius;
            public string[] Keywords;
            public string[] Abilities;
            public string Ultimate;
        }

        public static List<DeathRecordDto> ParseDeaths(string json)
        {
            var result = new List<DeathRecordDto>();
            var arr = ExtractJsonArray(json, "deaths");
            if (string.IsNullOrEmpty(arr)) return result;

            var i = 0;
            while (i < arr.Length)
            {
                var objStart = arr.IndexOf('{', i);
                if (objStart < 0) break;
                var objEnd = FindMatchingBrace(arr, objStart);
                if (objEnd < 0) break;
                var obj = arr.Substring(objStart, objEnd - objStart + 1);
                result.Add(new DeathRecordDto
                {
                    Id = ParseNullableString(obj, "id") ?? "",
                    UnitId = ParseNullableString(obj, "unitId") ?? "",
                    Seat = ParseNullableString(obj, "seat") ?? "",
                    Kind = ParseNullableString(obj, "kind") ?? "",
                    CardId = ParseNullableString(obj, "cardId") ?? "",
                    CardName = ParseNullableString(obj, "cardName") ?? "",
                    OfficerCardId = ParseNullableString(obj, "officerCardId"),
                    Col = ParseIntField(obj, "col"),
                    Row = ParseIntField(obj, "row"),
                    Round = ParseIntField(obj, "round"),
                    Move = ParseIntField(obj, "move"),
                    Damage = ParseIntField(obj, "damage"),
                    Range = ParseIntField(obj, "range"),
                    Toughness = ParseIntField(obj, "toughness"),
                    CommandRadius = ParseIntField(obj, "commandRadius"),
                    Keywords = ParseStringArray(obj, "keywords"),
                    Abilities = ParseStringArray(obj, "abilities"),
                    Ultimate = ParseNullableString(obj, "ultimate"),
                });
                i = objEnd + 1;
            }
            return result;
        }

        public static Dictionary<string, bool> ParseFortifiedHexes(string json)
        {
            var result = new Dictionary<string, bool>();
            var block = ExtractJsonObject(json, "fortifiedHexes");
            if (string.IsNullOrEmpty(block)) return result;

            var i = 0;
            while (i < block.Length)
            {
                var q1 = block.IndexOf('"', i);
                if (q1 < 0) break;
                var q2 = block.IndexOf('"', q1 + 1);
                if (q2 < 0) break;
                var key = block.Substring(q1 + 1, q2 - q1 - 1);
                if (key is "id" or "name") { i = q2 + 1; continue; }
                var colon = block.IndexOf(':', q2);
                if (colon < 0) break;
                var after = colon + 1;
                while (after < block.Length && char.IsWhiteSpace(block[after])) after++;
                if (after < block.Length && (block[after] == 't' || block.Substring(after).StartsWith("true")))
                    result[key] = true;
                i = q2 + 1;
            }
            return result;
        }

        public struct PlayerFlagsDto
        {
            public bool ArmyReady;
            public bool ForceSelectReady;
            public bool TerrainReady;
            public bool DeployDone;
        }

        public struct DeployQueueItemDto
        {
            public string Kind;
            public string CardId;
            public string OfficerCardId;
            public bool Placed;
        }

        public struct CardCatalogEntryDto
        {
            public string PrimaryType;
            public string[] Keywords;
            public int CommandRadius;
        }

        public static PendingTrampleDto? ParsePendingTrample(string json)
        {
            var block = ExtractJsonObject(json, "pendingTrample");
            if (string.IsNullOrEmpty(block)) return null;
            var attackerId = ParseNullableString(block, "attackerId");
            if (string.IsNullOrEmpty(attackerId)) return null;
            return new PendingTrampleDto
            {
                AttackerId = attackerId,
                DestCol = ParseIntField(block, "destCol"),
                DestRow = ParseIntField(block, "destRow"),
                LeftoverDamage = ParseIntField(block, "leftoverDamage"),
            };
        }

        public struct PendingTrampleDto
        {
            public string AttackerId;
            public int DestCol;
            public int DestRow;
            public int LeftoverDamage;
        }

        public static bool ParseRandomMap(string json) =>
            json != null && json.Contains("\"randomMap\":true");

        public static string ParseTerrainStage(string json) =>
            ParseNullableString(json, "terrainStage");

        public static bool ParsePlayerFlags(string json, SeatId seat, out PlayerFlagsDto flags)
        {
            flags = default;
            var block = ExtractJsonArray(json, "players");
            if (string.IsNullOrEmpty(block)) return false;

            var seatStr = seat switch
            {
                SeatId.N => "N",
                SeatId.S => "S",
                SeatId.E => "E",
                _ => "W",
            };

            var needle = $"\"seat\":\"{seatStr}\"";
            var idx = block.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return false;

            var objStart = block.LastIndexOf('{', idx);
            if (objStart < 0) return false;
            var objEnd = FindMatchingBrace(block, objStart);
            if (objEnd < 0) return false;
            var obj = block.Substring(objStart, objEnd - objStart + 1);

            flags = new PlayerFlagsDto
            {
                ArmyReady = obj.Contains("\"armyReady\":true"),
                ForceSelectReady = obj.Contains("\"forceSelectReady\":true"),
                TerrainReady = obj.Contains("\"terrainReady\":true"),
                DeployDone = obj.Contains("\"deployDone\":true"),
            };
            return true;
        }

        public static List<DeployQueueItemDto> ParseDeployQueue(string json, SeatId seat)
        {
            var result = new List<DeployQueueItemDto>();
            var block = ExtractJsonObject(json, "deployQueues");
            if (string.IsNullOrEmpty(block)) return result;

            var seatStr = seat switch
            {
                SeatId.N => "N",
                SeatId.S => "S",
                SeatId.E => "E",
                _ => "W",
            };

            var arr = ExtractJsonArray(block, seatStr);
            if (string.IsNullOrEmpty(arr)) return result;

            var i = 0;
            while (i < arr.Length)
            {
                var objStart = arr.IndexOf('{', i);
                if (objStart < 0) break;
                var objEnd = FindMatchingBrace(arr, objStart);
                if (objEnd < 0) break;
                var obj = arr.Substring(objStart, objEnd - objStart + 1);
                result.Add(new DeployQueueItemDto
                {
                    Kind = ParseNullableString(obj, "kind") ?? "",
                    CardId = ParseNullableString(obj, "cardId") ?? "",
                    OfficerCardId = ParseNullableString(obj, "officerCardId") ?? "",
                    Placed = obj.Contains("\"placed\":true"),
                });
                i = objEnd + 1;
            }
            return result;
        }

        public static Dictionary<string, CardCatalogEntryDto> ParseCardCatalog(string json)
        {
            var result = new Dictionary<string, CardCatalogEntryDto>();
            var block = ExtractJsonObject(json, "cardCatalog");
            if (string.IsNullOrEmpty(block)) return result;

            var i = 0;
            while (i < block.Length)
            {
                var q1 = block.IndexOf('"', i);
                if (q1 < 0) break;
                var q2 = block.IndexOf('"', q1 + 1);
                if (q2 < 0) break;
                var cardId = block.Substring(q1 + 1, q2 - q1 - 1);
                if (cardId is "id" or "name") { i = q2 + 1; continue; }

                var objStart = block.IndexOf('{', q2);
                if (objStart < 0) break;
                var objEnd = FindMatchingBrace(block, objStart);
                if (objEnd < 0) break;
                var obj = block.Substring(objStart, objEnd - objStart + 1);

                result[cardId] = new CardCatalogEntryDto
                {
                    PrimaryType = ParseNullableString(obj, "primaryType") ?? "",
                    Keywords = ParseStringArray(obj, "keywords"),
                    CommandRadius = ParseIntField(obj, "commandRadius"),
                };
                i = objEnd + 1;
            }
            return result;
        }

        static string[] ParseStringArray(string json, string fieldName)
        {
            var needle = $"\"{fieldName}\":";
            var idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return Array.Empty<string>();
            idx += needle.Length;
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
            if (idx >= json.Length || json[idx] != '[') return Array.Empty<string>();

            var end = json.IndexOf(']', idx);
            if (end < 0) return Array.Empty<string>();
            var inner = json.Substring(idx + 1, end - idx - 1);
            var list = new List<string>();
            var i = 0;
            while (i < inner.Length)
            {
                var q1 = inner.IndexOf('"', i);
                if (q1 < 0) break;
                var q2 = inner.IndexOf('"', q1 + 1);
                if (q2 < 0) break;
                list.Add(inner.Substring(q1 + 1, q2 - q1 - 1));
                i = q2 + 1;
            }
            return list.ToArray();
        }

        static string ExtractJsonArray(string json, string propertyName)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var needle = $"\"{propertyName}\":";
            var idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return null;
            idx += needle.Length;
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
            if (idx >= json.Length || json[idx] != '[') return null;
            var end = FindMatchingBracket(json, idx);
            return end < 0 ? null : json.Substring(idx, end - idx + 1);
        }

        static int FindMatchingBracket(string json, int openIdx)
        {
            var depth = 0;
            for (var i = openIdx; i < json.Length; i++)
            {
                if (json[i] == '[') depth++;
                else if (json[i] == ']')
                {
                    depth--;
                    if (depth == 0) return i;
                }
            }
            return -1;
        }

        public static bool HasCommandZoneMode(string json, SeatId seat)
        {
            var block = ExtractJsonObject(json, "commandZoneModes");
            if (string.IsNullOrEmpty(block)) return false;
            var seatStr = seat switch
            {
                SeatId.N => "N",
                SeatId.S => "S",
                SeatId.E => "E",
                _ => "W",
            };
            return block.Contains($"\"{seatStr}\":");
        }

        public static bool HasFloodedCommandZone(string json, SeatId seat)
        {
            var block = ExtractJsonObject(json, "terrainHands");
            if (string.IsNullOrEmpty(block)) return false;
            var seatArr = ExtractJsonArray(block, seat switch
            {
                SeatId.N => "N",
                SeatId.S => "S",
                SeatId.E => "E",
                _ => "W",
            });
            return !string.IsNullOrEmpty(seatArr) && seatArr.Contains("\"flooded\":true");
        }

        public static string ParseArmyRace(string json, SeatId seat)
        {
            var block = ExtractJsonArray(json, "players");
            if (string.IsNullOrEmpty(block)) return null;
            var seatStr = seat.ToString();
            if (seat == SeatId.W) seatStr = "W";
            var idx = block.IndexOf($"\"seat\":\"{seatStr}\"", StringComparison.Ordinal);
            if (idx < 0) return null;

            var armyNeedle = "\"army\":";
            var armyIdx = block.IndexOf(armyNeedle, idx, StringComparison.Ordinal);
            if (armyIdx < 0) return null;
            var cmdNeedle = "\"commanderCardId\":";
            var cmdIdx = block.IndexOf(cmdNeedle, armyIdx, StringComparison.Ordinal);
            if (cmdIdx < 0) return null;
            cmdIdx += cmdNeedle.Length;
            while (cmdIdx < block.Length && char.IsWhiteSpace(block[cmdIdx])) cmdIdx++;
            if (cmdIdx >= block.Length || block[cmdIdx] != '"') return null;
            var end = block.IndexOf('"', cmdIdx + 1);
            if (end < 0) return null;
            var commanderId = block.Substring(cmdIdx + 1, end - cmdIdx - 1);

            var catBlock = ExtractJsonObject(json, "cardCatalog");
            if (string.IsNullOrEmpty(catBlock)) return null;
            var raceNeedle = $"\"{commanderId}\":";
            var cIdx = catBlock.IndexOf(raceNeedle, StringComparison.Ordinal);
            if (cIdx < 0) return null;
            var objStart = catBlock.IndexOf('{', cIdx);
            if (objStart < 0) return null;
            var objEnd = FindMatchingBrace(catBlock, objStart);
            if (objEnd < 0) return null;
            return ParseNullableString(catBlock.Substring(objStart, objEnd - objStart + 1), "race");
        }

        static string EscapeJson(string s) =>
            string.IsNullOrEmpty(s) ? "" : s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
