using System;
using System.Collections.Generic;
using System.Linq;
using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;

namespace CommandWarfare.Core.Map
{
    /// <summary>Port of play/shared/randomMap.ts — biome generation + post-processing.</summary>
    public static class RandomMapGenerator
    {
        public const int WaterHexCap = 50;
        public const float CrWaterFractionCap = 0.08f;
        public const int CrWaterAbsoluteMax = 4;

        static readonly TerrainKind[] LandBiomes =
        {
            TerrainKind.Plains, TerrainKind.Forest, TerrainKind.Swamp,
            TerrainKind.Desert, TerrainKind.Volcanic, TerrainKind.Mountains,
        };

        static readonly Dictionary<TerrainKind, TerrainKind[]> BiomeVariants = new()
        {
            { TerrainKind.Forest, new[] { TerrainKind.Plains, TerrainKind.Swamp, TerrainKind.Mountains } },
            { TerrainKind.Volcanic, new[] { TerrainKind.Desert, TerrainKind.Mountains, TerrainKind.Plains } },
            { TerrainKind.Desert, new[] { TerrainKind.Plains, TerrainKind.Volcanic, TerrainKind.Mountains } },
            { TerrainKind.Mountains, new[] { TerrainKind.Forest, TerrainKind.Plains, TerrainKind.Volcanic } },
            { TerrainKind.Swamp, new[] { TerrainKind.Forest, TerrainKind.Plains, TerrainKind.Mountains } },
            { TerrainKind.Plains, new[] { TerrainKind.Forest, TerrainKind.Desert, TerrainKind.Swamp } },
            { TerrainKind.Water, new[] { TerrainKind.Plains, TerrainKind.Swamp, TerrainKind.Forest } },
            { TerrainKind.Wall, new[] { TerrainKind.Plains } },
        };

        public struct Options
        {
            public int BoardSize;
            public string RoomCode;
            public HashSet<string> ObjectiveKeys;
            public int WaterCap;
            public Dictionary<SeatId, HexCoord> Commanders;
            public Dictionary<SeatId, int> CommanderRadii;

            public static Options Default(int boardSize, string roomCode) => For2P(boardSize, roomCode);

            public static Options For2P(int boardSize, string roomCode)
            {
                var cmd = new Dictionary<SeatId, HexCoord>
                {
                    { SeatId.N, GameSetup.EdgeCommanderHex(SeatId.N, boardSize) },
                    { SeatId.S, GameSetup.EdgeCommanderHex(SeatId.S, boardSize) },
                };
                var radii = new Dictionary<SeatId, int>
                {
                    { SeatId.N, GameConstants.DefaultCommanderCommandRadius },
                    { SeatId.S, GameConstants.DefaultCommanderCommandRadius },
                };
                return new Options
                {
                    BoardSize = boardSize,
                    RoomCode = roomCode,
                    ObjectiveKeys = new HashSet<string>(),
                    WaterCap = WaterHexCap,
                    Commanders = cmd,
                    CommanderRadii = radii,
                };
            }
        }

        public static Dictionary<string, TerrainKind> GenerateBiomeMap(int boardSize, string roomCode) =>
            GenerateRandomBiomeMap(Options.Default(boardSize, roomCode));

        public const float SharedFavoredPenaltyRate = 0.25f;

        /// <summary>
        /// Favored-biome share of the board allocated to each player.
        /// Remainder is the random land-biome slice (water still soft-capped separately).
        /// 2p: 20%×2 → 60% random · 3p: 20%×3 → 40% random · 4p: 15%×4 → 40% random.
        /// </summary>
        public static float PerPlayerBoardShare(int playerCount) => playerCount switch
        {
            2 => 0.20f,
            3 => 0.20f,
            4 => 0.15f,
            _ => 0.20f,
        };

        public readonly struct PlayerMapMix
        {
            public Dictionary<TerrainKind, float> Favored { get; }
            public float Random { get; }

            public PlayerMapMix(Dictionary<TerrainKind, float> favored, float random)
            {
                Favored = favored;
                Random = random;
            }
        }

