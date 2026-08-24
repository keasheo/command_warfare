using System.Collections.Generic;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Data;
using UnityEngine;
using UnityEngine.Rendering;

namespace CommandWarfare.Core.Util
{
    public static class TerrainMaterialFactory
    {
        static Material _cached;
        static Shader _resolved;
        static readonly Dictionary<string, Material> _terrainCache = new();
        static readonly Dictionary<string, Material> _blendCache = new();

        public static Material CreateDefault()
        {
            if (_cached != null) return _cached;
            _cached = new Material(ResolveShader());
            ApplySurfaceDefaults(_cached, 0.15f, 0f);
            return _cached;
        }

        public static Material CreateTileInstance(Color color) =>
            CreateTileInstance(color, null, 1f, 0.15f, 0f, Color.black);

        public static Material CreateTileInstance(
            Color color,
            Texture2D albedo,
            float tiling,
            float smoothness,
            float metallic,
            Color emission)
        {
            var mat = new Material(ResolveShader());
            ApplySurfaceDefaults(mat, smoothness, metallic);
            ApplyColor(mat, color);
            ApplyAlbedo(mat, albedo, tiling);
            ApplyEmission(mat, emission);
            return mat;
        }

        /// <summary>Glassy translucent pool surface — reads as water, not a blue land tile.</summary>
        public static Material CreateWaterMaterial(Color baseColor)
        {
            var deep = Color.Lerp(baseColor, new Color(0.05f, 0.22f, 0.38f, 1f), 0.35f);
            deep.a = 0.72f;
            var mat = CreateTileInstance(
                deep,
                null,
                1f,
                smoothness: 0.92f,
                metallic: 0.18f,
                emission: new Color(0.04f, 0.12f, 0.18f));
            ApplyTransparentSurface(mat);
            // Specular bounce — helps URP Lit read wet.
            if (mat.HasProperty("_SpecularHighlights"))
                mat.SetFloat("_SpecularHighlights", 1f);
            if (mat.HasProperty("_EnvironmentReflections"))
                mat.SetFloat("_EnvironmentReflections", 1f);
            return mat;
        }

        /// <summary>Soft white foam for shore lips.</summary>
        public static Material CreateWaterFoam(float opacity = 0.45f)
        {
            var key = $"waterfoam:{Mathf.RoundToInt(opacity * 20f)}";
            if (_blendCache.TryGetValue(key, out var cached) && cached != null)
                return cached;
            var col = new Color(0.92f, 0.97f, 1f, Mathf.Clamp01(opacity));
            var mat = CreateTileInstance(col, null, 1f, 0.55f, 0.02f, new Color(0.08f, 0.1f, 0.12f));
            ApplyTransparentSurface(mat);
            _blendCache[key] = mat;
            return mat;
        }

        /// <summary>Per-hex terrain look: catalog material/texture, else richer procedural fallback.</summary>
        public static Material CreateForTerrain(
            TerrainKind kind,
            int variant,
            TerrainAssetCatalog catalog) =>
            CreateForTerrain(kind, variant, catalog, Vector2.zero, 0f);

