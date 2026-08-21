using CommandWarfare.Core.Terrain;
using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>
    /// Terrain hex materials/textures + scatter prefabs.
    /// Assign albedo textures (or full Materials) per biome; empty slots use procedural fallbacks.
    /// </summary>
    [CreateAssetMenu(fileName = "TerrainAssetCatalog", menuName = "CommandWarfare/Terrain Asset Catalog")]
    public class TerrainAssetCatalog : ScriptableObject
    {
        [Header("Hex surface — albedo textures (preferred)")]
        public Texture2D plainsAlbedo;
        public Texture2D forestAlbedo;
        public Texture2D swampAlbedo;
        public Texture2D desertAlbedo;
        public Texture2D waterAlbedo;
        public Texture2D volcanicAlbedo;
        public Texture2D mountainsAlbedo;
        public Texture2D wallAlbedo;

        [Header("Hex surface — optional full materials (override textures)")]
        public Material plainsMaterial;
        public Material forestMaterial;
        public Material swampMaterial;
        public Material desertMaterial;
        public Material waterMaterial;
        public Material volcanicMaterial;
        public Material mountainsMaterial;
        public Material wallMaterial;

        [Header("UV tiling on hex tops")]
        public float albedoTiling = 1.35f;

        [Header("Forest scatter")]
        public GameObject[] treePrefabs;
        public float treeScaleMin = 0.8f;
        public float treeScaleMax = 1.2f;

        [Header("Mountain scatter")]
        public GameObject[] peakPrefabs;
        public float peakScaleMin = 0.9f;
        public float peakScaleMax = 1.3f;

        [Header("Desert scatter")]
        public GameObject[] rockPrefabs;
        public float rockScaleMin = 0.5f;
        public float rockScaleMax = 1.0f;

        [Header("Swamp scatter")]
        public GameObject[] reedPrefabs;
        public float reedScaleMin = 0.7f;
        public float reedScaleMax = 1.1f;

        [Header("Volcanic scatter")]
        public GameObject[] volcanicPrefabs;
        public float volcanicScaleMin = 0.6f;
        public float volcanicScaleMax = 1.1f;

        public bool HasForest => treePrefabs != null && treePrefabs.Length > 0;
        public bool HasPeaks => peakPrefabs != null && peakPrefabs.Length > 0;
        public bool HasRocks => rockPrefabs != null && rockPrefabs.Length > 0;
        public bool HasReeds => reedPrefabs != null && reedPrefabs.Length > 0;
        public bool HasVolcanic => volcanicPrefabs != null && volcanicPrefabs.Length > 0;

        public GameObject PickTree(int seed) => Pick(treePrefabs, seed);
        public GameObject PickPeak(int seed) => Pick(peakPrefabs, seed);
        public GameObject PickRock(int seed) => Pick(rockPrefabs, seed);
        public GameObject PickReed(int seed) => Pick(reedPrefabs, seed);
        public GameObject PickVolcanic(int seed) => Pick(volcanicPrefabs, seed);

        public Material MaterialFor(TerrainKind kind) => kind switch
        {
            TerrainKind.Plains => plainsMaterial,
            TerrainKind.Forest => forestMaterial,
            TerrainKind.Swamp => swampMaterial,
            TerrainKind.Desert => desertMaterial,
            TerrainKind.Water => waterMaterial,
            TerrainKind.Volcanic => volcanicMaterial,
            TerrainKind.Mountains => mountainsMaterial,
            TerrainKind.Wall => wallMaterial,
            _ => null,
        };

        public Texture2D AlbedoFor(TerrainKind kind) => kind switch
        {
            TerrainKind.Plains => plainsAlbedo,
            TerrainKind.Forest => forestAlbedo,
            TerrainKind.Swamp => swampAlbedo,
            TerrainKind.Desert => desertAlbedo,
            TerrainKind.Water => waterAlbedo,
            TerrainKind.Volcanic => volcanicAlbedo,
            TerrainKind.Mountains => mountainsAlbedo,
            TerrainKind.Wall => wallAlbedo,
            _ => null,
        };

        public int AssignedAlbedoCount()
        {
            var n = 0;
            if (plainsAlbedo != null) n++;
            if (forestAlbedo != null) n++;
            if (swampAlbedo != null) n++;
            if (desertAlbedo != null) n++;
            if (waterAlbedo != null) n++;
            if (volcanicAlbedo != null) n++;
            if (mountainsAlbedo != null) n++;
            if (wallAlbedo != null) n++;
            return n;
        }

        static GameObject Pick(GameObject[] options, int seed)
        {
            if (options == null || options.Length == 0) return null;
            return options[Mathf.Abs(seed) % options.Length];
        }
    }
}