        /// <summary>
        /// Per-player board share (2p=30%, 3p=25%, 4p=20%) with duplicate-kind penalty:
        /// when 2+ players share a favored terrain, 25% of that kind's combined share moves to random.
        /// </summary>
        public static PlayerMapMix BuildPlayerFavoredWeights(IReadOnlyList<TerrainKind> playerFavored)
        {
            var playerCount = Math.Max(1, playerFavored?.Count ?? 0);
            if (playerFavored == null || playerFavored.Count == 0)
                return DefaultPlayerMapMix(playerCount);

            var share = PerPlayerBoardShare(playerCount);
            var baseRandom = Math.Max(0f, 1f - share * playerCount);

            var raw = new Dictionary<TerrainKind, float>();
            var playersPerKind = new Dictionary<TerrainKind, int>();
            foreach (var kind in playerFavored)
            {
                raw[kind] = raw.GetValueOrDefault(kind) + share;
                playersPerKind[kind] = playersPerKind.GetValueOrDefault(kind) + 1;
            }

            var favored = new Dictionary<TerrainKind, float>();
            var randomBonus = 0f;
            foreach (var kv in raw)
            {
                var amount = kv.Value;
                if (playersPerKind[kv.Key] >= 2)
                {
                    var penalty = amount * SharedFavoredPenaltyRate;
                    amount -= penalty;
                    randomBonus += penalty;
                }
                if (amount > 0f)
                    favored[kv.Key] = amount;
            }

            return new PlayerMapMix(favored, baseRandom + randomBonus);
        }

        static PlayerMapMix DefaultPlayerMapMix(int playerCount)
        {
            var share = PerPlayerBoardShare(playerCount);
            var random = Math.Max(0f, 1f - share * playerCount);
            return new PlayerMapMix(
                new Dictionary<TerrainKind, float>
                {
                    { TerrainKind.Plains, share * playerCount * 0.5f },
                    { TerrainKind.Forest, share * playerCount * 0.5f },
                },
                random);
        }

        /// <summary>Normalized favored-terrain weights from deploy-bucket cards (legacy card-count mix).</summary>
        public static Dictionary<TerrainKind, float> BuildFavoredWeightsFromCards(
            IEnumerable<CardDefinition> cards)
        {
            var counts = new Dictionary<TerrainKind, int>();
            var total = 0;
            if (cards != null)
            {
                foreach (var card in cards)
                {
                    if (card == null) continue;
                    var kind = FavoredTerrain.PrimaryKindForCard(card);
                    counts[kind] = counts.GetValueOrDefault(kind) + 1;
                    total++;
                }
            }
            if (total == 0)
            {
                return new Dictionary<TerrainKind, float>
                {
                    { TerrainKind.Plains, 0.34f },
                    { TerrainKind.Forest, 0.22f },
                    { TerrainKind.Mountains, 0.16f },
                    { TerrainKind.Swamp, 0.12f },
                    { TerrainKind.Desert, 0.08f },
                    { TerrainKind.Volcanic, 0.08f },
                };
            }
            var weights = new Dictionary<TerrainKind, float>();
            foreach (var kv in counts)
                weights[kv.Key] = kv.Value / (float)total;
            return weights;
        }

