using UnityEngine;

namespace CommandWarfare.Data
{
    /// <summary>Kenney (CC0) furniture / castle props for the battle tabletop war-room.</summary>
    [CreateAssetMenu(menuName = "CommandWarfare/Room Decor Catalog", fileName = "RoomDecorCatalog")]
    public class RoomDecorCatalog : ScriptableObject
    {
        public GameObject[] Bookcases;
        public GameObject[] Desks;
        public GameObject[] Chairs;
        public GameObject[] Benches;
        public GameObject[] Plants;
        public GameObject[] Lamps;
        public GameObject[] Rugs;
        public GameObject[] SoftSeating;
        public GameObject[] Banners;
        public GameObject[] Accents;
    }
}