        /// <summary>
        /// Per-hex terrain look with UV phase jitter so adjacent same-biome tiles do not stamp-repeat.
        /// </summary>
        public static Material CreateForTerrain(
            TerrainKind kind,
            int variant,
            TerrainAssetCatalog catalog,
            Vector2 uvOffset,
            float uvRotationDegrees)
        {
            var color = TerrainVisuals.BaseColor(kind, variant);
            var look = SurfaceLook(kind);
            var hasJitter = uvOffset.sqrMagnitude > 0.0001f || Mathf.Abs(uvRotationDegrees) > 0.01f;

            // Water: always use procedural glassy pool mat (catalog dirt albedos break the look).
            if (kind == TerrainKind.Water)
            {
                const string waterKey = "water:glass:v2";
                if (!hasJitter && _terrainCache.TryGetValue(waterKey, out var waterCached) && waterCached != null)
                    return waterCached;
                var waterMat = CreateWaterMaterial(color);
                if (!hasJitter) _terrainCache[waterKey] = waterMat;
                return waterMat;
            }

            var overrideMat = catalog?.MaterialFor(kind);
            if (overrideMat != null)
            {
                var inst = new Material(overrideMat);
                if (inst.HasProperty("_BaseColor"))
                {
                    var baseCol = inst.GetColor("_BaseColor");
                    inst.SetColor("_BaseColor", Color.Lerp(baseCol, color, 0.2f));
                }
                if (hasJitter) ApplyUvTransform(inst, uvOffset, uvRotationDegrees);
                return inst;
            }

            var albedo = catalog?.AlbedoFor(kind);
            if (kind == TerrainKind.Volcanic)
            {
                // Mild warm emission so red/orange crack lines in the albedo read as lava veins.
                var molten = (variant % 5) / 4f;
                look.Emission = Color.Lerp(
                    new Color(0.08f, 0.02f, 0.005f),
                    new Color(0.22f, 0.06f, 0.015f),
                    molten);
            }

            // When an authored albedo drives the look, keep BaseColor near-white so
            // texture detail (mountain green/brown, volcanic cracks) is not crushed.
            if (albedo != null && kind is TerrainKind.Volcanic or TerrainKind.Mountains)
                color = Color.Lerp(Color.white, color, kind == TerrainKind.Volcanic ? 0.12f : 0.28f);

            // World-UV meshes already encode scale — keep material tiling near 1 so sheets stay continuous.
            var tiling = 1f;

            if (!hasJitter)
            {
                var cacheKey = $"{kind}:{variant}:{(albedo != null ? albedo.GetInstanceID() : 0)}:{tiling:F2}";
                if (_terrainCache.TryGetValue(cacheKey, out var cached) && cached != null)
                    return cached;

                var shared = CreateTileInstance(color, albedo, tiling, look.Smoothness, look.Metallic, look.Emission);
                _terrainCache[cacheKey] = shared;
                return shared;
            }

            var mat = CreateTileInstance(color, albedo, tiling, look.Smoothness, look.Metallic, look.Emission);
            ApplyUvTransform(mat, uvOffset, uvRotationDegrees);
            return mat;
        }

        /// <summary>
        /// Multi-step biome feather with per-pair character.
        /// Strength 0→1 maps to: inner (self-dominant), mid (transitional), outer lip (neighbor-dominant).
        /// Uses non-linear curves so edges fade like real terrain, not hard rings.
        /// </summary>
        public static Material CreateBlendOverlay(
            TerrainKind neighbor,
            TerrainKind self,
            int variant,
            TerrainAssetCatalog catalog,
            float strength)
        {
            var s = Mathf.Clamp01(strength);
            var quant = Mathf.RoundToInt(s * 20f);
            var cacheKey = $"blend2:{neighbor}:{self}:{variant}:{quant}";
            if (_blendCache.TryGetValue(cacheKey, out var cached) && cached != null)
                return cached;

            var neighborCol = TerrainVisuals.BaseColor(neighbor, variant);
            var selfCol = TerrainVisuals.BaseColor(self, variant);

            // Per-pair character: compute transition color with biome-specific logic
            var pairProfile = BiomePairProfile(self, neighbor, s);
            var blended = ComputePairBlend(selfCol, neighborCol, s, pairProfile);
            blended.a = 1f;

            // Blend surface properties non-linearly: outer lip inherits more neighbor character
            var selfLook = SurfaceLook(self);
            var neighborLook = SurfaceLook(neighbor);
            var surfaceT = pairProfile.SurfaceCurve(s);
            var smoothness = Mathf.Lerp(selfLook.Smoothness, neighborLook.Smoothness, surfaceT);
            var metallic = Mathf.Lerp(selfLook.Metallic, neighborLook.Metallic, surfaceT * 0.7f);

            // Per-pair surface tweaks
            smoothness = Mathf.Clamp01(smoothness + pairProfile.SmoothnessOffset);
            metallic = Mathf.Clamp01(metallic + pairProfile.MetallicOffset);

            // Color-only feather (no albedo stamp) so bleed stays smooth across the lip.
            Texture2D albedo = null;

            // Emission: volcanic bleeds glow, water adds subtle caustic hint
            var emission = ComputePairEmission(self, neighbor, selfLook, neighborLook, s, pairProfile);

            // Keep tiling at 1 — blend meshes carry world UVs; avoid remapping stamps.
            var tiling = 1f;

            var mat = CreateTileInstance(blended, albedo, tiling, smoothness, metallic, emission);
            _blendCache[cacheKey] = mat;
            return mat;
        }