        /// <summary>
        /// Army-driven map: favored terrain fractions + random land-biome slice.
        /// </summary>
        public static Dictionary<string, TerrainKind> GenerateArmyWeightedBiomeMap(
            Options opts,
            Dictionary<TerrainKind, float> favoredWeights,
            float randomFraction = 0.40f)
        {
            var boardSize = opts.BoardSize;
            var objectiveKeys = opts.ObjectiveKeys ?? new HashSet<string>();
            favoredWeights ??= new Dictionary<TerrainKind, float>();
            randomFraction = Math.Clamp(randomFraction, 0f, 1f);
            if (favoredWeights.Count == 0)
            {
                var fallback = DefaultPlayerMapMix(2);
                favoredWeights = fallback.Favored;
                randomFraction = fallback.Random;
            }

            var seed = SeededRng.SeedFromRoomCode(opts.RoomCode, "army-map");
            var rng = new SeededRng(seed);

            var randomPool = LandBiomes.ToList();

            var hexKeys = new List<string>();
            for (var col = 0; col < boardSize; col++)
            for (var row = 0; row < boardSize; row++)
            {
                var key = HexMath.Key(col, row);
                if (objectiveKeys.Contains(key)) continue;
                hexKeys.Add(key);
            }
            rng.Shuffle(hexKeys);

            var terrain = new Dictionary<string, TerrainKind>();
            foreach (var ok in objectiveKeys)
                terrain[ok] = TerrainKind.Plains;

            var randomCount = (int)Math.Round(hexKeys.Count * randomFraction);
            randomCount = Math.Clamp(randomCount, 0, hexKeys.Count);
            var favoredCount = hexKeys.Count - randomCount;

            var favoredKinds = favoredWeights.Keys.ToList();
            var cumulative = new List<(TerrainKind kind, float threshold)>();
            var sum = 0f;
            foreach (var kind in favoredKinds)
            {
                sum += favoredWeights[kind];
                cumulative.Add((kind, sum));
            }
            if (sum <= 0f) sum = 1f;

            TerrainKind PickFavored()
            {
                var roll = rng.NextFloat() * sum;
                foreach (var (kind, threshold) in cumulative)
                {
                    if (roll <= threshold) return kind;
                }
                return favoredKinds[^1];
            }

            TerrainKind PickRandom() =>
                randomPool[rng.NextInt(randomPool.Count)];

            for (var i = 0; i < hexKeys.Count; i++)
                terrain[hexKeys[i]] = i < favoredCount ? PickFavored() : PickRandom();

            var tempAt = new Dictionary<string, float>();
            var moistAt = new Dictionary<string, float>();
            foreach (var key in terrain.Keys)
            {
                tempAt[key] = 0.5f;
                moistAt[key] = 0.5f;
            }

            BreakUpFlatBiomes(terrain, boardSize, seed, objectiveKeys);
            CoalesceIsolates(terrain, boardSize, objectiveKeys, 2);
            CoalesceIsolates(terrain, boardSize, objectiveKeys, 1);
            LimitCrWater(terrain, boardSize, objectiveKeys, opts.Commanders, opts.CommanderRadii, tempAt, moistAt, rng);
            RepairConnectivity(terrain, boardSize, objectiveKeys, opts.Commanders, opts.CommanderRadii, rng);

            if (opts.Commanders != null)
            {
                foreach (var cmd in opts.Commanders.Values)
                {
                    var key = HexMath.Key(cmd.Col, cmd.Row);
                    terrain[key] = TerrainKind.Plains;
                }
            }

            return terrain;
        }

