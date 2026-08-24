using System.IO;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>
    /// Generates interim procedural biome albedo textures and wires TerrainAssetCatalog.
    /// Replace these later with painted / Asset Store / generated art.
    /// </summary>
    public static class TerrainTextureGenerator
    {
        const string TexRoot = "Assets/Art/Terrain";
        const string CatalogPath = "Assets/Data/TerrainAssetCatalog.asset";

        [MenuItem("CommandWarfare/Generate Procedural Terrain Textures")]
        public static void GenerateAndAssign()
        {
            EnsureFolder("Assets/Art");
            EnsureFolder(TexRoot);
            TerrainMaterialFactory.ClearTerrainCache();

            var plains = SaveAlbedo("plains", TerrainKind.Plains, SoftGrass);
            var forest = SaveAlbedo("forest", TerrainKind.Forest, DenseCanopy);
            var swamp = SaveAlbedo("swamp", TerrainKind.Swamp, MurkyWet);
            var desert = SaveAlbedo("desert", TerrainKind.Desert, SandDunes);
            var water = SaveAlbedo("water", TerrainKind.Water, WaterRipple);
            var volcanic = SaveAlbedo("volcanic", TerrainKind.Volcanic, LavaRock);
            var mountains = SaveAlbedo("mountains", TerrainKind.Mountains, StoneStrata);
            var wall = SaveAlbedo("wall", TerrainKind.Wall, StoneBrick);

            HexBoardBootstrap.CreateAssetCatalogs();
            var catalog = AssetDatabase.LoadAssetAtPath<TerrainAssetCatalog>(CatalogPath);
            if (catalog == null)
            {
                Debug.LogError("[CommandWarfare] TerrainAssetCatalog missing.");
                return;
            }

            var so = new SerializedObject(catalog);
            so.FindProperty("plainsAlbedo").objectReferenceValue = plains;
            so.FindProperty("forestAlbedo").objectReferenceValue = forest;
            so.FindProperty("swampAlbedo").objectReferenceValue = swamp;
            so.FindProperty("desertAlbedo").objectReferenceValue = desert;
            so.FindProperty("waterAlbedo").objectReferenceValue = water;
            so.FindProperty("volcanicAlbedo").objectReferenceValue = volcanic;
            so.FindProperty("mountainsAlbedo").objectReferenceValue = mountains;
            so.FindProperty("wallAlbedo").objectReferenceValue = wall;
            so.FindProperty("albedoTiling").floatValue = 1.4f;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();

            Debug.Log($"[CommandWarfare] Generated biome albedos under {TexRoot} and assigned to TerrainAssetCatalog.");
        }

        delegate Color PixelFn(float u, float v, Color baseCol);

        static Texture2D SaveAlbedo(string name, TerrainKind kind, PixelFn fn)
        {
            const int size = 256;
            var baseCol = TerrainVisuals.BaseColor(kind, 0);
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, true, false)
            {
                name = $"CW_{name}_albedo",
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Bilinear,
                anisoLevel = 4,
            };

            var pixels = new Color[size * size];
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    var u = x / (float)(size - 1);
                    var v = y / (float)(size - 1);
                    pixels[y * size + x] = fn(u, v, baseCol);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply(true);

            var path = $"{TexRoot}/CW_{name}_albedo.png";
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);

            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            if (importer != null)
            {
                importer.textureType = TextureImporterType.Default;
                importer.sRGBTexture = true;
                importer.wrapMode = TextureWrapMode.Repeat;
                importer.filterMode = FilterMode.Bilinear;
                importer.anisoLevel = 4;
                importer.mipmapEnabled = true;
                importer.SaveAndReimport();
            }

            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static float Hash(float x, float y)
        {
            var n = Mathf.Sin(x * 127.1f + y * 311.7f) * 43758.5453f;
            return n - Mathf.Floor(n);
        }

        static float ValueNoise(float x, float y)
        {
            var x0 = Mathf.Floor(x);
            var y0 = Mathf.Floor(y);
            var xf = x - x0;
            var yf = y - y0;
            var u = xf * xf * (3f - 2f * xf);
            var v = yf * yf * (3f - 2f * yf);
            var a = Hash(x0, y0);
            var b = Hash(x0 + 1f, y0);
            var c = Hash(x0, y0 + 1f);
            var d = Hash(x0 + 1f, y0 + 1f);
            return Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(c, d, u), v);
        }

        static float Fbm(float x, float y, int octaves)
        {
            var sum = 0f;
            var amp = 0.5f;
            var freq = 1f;
            for (var i = 0; i < octaves; i++)
            {
                sum += ValueNoise(x * freq, y * freq) * amp;
                freq *= 2f;
                amp *= 0.5f;
            }
            return sum;
        }

        static Color SoftGrass(float u, float v, Color baseCol)
        {
            var n = Fbm(u * 6f, v * 6f, 4);
            var blade = Mathf.Abs(Mathf.Sin((u + v) * 40f + n * 6f)) * 0.08f;
            return Color.Lerp(baseCol * 0.85f, baseCol * 1.15f, n) + new Color(blade, blade * 1.1f, blade * 0.4f);
        }

        static Color DenseCanopy(float u, float v, Color baseCol)
        {
            var n = Fbm(u * 8f, v * 8f, 5);
            var mottled = Fbm(u * 18f + 3f, v * 18f, 3);
            var c = Color.Lerp(baseCol * 0.7f, baseCol * 1.25f, n);
            return Color.Lerp(c, new Color(0.15f, 0.28f, 0.12f), mottled * 0.25f);
        }

        static Color MurkyWet(float u, float v, Color baseCol)
        {
            var n = Fbm(u * 5f, v * 5f, 4);
            var sheen = Mathf.Pow(Fbm(u * 12f, v * 12f, 2), 2f) * 0.15f;
            var c = Color.Lerp(baseCol * 0.75f, baseCol * 1.1f, n);
            return c + new Color(sheen * 0.4f, sheen * 0.55f, sheen * 0.35f);
        }

        static Color SandDunes(float u, float v, Color baseCol)
        {
            var dunes = Mathf.Sin((u * 3f + Fbm(u * 2f, v * 2f, 3)) * Mathf.PI * 2f) * 0.5f + 0.5f;
            var grain = Fbm(u * 30f, v * 30f, 2) * 0.12f;
            return Color.Lerp(baseCol * 0.88f, baseCol * 1.18f, dunes) + Color.white * grain;
        }

        static Color WaterRipple(float u, float v, Color baseCol)
        {
            var rip = Mathf.Sin((u * 14f + v * 9f) * Mathf.PI * 2f) * 0.5f + 0.5f;
            var deep = Fbm(u * 4f, v * 4f, 3);
            var c = Color.Lerp(baseCol * 0.75f, baseCol * 1.2f, rip * 0.55f + deep * 0.45f);
            return Color.Lerp(c, new Color(0.7f, 0.85f, 0.95f), rip * 0.15f);
        }

        static Color LavaRock(float u, float v, Color baseCol)
        {
            // Dark gray basalt with sparse red/orange crack veins (not a lava sheet).
            var rockN = Fbm(u * 7f, v * 7f, 4);
            var rock = Color.Lerp(
                new Color(0.14f, 0.14f, 0.16f),
                new Color(0.28f, 0.27f, 0.29f),
                rockN);
            rock = Color.Lerp(rock, baseCol, 0.45f);

            // Thin ridge cracks — high power keeps most of the sheet charcoal.
            var n1 = Fbm(u * 9f, v * 9f, 5);
            var n2 = Fbm(u * 14f + 4f, v * 14f - 2f, 4);
            var ridge1 = 1f - Mathf.Abs(n1 * 2f - 1f);
            var ridge2 = 1f - Mathf.Abs(n2 * 2f - 1f);
            var crack = Mathf.Pow(Mathf.Max(ridge1, ridge2 * 0.85f), 16f);
            var branch = Mathf.Pow(1f - Mathf.Abs(Fbm(u * 18f - 1f, v * 8f, 3) * 2f - 1f), 20f);
            crack = Mathf.Max(crack, branch * 0.55f);

            var lava = Color.Lerp(
                new Color(0.7f, 0.12f, 0.03f),
                new Color(1f, 0.45f, 0.08f),
                Mathf.Clamp01(crack * 1.4f));
            // Soft heat bleed only very near the vein.
            var glow = Mathf.Pow(crack, 0.45f) * 0.35f;
            var warmed = Color.Lerp(rock, new Color(0.35f, 0.16f, 0.1f), glow);
            return Color.Lerp(warmed, lava, crack);
        }

        static Color StoneStrata(float u, float v, Color baseCol)
        {
            var bands = Mathf.Abs(Mathf.Sin((v * 8f + Fbm(u * 3f, v * 3f, 2)) * Mathf.PI));
            var grit = Fbm(u * 22f, v * 22f, 2);
            var greenPatch = Fbm(u * 5f + 2f, v * 5f, 3);
            var brownPatch = Fbm(u * 6f - 1f, v * 4f + 3f, 3);

            // Light gray rock strata with readable green / light-brown mountain character.
            var stone = Color.Lerp(baseCol * 0.9f, baseCol * 1.08f, bands);
            stone = Color.Lerp(stone, new Color(0.48f, 0.6f, 0.4f), greenPatch * 0.42f);
            stone = Color.Lerp(stone, new Color(0.78f, 0.62f, 0.44f), brownPatch * 0.38f * (1f - bands * 0.35f));
            return stone + Color.white * (grit * 0.045f);
        }

        static Color StoneBrick(float u, float v, Color baseCol)
        {
            var bx = Mathf.Abs((u * 8f) % 1f - 0.5f);
            var by = Mathf.Abs((v * 8f) % 1f - 0.5f);
            var mortar = bx > 0.42f || by > 0.42f ? 0.35f : 0f;
            var n = Fbm(u * 10f, v * 10f, 3);
            return Color.Lerp(baseCol * 0.85f, baseCol * 1.1f, n) * (1f - mortar) + new Color(0.35f, 0.36f, 0.38f) * mortar;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = path.Substring(0, path.LastIndexOf('/'));
            var leaf = path.Substring(path.LastIndexOf('/') + 1);
            AssetDatabase.CreateFolder(parent, leaf);
        }
    }
}