        /// <summary>
        /// Soft ambient-occlusion-style depth shadow at biome boundaries.
        /// Not a hard outline — reads as natural shadow in terrain folds, not hex edges.
        /// Per-pair character: water gets wet darkening, wall gets mortar gray, etc.
        /// </summary>
        public static Material CreateSeamRim(
            TerrainKind self,
            TerrainKind neighbor,
            int variant,
            float strength)
        {
            var s = Mathf.Clamp01(strength);
            var quant = Mathf.RoundToInt(s * 20f);
            var cacheKey = $"seam2:{self}:{neighbor}:{variant}:{quant}";
            if (_blendCache.TryGetValue(cacheKey, out var cached) && cached != null)
                return cached;

            var a = TerrainVisuals.BaseColor(self, variant);
            var b = TerrainVisuals.BaseColor(neighbor, variant);

            // Soft AO shadow: desaturate + darken toward pair's "ground truth"
            var mid = Color.Lerp(a, b, 0.45f);
            Color seam;

            // Per-pair seam character
            var hasWater = self == TerrainKind.Water || neighbor == TerrainKind.Water;
            var hasWall = self == TerrainKind.Wall || neighbor == TerrainKind.Wall;
            var hasVolcanic = self == TerrainKind.Volcanic || neighbor == TerrainKind.Volcanic;

            if (hasWater)
            {
                // Wet sediment shadow: cool blue-gray, glossy
                var wet = new Color(mid.r * 0.45f, mid.g * 0.48f, mid.b * 0.55f, 1f);
                seam = Color.Lerp(mid * 0.6f, wet, s * 0.8f);
            }
            else if (hasWall)
            {
                // Mortar/stone dust: neutral gray, slightly rough
                var mortar = new Color(
                    mid.r * 0.5f + 0.12f,
                    mid.g * 0.5f + 0.11f,
                    mid.b * 0.5f + 0.10f, 1f);
                seam = Color.Lerp(mid * 0.65f, mortar, s * 0.7f);
            }
            else if (hasVolcanic)
            {
                // Ash/char: very dark, warm undertone
                var ash = new Color(mid.r * 0.25f + 0.02f, mid.g * 0.2f, mid.b * 0.18f, 1f);
                seam = Color.Lerp(mid * 0.4f, ash, s * 0.85f);
            }
            else
            {
                // Generic organic shadow: warm earth tone, subtle
                var earth = new Color(
                    mid.r * 0.52f + 0.03f,
                    mid.g * 0.48f + 0.02f,
                    mid.b * 0.42f + 0.01f, 1f);
                seam = Color.Lerp(mid * 0.65f, earth, s * 0.6f);
            }

            // Surface: seams are rougher (lower smoothness) to catch light differently
            var baseSmoothness = hasWater ? 0.35f : (hasWall ? 0.18f : 0.10f);
            var baseMetallic = hasWall ? 0.04f : 0.01f;

            // Subtle emission for volcanic seams only
            var emission = hasVolcanic ? new Color(0.015f, 0.004f, 0.002f) * s : Color.black;

            var mat = CreateTileInstance(seam, null, 1f, baseSmoothness, baseMetallic, emission);
            _blendCache[cacheKey] = mat;
            return mat;
        }

        /// <summary>
        /// Returns recommended blend ring strengths for multi-step fade geometry.
        /// Geometry artists: create 3-4 concentric blend meshes using these strengths
        /// to achieve natural forest→desert style transitions without hard bands.
        /// </summary>
        /// <param name="ringCount">Number of blend rings (3-4 recommended).</param>
        /// <returns>Array of strengths from inner (low) to outer lip (high).</returns>
        public static float[] GetBlendRingStrengths(int ringCount = 4)
        {
            if (ringCount < 2) ringCount = 2;
            if (ringCount > 6) ringCount = 6;

            var strengths = new float[ringCount];
            for (int i = 0; i < ringCount; i++)
            {
                // Non-linear distribution: more rings near outer edge where detail matters
                var t = (i + 1f) / ringCount;
                // Ease-in curve: gentle inner rings, accelerating toward lip
                strengths[i] = Mathf.Pow(t, 0.65f);
            }
            return strengths;
        }