        public static Dictionary<string, TerrainKind> GenerateRandomBiomeMap(Options opts)
        {
            var boardSize = opts.BoardSize;
            var objectiveKeys = opts.ObjectiveKeys ?? new HashSet<string>();
            var waterCap = opts.WaterCap > 0 ? opts.WaterCap : WaterHexCap;
            var seed = SeededRng.SeedFromRoomCode(opts.RoomCode);
            var rng = new SeededRng(seed ^ 0x9e3779b9u);

            var climateScale = Math.Max(5.5f, boardSize * 0.26f);
            var moistScale = Math.Max(5f, boardSize * 0.23f);
            var waterScale = Math.Max(4f, boardSize * 0.18f);
            var warpScale = Math.Max(3.5f, boardSize * 0.12f);

            var tempAt = new Dictionary<string, float>();
            var moistAt = new Dictionary<string, float>();
            var terrain = new Dictionary<string, TerrainKind>();

            for (var col = 0; col < boardSize; col++)
            {
                for (var row = 0; row < boardSize; row++)
                {
                    var key = HexMath.Key(col, row);
                    var axial = HexMath.OddRToAxial(col, row);
                    var q = axial.Q;
                    var r = axial.R;
                    var lat = boardSize <= 1 ? 0.5f : row / (float)(boardSize - 1);
                    var warpQ = q + (Fbm(q, r, warpScale, seed + 91, 3) - 0.5f) * 3.2f;
                    var warpR = r + (Fbm(q + 9, r - 5, warpScale, seed + 97, 3) - 0.5f) * 3.2f;
                    var tempNoise = Fbm(warpQ, warpR, climateScale, seed + 11, 4);
                    var moist = Fbm(warpQ, warpR, moistScale, seed + 29, 4) * 0.8f
                                + Fbm(warpQ, warpR, warpScale, seed + 37, 3) * 0.2f;
                    var waterN = Fbm(warpQ + 40, warpR - 17, waterScale, seed + 47, 3);
                    var ridge = Fbm(warpQ * 0.7f, warpR * 0.7f, climateScale * 0.55f, seed + 71, 3);
                    var microT = (ValueNoise(q, r, 3.2f, seed + 113) - 0.5f) * 0.06f;
                    var microM = (ValueNoise(q, r, 3.0f, seed + 127) - 0.5f) * 0.07f;
                    var temp = Math.Clamp(tempNoise * 0.5f + lat * 0.48f + (ridge - 0.5f) * 0.2f + microT, 0f, 1f);
                    var moistClamped = Math.Clamp(moist + microM, 0f, 1f);
                    tempAt[key] = temp;
                    moistAt[key] = moistClamped;

                    if (objectiveKeys.Contains(key))
                    {
                        terrain[key] = TerrainKind.Plains;
                        continue;
                    }

                    var waterThresh = 0.66f - moistClamped * 0.06f;
                    terrain[key] = waterN > waterThresh && ridge > 0.36f
                        ? TerrainKind.Water
                        : BiomeFromClimate(temp, moistClamped);
                }
            }

            BreakUpFlatBiomes(terrain, boardSize, seed, objectiveKeys);
            CoalesceIsolates(terrain, boardSize, objectiveKeys, 2);
            SprinkleExtraPonds(terrain, boardSize, seed, objectiveKeys, moistAt, waterCap, rng);
            CoalesceIsolates(terrain, boardSize, objectiveKeys, 1);
            EnforceWaterCap(terrain, objectiveKeys, tempAt, moistAt, waterCap, rng);
            LimitCrWater(terrain, boardSize, objectiveKeys, opts.Commanders, opts.CommanderRadii, tempAt, moistAt, rng);
            RepairConnectivity(terrain, boardSize, objectiveKeys, opts.Commanders, opts.CommanderRadii, rng);

            return terrain;
        }

        public static int CountWaterHexes(Dictionary<string, TerrainKind> terrain)
        {
            var n = 0;
            foreach (var kind in terrain.Values)
                if (kind == TerrainKind.Water) n++;
            return n;
        }

        static void BreakUpFlatBiomes(
            Dictionary<string, TerrainKind> terrain,
            int boardSize,
            uint seed,
            HashSet<string> objectiveKeys)
        {
            var pocketScale = Math.Max(4.2f, boardSize * 0.16f);

            for (var col = 0; col < boardSize; col++)
            {
                for (var row = 0; row < boardSize; row++)
                {
                    var key = HexMath.Key(col, row);
                    if (objectiveKeys.Contains(key)) continue;
                    if (!terrain.TryGetValue(key, out var kind)) continue;
                    if (kind == TerrainKind.Water || kind == TerrainKind.Wall) continue;
                    if (!BiomeVariants.TryGetValue(kind, out var variants) || variants.Length == 0) continue;

                    var cell = new HexCoord(col, row);
                    var same = 0;
                    var neigh = 0;
                    foreach (var n in HexMath.Neighbors(cell))
                    {
                        if (!HexMath.InBounds(n, boardSize)) continue;
                        neigh++;
                        if (terrain.TryGetValue(HexMath.Key(n.Col, n.Row), out var nk) && nk == kind) same++;
                    }
                    if (neigh < 4 || same < neigh - 1) continue;

                    var axial = HexMath.OddRToAxial(col, row);
                    var pocket = Fbm(axial.Q, axial.R, pocketScale, seed + 211, 3);
                    if (pocket <= 0.66f) continue;
                    var micro = Hash2(col * 3 + 1, row * 5 + 2, seed + 419);
                    terrain[key] = variants[(int)(micro * variants.Length) % variants.Length];
                }
            }
        }

