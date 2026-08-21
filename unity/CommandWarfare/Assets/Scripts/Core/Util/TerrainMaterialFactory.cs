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
            var tiling = catalog != null ? Mathf.Max(0.25f, catalog.albedoTiling) : 1.35f;

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
        /// Soft Wang/blob feather: opaque color lerp from self → neighbor (strength 0..1).
        /// Avoids URP transparent sorting issues while still reading as a smooth edge blend.
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
            var cacheKey = $"blend:{neighbor}:{self}:{variant}:{quant}";
            if (_blendCache.TryGetValue(cacheKey, out var cached) && cached != null)
                return cached;

            var neighborCol = TerrainVisuals.BaseColor(neighbor, variant);
            var selfCol = TerrainVisuals.BaseColor(self, variant);
            var blended = Color.Lerp(selfCol, neighborCol, quant / 20f);
            blended.a = 1f;

            // Prefer neighbor albedo at high strength so textured biomes still read.
            var useNeighborTex = quant >= 10;
            var kindForTex = useNeighborTex ? neighbor : self;
            var albedo = catalog?.AlbedoFor(kindForTex);
            var look = SurfaceLook(neighbor);
            var tiling = catalog != null ? Mathf.Max(0.25f, catalog.albedoTiling) : 1.35f;
            var mat = CreateTileInstance(blended, albedo, tiling, look.Smoothness, look.Metallic, look.Emission * (quant / 20f));
            _blendCache[cacheKey] = mat;
            return mat;
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

        struct SurfaceProfile
        {
            public float Smoothness;
            public float Metallic;
            public Color Emission;
        }

        static SurfaceProfile SurfaceLook(TerrainKind kind) => kind switch
        {
            TerrainKind.Water => new SurfaceProfile
            {
                Smoothness = 0.82f,
                Metallic = 0.05f,
                Emission = new Color(0.02f, 0.05f, 0.08f),
            },
            TerrainKind.Volcanic => new SurfaceProfile
            {
                Smoothness = 0.35f,
                Metallic = 0.15f,
                Emission = new Color(0.25f, 0.06f, 0.02f),
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