        /// <summary>
        /// Maps a normalized distance from hex center (0=center, 1=edge) to blend strength.
        /// Use this for procedural/shader-based blending where you don't use discrete rings.
        /// </summary>
        /// <param name="normalizedDistance">0 at hex center, 1 at hex edge.</param>
        /// <param name="blendStartRadius">Where blending begins (0.5 = halfway to edge).</param>
        /// <returns>Blend strength 0..1 for use with CreateBlendOverlay.</returns>
        public static float DistanceToBlendStrength(float normalizedDistance, float blendStartRadius = 0.55f)
        {
            if (normalizedDistance <= blendStartRadius) return 0f;
            if (normalizedDistance >= 1f) return 1f;

            var t = (normalizedDistance - blendStartRadius) / (1f - blendStartRadius);
            // Smooth-step for natural falloff
            return t * t * (3f - 2f * t);
        }

        /// <summary>Deterministic UV phase from hex coordinates (non-repeating tiles).</summary>
        public static void UvJitterForHex(int col, int row, out Vector2 offset, out float rotationDegrees)
        {
            var h = unchecked(col * 73856093) ^ unchecked(row * 19349663);
            var u = ((h & 0xFFFF) / 65535f);
            var v = (((h >> 16) & 0xFFFF) / 65535f);
            offset = new Vector2(u * 0.85f, v * 0.85f);
            rotationDegrees = (((h >> 8) & 0xFF) / 255f) * 60f - 30f;
        }

        public static void ClearTerrainCache()
        {
            _terrainCache.Clear();
            _blendCache.Clear();
        }

        /// <summary>Force-replace renderers so Asset Store / placeholder mats never stay magenta.</summary>
        public static void RecolorRenderers(GameObject root, Color color)
        {
            if (root == null) return;
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (r == null) continue;
                r.sharedMaterial = CreateTileInstance(color);
            }
        }

        public static void SetMaterialColor(Material mat, Color color)
        {
            if (mat == null) return;
            ApplyColor(mat, color);
        }

        /// <summary>Force URP Lit into transparent alpha blending (for hex highlight overlays).</summary>
        public static void MakeTransparent(Material mat)
        {
            if (mat == null) return;
            ApplyTransparentSurface(mat);
        }

        struct SurfaceProfile
        {
            public float Smoothness;
            public float Metallic;
            public Color Emission;
        }

        /// <summary>
        /// Per-biome-pair transition character: controls how two terrains blend artistically.
        /// </summary>
        struct BiomePairTransition
        {
            /// <summary>Color blend curve exponent: &lt;1 = neighbor bleeds inward faster, &gt;1 = holds self longer.</summary>
            public float ColorCurve;
            /// <summary>Threshold (0..1) where texture swaps from self to neighbor.</summary>
            public float TextureSwapThreshold;
            /// <summary>Additive smoothness offset for transition zone (negative = rougher).</summary>
            public float SmoothnessOffset;
            /// <summary>Additive metallic offset for transition zone.</summary>
            public float MetallicOffset;
            /// <summary>How much tiling varies across the blend (0 = constant).</summary>
            public float TilingVariance;
            /// <summary>Per-pair hue shift applied to blend (subtle character).</summary>
            public Color HueTint;
            /// <summary>Saturation multiplier for transition zone.</summary>
            public float SaturationMult;

            public float SurfaceCurve(float t)
            {
                // Non-linear: surfaces transition faster at edges
                return Mathf.Pow(t, 0.7f);
            }

            public static BiomePairTransition Default()
            {
                return new BiomePairTransition
                {
                    ColorCurve = 1f,
                    TextureSwapThreshold = 0.55f,
                    SmoothnessOffset = 0f,
                    MetallicOffset = 0f,
                    TilingVariance = 0.08f,
                    HueTint = Color.white,
                    SaturationMult = 1f,
                };
            }
        }