        static void CoalesceIsolates(
            Dictionary<string, TerrainKind> terrain,
            int boardSize,
            HashSet<string> objectiveKeys,
            int passes)
        {
            for (var pass = 0; pass < passes; pass++)
            {
                var updates = new List<(string Key, TerrainKind Kind)>();
                for (var col = 0; col < boardSize; col++)
                {
                    for (var row = 0; row < boardSize; row++)
                    {
                        var key = HexMath.Key(col, row);
                        if (objectiveKeys.Contains(key)) continue;
                        if (!terrain.TryGetValue(key, out var kind)) continue;
                        if (kind == TerrainKind.Wall) continue;

                        var counts = new Dictionary<TerrainKind, int>();
                        var neigh = 0;
                        var same = 0;
                        foreach (var n in HexMath.Neighbors(new HexCoord(col, row)))
                        {
                            if (!HexMath.InBounds(n, boardSize)) continue;
                            if (!terrain.TryGetValue(HexMath.Key(n.Col, n.Row), out var nk)) continue;
                            if (nk == TerrainKind.Wall) continue;
                            neigh++;
                            if (nk == kind) same++;
                            counts[nk] = counts.GetValueOrDefault(nk) + 1;
                        }
                        if (neigh < 3 || same > 0) continue;

                        TerrainKind? best = null;
                        var bestN = 0;
                        foreach (var kv in counts)
                        {
                            if (kv.Value > bestN)
                            {
                                best = kv.Key;
                                bestN = kv.Value;
                            }
                        }
                        if (best.HasValue && best.Value != kind && bestN >= 2)
                            updates.Add((key, best.Value));
                    }
                }
                foreach (var u in updates) terrain[u.Key] = u.Kind;
            }
        }

        static void SprinkleExtraPonds(
            Dictionary<string, TerrainKind> terrain,
            int boardSize,
            uint seed,
            HashSet<string> objectiveKeys,
            Dictionary<string, float> moistAt,
            int waterCap,
            SeededRng rng)
        {
            var waterCount = CountWaterHexes(terrain);
            var target = Math.Min(waterCap, Math.Max(waterCount, (int)Math.Floor(waterCap * 0.88f)));
            if (waterCount >= target) return;

            bool CanPaint(HexCoord cell)
            {
                if (!HexMath.InBounds(cell, boardSize)) return false;
                var key = HexMath.Key(cell.Col, cell.Row);
                if (objectiveKeys.Contains(key)) return false;
                if (!terrain.TryGetValue(key, out var kind)) return false;
                return kind != TerrainKind.Water && kind != TerrainKind.Wall;
            }

            var pondScale = Math.Max(3.5f, boardSize * 0.14f);
            var candidates = new List<(int Col, int Row, float Score)>();
            for (var col = 0; col < boardSize; col++)
            {
                for (var row = 0; row < boardSize; row++)
                {
                    var cell = new HexCoord(col, row);
                    if (!CanPaint(cell)) continue;
                    var key = HexMath.Key(col, row);
                    var axial = HexMath.OddRToAxial(col, row);
                    var pondN = Fbm(axial.Q - 13, axial.R + 21, pondScale, seed + 503, 3);
                    var moist = moistAt.GetValueOrDefault(key, 0.5f);
                    if (pondN < 0.64f) continue;
                    candidates.Add((col, row, pondN * 0.7f + moist * 0.3f + rng.NextFloat() * 0.04f));
                }
            }
            candidates.Sort((a, b) => b.Score.CompareTo(a.Score));

            foreach (var c in candidates)
            {
                if (waterCount >= target) break;
                var seedCell = new HexCoord(c.Col, c.Row);
                var blobTarget = 3 + rng.NextInt(3);
                var queue = new Queue<HexCoord>();
                queue.Enqueue(seedCell);
                var painted = new HashSet<string>();

                while (queue.Count > 0 && painted.Count < blobTarget && waterCount < target)
                {
                    var cur = queue.Dequeue();
                    var key = HexMath.Key(cur.Col, cur.Row);
                    if (painted.Contains(key)) continue;
                    if (!CanPaint(cur) && (!terrain.TryGetValue(key, out var existing) || existing != TerrainKind.Water))
                        continue;

                    if (terrain.TryGetValue(key, out var curKind) && curKind != TerrainKind.Water)
                    {
                        terrain[key] = TerrainKind.Water;
                        waterCount++;
                    }
                    painted.Add(key);

                    var nbs = HexMath.Neighbors(cur)
                        .Where(n => CanPaint(n) || (terrain.TryGetValue(HexMath.Key(n.Col, n.Row), out var nk) && nk == TerrainKind.Water))
                        .ToList();
                    for (var i = nbs.Count - 1; i > 0; i--)
                    {
                        var j = rng.NextInt(i + 1);
                        (nbs[i], nbs[j]) = (nbs[j], nbs[i]);
                    }
                    foreach (var n in nbs.Take(2)) queue.Enqueue(n);
                }
            }
        }

        static void LimitCrWater(
            Dictionary<string, TerrainKind> terrain,
            int boardSize,
            HashSet<string> objectiveKeys,
            Dictionary<SeatId, HexCoord> commanders,
            Dictionary<SeatId, int> commanderRadii,
            Dictionary<string, float> tempAt,
            Dictionary<string, float> moistAt,
            SeededRng rng)
        {
            if (commanders == null || commanders.Count == 0) return;

            foreach (var kv in commanders)
            {
                var seat = kv.Key;
                var origin = kv.Value;
                var radius = commanderRadii != null && commanderRadii.TryGetValue(seat, out var r)
                    ? r
                    : GameConstants.DefaultCommanderCommandRadius;
                var crKeys = CommandRadiusKeys(origin, radius, boardSize);
                var maxWater = Math.Max(0, Math.Min(
                    CrWaterAbsoluteMax,
                    (int)Math.Floor(crKeys.Count * CrWaterFractionCap)));

                var waterInCr = crKeys.Where(k => terrain.TryGetValue(k, out var t) && t == TerrainKind.Water).ToList();
                if (waterInCr.Count <= maxWater) continue;

                waterInCr.Sort((a, b) =>
                {
                    var ac = HexMath.ParseKey(a);
                    var bc = HexMath.ParseKey(b);
                    var da = Math.Abs(ac.Col - origin.Col) + Math.Abs(ac.Row - origin.Row);
                    var db = Math.Abs(bc.Col - origin.Col) + Math.Abs(bc.Row - origin.Row);
                    return db != da ? db.CompareTo(da) : (rng.NextFloat() < 0.5f ? -1 : 1);
                });

                var keep = maxWater;
                foreach (var key in waterInCr)
                {
                    if (keep > 0) { keep--; continue; }
                    if (objectiveKeys.Contains(key)) continue;
                    terrain[key] = PickLandReplacement(
                        tempAt.GetValueOrDefault(key, 0.5f),
                        moistAt.GetValueOrDefault(key, 0.5f),
                        rng);
                }

                var cmdKey = HexMath.Key(origin.Col, origin.Row);
                if (TerrainConnectivity.IsImpassable(terrain.GetValueOrDefault(cmdKey)))
                    terrain[cmdKey] = TerrainKind.Plains;
            }
        }