        /// <summary>
        /// Returns artistic blend profile for a specific biome pair.
        /// Encodes how forest→desert differs from forest→water, etc.
        /// </summary>
        static BiomePairTransition BiomePairProfile(TerrainKind self, TerrainKind neighbor, float strength)
        {
            var profile = BiomePairTransition.Default();

            // Water adjacency: wet shore effect
            if (neighbor == TerrainKind.Water || self == TerrainKind.Water)
            {
                profile.SmoothnessOffset = 0.15f * strength; // Gets glossier near water
                profile.ColorCurve = 0.6f; // Water bleeds inward (wet soil)
                profile.TextureSwapThreshold = 0.7f; // Hold land texture longer
                profile.HueTint = new Color(0.92f, 0.95f, 1.02f, 1f); // Subtle cool shift
                profile.SaturationMult = 0.85f; // Desaturate near shore
                return profile;
            }

            // Wall adjacency: stone/mortar lip
            if (neighbor == TerrainKind.Wall || self == TerrainKind.Wall)
            {
                profile.SmoothnessOffset = -0.06f; // Rougher mortar zone
                profile.MetallicOffset = 0.03f; // Slight mineral content
                profile.ColorCurve = 1.3f; // Hard material holds edge longer
                profile.TextureSwapThreshold = 0.45f; // Stone shows earlier
                profile.HueTint = new Color(0.97f, 0.96f, 0.95f, 1f); // Dusty neutral
                profile.TilingVariance = 0.04f; // Less variation on stone
                return profile;
            }

            // Volcanic adjacency: ash scatter
            if (neighbor == TerrainKind.Volcanic || self == TerrainKind.Volcanic)
            {
                profile.SmoothnessOffset = -0.08f; // Ashy = rough
                profile.ColorCurve = 0.5f; // Ash spreads aggressively
                profile.TextureSwapThreshold = 0.65f;
                profile.HueTint = new Color(0.95f, 0.92f, 0.90f, 1f); // Warm ash tint
                profile.SaturationMult = 0.6f; // Ash desaturates everything
                return profile;
            }

            // Forest ↔ Desert: sand leaking into soil, green thinning
            if ((self == TerrainKind.Forest && neighbor == TerrainKind.Desert) ||
                (self == TerrainKind.Desert && neighbor == TerrainKind.Forest))
            {
                profile.SmoothnessOffset = -0.04f; // Sandy/gritty
                profile.ColorCurve = 0.8f; // Sand infiltrates slightly faster
                profile.HueTint = new Color(1.02f, 0.98f, 0.92f, 1f); // Warm sandy undertone
                profile.SaturationMult = 0.9f;
                profile.TilingVariance = 0.12f; // More texture breakup
                return profile;
            }

            // Forest ↔ Swamp: muddy transition
            if ((self == TerrainKind.Forest && neighbor == TerrainKind.Swamp) ||
                (self == TerrainKind.Swamp && neighbor == TerrainKind.Forest))
            {
                profile.SmoothnessOffset = 0.08f; // Damp mud
                profile.ColorCurve = 0.7f;
                profile.HueTint = new Color(0.95f, 0.98f, 0.92f, 1f); // Mossy undertone
                profile.SaturationMult = 0.95f;
                return profile;
            }

            // Plains ↔ Forest: grassland thinning to undergrowth
            if ((self == TerrainKind.Plains && neighbor == TerrainKind.Forest) ||
                (self == TerrainKind.Forest && neighbor == TerrainKind.Plains))
            {
                profile.ColorCurve = 1.1f; // Gradual grass-to-forest
                profile.HueTint = new Color(0.98f, 1.0f, 0.96f, 1f);
                profile.TilingVariance = 0.1f;
                return profile;
            }

            // Plains ↔ Desert: dry grass to sand
            if ((self == TerrainKind.Plains && neighbor == TerrainKind.Desert) ||
                (self == TerrainKind.Desert && neighbor == TerrainKind.Plains))
            {
                profile.SmoothnessOffset = -0.03f;
                profile.ColorCurve = 0.9f;
                profile.HueTint = new Color(1.01f, 0.99f, 0.94f, 1f); // Yellowing grass
                profile.SaturationMult = 0.92f;
                return profile;
            }

            // Mountains ↔ anything: rocky/gravel scatter
            if (neighbor == TerrainKind.Mountains || self == TerrainKind.Mountains)
            {
                profile.SmoothnessOffset = -0.05f;
                profile.MetallicOffset = 0.02f;
                profile.ColorCurve = 1.2f;
                profile.HueTint = new Color(0.96f, 0.96f, 0.97f, 1f); // Cool stone
                return profile;
            }

            return profile;
        }