        static void RepairConnectivity(
            Dictionary<string, TerrainKind> terrain,
            int boardSize,
            HashSet<string> objectiveKeys,
            Dictionary<SeatId, HexCoord> commanders,
            Dictionary<SeatId, int> commanderRadii,
            SeededRng rng)
        {
            if (commanders == null || commanders.Count == 0) return;

            var commanderList = commanders.Values.ToList();
            var objectiveHexes = objectiveKeys.Select(HexMath.ParseKey).ToList();

            void FixWaterNear(HexCoord cell)
            {
                var key = HexMath.Key(cell.Col, cell.Row);
                if (terrain.GetValueOrDefault(key) == TerrainKind.Water)
                    terrain[key] = TerrainKind.Plains;
                foreach (var n in HexMath.Neighbors(cell))
                {
                    if (!HexMath.InBounds(n, boardSize)) continue;
                    var nk = HexMath.Key(n.Col, n.Row);
                    if (terrain.GetValueOrDefault(nk) == TerrainKind.Water && rng.NextFloat() < 0.55f)
                        terrain[nk] = TerrainKind.Plains;
                }
            }

            for (var pass = 0; pass < 8; pass++)
            {
                var ok = true;
                foreach (var kv in commanders)
                {
                    var origin = kv.Value;
                    var radius = commanderRadii != null && commanderRadii.TryGetValue(kv.Key, out var r)
                        ? r
                        : GameConstants.DefaultCommanderCommandRadius;
                    var cr = CommandRadiusKeys(origin, radius, boardSize);
                    if (!TerrainConnectivity.CommanderHasEscapePath(origin, terrain, boardSize, cr))
                    {
                        ok = false;
                        FixWaterNear(origin);
                        var mid = GameConstants.BoardMid(boardSize);
                        var cur = origin;
                        for (var step = 0; step < radius + 3; step++)
                        {
                            HexCoord? next = null;
                            var bestDist = int.MaxValue;
                            foreach (var n in HexMath.Neighbors(cur))
                            {
                                if (!HexMath.InBounds(n, boardSize)) continue;
                                var d = Math.Abs(n.Col - mid) + Math.Abs(n.Row - mid);
                                if (d < bestDist) { bestDist = d; next = n; }
                            }
                            if (!next.HasValue) break;
                            var nk = HexMath.Key(next.Value.Col, next.Value.Row);
                            if (terrain.GetValueOrDefault(nk) == TerrainKind.Water)
                                terrain[nk] = TerrainKind.Plains;
                            cur = next.Value;
                            if (!cr.Contains(nk)) break;
                        }
                    }
                }

                if (!TerrainConnectivity.SetupStayConnected(commanderList, objectiveHexes, terrain, boardSize))
                {
                    ok = false;
                    foreach (var key in terrain.Keys.ToList())
                    {
                        if (terrain[key] == TerrainKind.Water && rng.NextFloat() < 0.12f)
                            terrain[key] = TerrainKind.Plains;
                    }
                }
                if (ok) break;
            }

            foreach (var origin in commanderList)
            {
                var key = HexMath.Key(origin.Col, origin.Row);
                if (TerrainConnectivity.IsImpassable(terrain.GetValueOrDefault(key)))
                    terrain[key] = TerrainKind.Plains;
            }
        }

        static HashSet<string> CommandRadiusKeys(HexCoord origin, int radius, int boardSize)
        {
            var keys = new HashSet<string>();
            for (var col = 0; col < boardSize; col++)
            for (var row = 0; row < boardSize; row++)
            {
                var cell = new HexCoord(col, row);
                if (HexMath.Distance(origin, cell) <= radius)
                    keys.Add(HexMath.Key(col, row));
            }
            return keys;
        }

        static void EnforceWaterCap(
            Dictionary<string, TerrainKind> terrain,
            HashSet<string> objectiveKeys,
            Dictionary<string, float> tempAt,
            Dictionary<string, float> moistAt,
            int waterCap,
            SeededRng rng)
        {
            var waterCount = CountWaterHexes(terrain);
            if (waterCount <= waterCap) return;

            var waterKeys = terrain.Where(kv => kv.Value == TerrainKind.Water).Select(kv => kv.Key).ToList();
            rng.Shuffle(waterKeys);
            foreach (var key in waterKeys)
            {
                if (waterCount <= waterCap) break;
                if (objectiveKeys.Contains(key)) continue;
                terrain[key] = PickLandReplacement(
                    tempAt.GetValueOrDefault(key, 0.5f),
                    moistAt.GetValueOrDefault(key, 0.5f),
                    rng);
                waterCount--;
            }
        }

        static TerrainKind PickLandReplacement(float temp, float moist, SeededRng rng)
        {
            var baseKind = BiomeFromClimate(temp, moist);
            if (baseKind != TerrainKind.Water && Array.IndexOf(LandBiomes, baseKind) >= 0) return baseKind;
            return rng.NextFloat() < 0.5f ? TerrainKind.Plains : TerrainKind.Forest;
        }

        static TerrainKind BiomeFromClimate(float temp, float moist)
        {
            if (temp < 0.34f)
            {
                if (moist < 0.42f) return TerrainKind.Mountains;
                if (moist > 0.68f) return TerrainKind.Swamp;
                return moist < 0.55f ? TerrainKind.Forest : TerrainKind.Plains;
            }
            if (temp > 0.64f)
            {
                if (moist < 0.38f) return TerrainKind.Desert;
                if (moist > 0.66f) return TerrainKind.Swamp;
                return TerrainKind.Volcanic;
            }
            if (moist < 0.38f) return TerrainKind.Plains;
            if (moist < 0.5f) return TerrainKind.Forest;
            if (moist > 0.74f) return TerrainKind.Swamp;
            return moist < 0.62f ? TerrainKind.Forest : TerrainKind.Plains;
        }

        static float Fade(float t) => t * t * (3f - 2f * t);

        static float Hash2(int ix, int iy, uint seed)
        {
            unchecked
            {
                var n = (int)(ix * 374761393 + iy * 668265263) + (int)seed;
                n = (int)(((uint)n ^ ((uint)n >> 13)) & 0xFFFFFFFF);
                n = (int)((uint)n * 1274126177u);
                return (((uint)n ^ ((uint)n >> 16)) & 0xFFFFFFFFu) / 4294967296f;
            }
        }

        static float ValueNoise(float q, float r, float scale, uint seed)
        {
            var x = q / scale;
            var y = r / scale;
            var x0 = (int)MathF.Floor(x);
            var y0 = (int)MathF.Floor(y);
            var fx = Fade(x - x0);
            var fy = Fade(y - y0);
            var v00 = Hash2(x0, y0, seed);
            var v10 = Hash2(x0 + 1, y0, seed);
            var v01 = Hash2(x0, y0 + 1, seed);
            var v11 = Hash2(x0 + 1, y0 + 1, seed);
            return Lerp(Lerp(v00, v10, fx), Lerp(v01, v11, fx), fy);
        }

        static float Lerp(float a, float b, float t) => a + (b - a) * t;

        static float Fbm(float q, float r, float scale, uint seed, int octaves)
        {
            var amp = 1f;
            var freq = 1f;
            var sum = 0f;
            var norm = 0f;
            for (var i = 0; i < octaves; i++)
            {
                sum += amp * ValueNoise(q * freq, r * freq, scale, seed + (uint)(i * 1013));
                norm += amp;
                amp *= 0.5f;
                freq *= 2f;
            }
            return sum / norm;
        }

        /// <summary>Square corner wedges used for default (player-built center) maps.</summary>
        public static bool IsCornerTerrainHex(int col, int row, int boardSize)
        {
            var span = Math.Max(6, (int)Math.Round(boardSize * 0.26));
            var left = col < span;
            var right = col >= boardSize - span;
            var top = row < span;
            var bottom = row >= boardSize - span;
            return (left && top) || (left && bottom) || (right && top) || (right && bottom);
        }

        /// <summary>
        /// Random biomes in the four corners only. Center and edge CRs stay empty so
        /// players can flood command zones and drop land in the middle.
        /// </summary>
        public static Dictionary<string, TerrainKind> GenerateCornerBiomeMap(Options opts)
        {
            var full = GenerateRandomBiomeMap(opts);
            var boardSize = opts.BoardSize;
            var objectiveKeys = opts.ObjectiveKeys ?? new HashSet<string>();
            var crKeys = new HashSet<string>();
            if (opts.Commanders != null)
            {
                foreach (var kv in opts.Commanders)
                {
                    var radius = opts.CommanderRadii != null && opts.CommanderRadii.TryGetValue(kv.Key, out var r)
                        ? r
                        : GameConstants.DefaultCommanderCommandRadius;
                    foreach (var key in CommandRadiusKeys(kv.Value, radius, boardSize))
                        crKeys.Add(key);
                }
            }

            var next = new Dictionary<string, TerrainKind>();
            foreach (var kv in full)
            {
                if (objectiveKeys.Contains(kv.Key) || crKeys.Contains(kv.Key)) continue;
                var coord = HexMath.ParseKey(kv.Key);
                if (!IsCornerTerrainHex(coord.Col, coord.Row, boardSize)) continue;
                next[kv.Key] = kv.Value;
            }
            return next;
        }
    }
}