        /// <summary>
        /// Compute blended color with per-pair artistic character.
        /// Uses non-linear curve + hue/saturation adjustments for natural transitions.
        /// </summary>
        static Color ComputePairBlend(Color selfCol, Color neighborCol, float t, BiomePairTransition profile)
        {
            // Non-linear blend curve: controls how quickly neighbor takes over
            var curvedT = Mathf.Pow(t, profile.ColorCurve);

            // Base lerp with curve
            var blended = Color.Lerp(selfCol, neighborCol, curvedT * 0.85f + 0.15f * t);

            // Apply hue tint
            blended.r *= profile.HueTint.r;
            blended.g *= profile.HueTint.g;
            blended.b *= profile.HueTint.b;

            // Saturation adjustment (convert to HSV, adjust, convert back approximation)
            if (Mathf.Abs(profile.SaturationMult - 1f) > 0.01f)
            {
                var gray = blended.r * 0.299f + blended.g * 0.587f + blended.b * 0.114f;
                blended.r = Mathf.Lerp(gray, blended.r, profile.SaturationMult);
                blended.g = Mathf.Lerp(gray, blended.g, profile.SaturationMult);
                blended.b = Mathf.Lerp(gray, blended.b, profile.SaturationMult);
            }

            // Slight value boost at mid-transition to avoid muddy band
            var midBoost = 1f + 0.06f * Mathf.Sin(t * Mathf.PI);
            blended.r = Mathf.Clamp01(blended.r * midBoost);
            blended.g = Mathf.Clamp01(blended.g * midBoost);
            blended.b = Mathf.Clamp01(blended.b * midBoost);

            return blended;
        }

        /// <summary>
        /// Compute emission for blend zone: volcanic glow bleeds, water adds subtle caustic.
        /// </summary>
        static Color ComputePairEmission(
            TerrainKind self, TerrainKind neighbor,
            SurfaceProfile selfLook, SurfaceProfile neighborLook,
            float t, BiomePairTransition profile)
        {
            var emission = Color.black;

            // Volcanic glow bleeds outward
            if (neighbor == TerrainKind.Volcanic)
            {
                var glowT = Mathf.Pow(t, 0.5f); // Glow spreads faster than color
                emission = Color.Lerp(Color.black, neighborLook.Emission * 0.4f, glowT);
            }
            else if (self == TerrainKind.Volcanic)
            {
                var fadeT = 1f - Mathf.Pow(1f - t, 0.5f);
                emission = Color.Lerp(selfLook.Emission * 0.6f, Color.black, fadeT);
            }

            // Water subtle caustic/reflection hint at shore
            if (neighbor == TerrainKind.Water && t > 0.4f)
            {
                var causticT = (t - 0.4f) / 0.6f;
                emission += new Color(0.005f, 0.012f, 0.018f) * causticT;
            }
            else if (self == TerrainKind.Water && t < 0.6f)
            {
                var causticT = 1f - t / 0.6f;
                emission += new Color(0.003f, 0.008f, 0.012f) * causticT;
            }

            // Swamp bioluminescence hint
            if ((self == TerrainKind.Swamp || neighbor == TerrainKind.Swamp) && t > 0.3f && t < 0.7f)
            {
                var bioT = Mathf.Sin((t - 0.3f) / 0.4f * Mathf.PI);
                emission += new Color(0.008f, 0.015f, 0.006f) * bioT * 0.3f;
            }

            return emission;
        }

        static SurfaceProfile SurfaceLook(TerrainKind kind) => kind switch
        {
            TerrainKind.Water => new SurfaceProfile
            {
                Smoothness = 0.92f,
                Metallic = 0.18f,
                Emission = new Color(0.04f, 0.12f, 0.18f),
            },
            TerrainKind.Volcanic => new SurfaceProfile
            {
                Smoothness = 0.32f,
                Metallic = 0.1f,
                // Soft underglow; crack color lives in the albedo texture.
                Emission = new Color(0.06f, 0.015f, 0.004f),
            },
            TerrainKind.Desert => new SurfaceProfile
            {
                Smoothness = 0.28f,
                Metallic = 0f,
                Emission = Color.black,
            },
            TerrainKind.Mountains => new SurfaceProfile
            {
                Smoothness = 0.22f,
                Metallic = 0.08f,
                Emission = Color.black,
            },
            TerrainKind.Swamp => new SurfaceProfile
            {
                Smoothness = 0.45f,
                Metallic = 0.02f,
                Emission = new Color(0.01f, 0.02f, 0.01f),
            },
            TerrainKind.Forest => new SurfaceProfile
            {
                Smoothness = 0.18f,
                Metallic = 0f,
                Emission = Color.black,
            },
            TerrainKind.Wall => new SurfaceProfile
            {
                Smoothness = 0.4f,
                Metallic = 0.2f,
                Emission = Color.black,
            },
            _ => new SurfaceProfile
            {
                Smoothness = 0.2f,
                Metallic = 0f,
                Emission = Color.black,
            },
        };

        static void ApplySurfaceDefaults(Material mat, float smoothness, float metallic)
        {
            if (mat.HasProperty("_Smoothness"))
                mat.SetFloat("_Smoothness", smoothness);
            if (mat.HasProperty("_Metallic"))
                mat.SetFloat("_Metallic", metallic);
            if (mat.HasProperty("_Glossiness"))
                mat.SetFloat("_Glossiness", smoothness);
        }

        static void ApplyColor(Material mat, Color color)
        {
            mat.color = color;
            if (mat.HasProperty("_BaseColor"))
                mat.SetColor("_BaseColor", color);
            if (mat.HasProperty("_Color"))
                mat.SetColor("_Color", color);
        }

        static void ApplyAlbedo(Material mat, Texture2D albedo, float tiling)
        {
            if (albedo == null) return;
            if (mat.HasProperty("_BaseMap"))
            {
                mat.SetTexture("_BaseMap", albedo);
                mat.SetTextureScale("_BaseMap", Vector2.one * tiling);
            }
            if (mat.HasProperty("_MainTex"))
            {
                mat.SetTexture("_MainTex", albedo);
                mat.SetTextureScale("_MainTex", Vector2.one * tiling);
            }
        }

        static void ApplyUvTransform(Material mat, Vector2 offset, float rotationDegrees)
        {
            if (mat.HasProperty("_BaseMap"))
            {
                var scale = mat.GetTextureScale("_BaseMap");
                if (scale.sqrMagnitude < 0.0001f) scale = Vector2.one;
                mat.SetTextureOffset("_BaseMap", offset);
                mat.SetTextureScale("_BaseMap", scale);
            }
            if (mat.HasProperty("_MainTex"))
            {
                var scale = mat.GetTextureScale("_MainTex");
                if (scale.sqrMagnitude < 0.0001f) scale = Vector2.one;
                mat.SetTextureOffset("_MainTex", offset);
                mat.SetTextureScale("_MainTex", scale);
            }

            // URP Lit has no built-in UV rotation; bake a mild offset axis skew via second channel when available.
            if (mat.HasProperty("_DetailAlbedoMapScale"))
                mat.SetFloat("_DetailAlbedoMapScale", 1f + rotationDegrees * 0.001f);
        }

        static void ApplyTransparentSurface(Material mat)
        {
            if (mat.HasProperty("_Surface"))
                mat.SetFloat("_Surface", 1f); // Transparent
            if (mat.HasProperty("_Blend"))
                mat.SetFloat("_Blend", 0f); // Alpha
            if (mat.HasProperty("_SrcBlend"))
                mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (mat.HasProperty("_DstBlend"))
                mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (mat.HasProperty("_ZWrite"))
                mat.SetInt("_ZWrite", 0);
            if (mat.HasProperty("_AlphaClip"))
                mat.SetFloat("_AlphaClip", 0f);

            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)RenderQueue.Transparent;
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            mat.DisableKeyword("_ALPHATEST_ON");
            mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        }

        static void ApplyEmission(Material mat, Color emission)
        {
            if (emission.maxColorComponent < 0.001f) return;
            if (mat.HasProperty("_EmissionColor"))
            {
                mat.EnableKeyword("_EMISSION");
                mat.SetColor("_EmissionColor", emission);
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
        }

        static Shader ResolveShader()
        {
            if (_resolved != null) return _resolved;

            var pipeline = GraphicsSettings.currentRenderPipeline;
            if (pipeline != null)
            {
                var urpLit = Shader.Find("Universal Render Pipeline/Lit");
                if (urpLit != null) { _resolved = urpLit; return _resolved; }
                var urpSimple = Shader.Find("Universal Render Pipeline/Simple Lit");
                if (urpSimple != null) { _resolved = urpSimple; return _resolved; }
            }

            _resolved = FindShader(
                "Universal Render Pipeline/Lit",
                "Universal Render Pipeline/Simple Lit",
                "HDRP/Lit",
                "Standard",
                "Legacy Shaders/Diffuse",
                "Unlit/Color",
                "Sprites/Default",
                "UI/Default");

            if (_resolved == null)
                _resolved = Shader.Find("Hidden/InternalErrorShader");

            return _resolved;
        }

        static Shader FindShader(params string[] names)
        {
            foreach (var name in names)
            {
                var s = Shader.Find(name);
                if (s != null) return s;
            }
            return null;
        }
    }
}
