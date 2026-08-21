using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>War-torn battlefield tableau behind title / lobby menus.</summary>
    public class MenuBackdrop3D : MonoBehaviour
    {
        [SerializeField] UnitAssetCatalog _unitCatalog;
        [SerializeField] float _spinSpeed = 3.5f;

        Transform _root;
        readonly System.Collections.Generic.List<Transform> _sway = new();
        bool _built;
        Material _dirt;
        Material _metal;
        Material _bone;
        Material _clothRed;
        Material _clothBlue;
        Material _wood;
        Material _rust;

        public void SetCatalog(UnitAssetCatalog catalog) => _unitCatalog = catalog;

        public void Show()
        {
            // Domain reload / script changes: rebuild so the tableau matches current code.
            if (_root == null) _built = false;
            DestroyOrphanTableaus();
            EnsureBuilt();
            if (_root != null) _root.gameObject.SetActive(true);
            enabled = true;
        }

        public void Hide()
        {
            if (_root != null)
            {
                // Immediate destroy so menu props never linger into Deploy as "flying discs".
                if (Application.isPlaying)
                    DestroyImmediate(_root.gameObject);
                else
                    DestroyImmediate(_root.gameObject);
                _root = null;
            }
            _built = false;
            _sway.Clear();
            DestroyOrphanTableaus();
            enabled = false;
        }

        /// <summary>Call when entering match to guarantee title props are gone.</summary>
        public static void ForceCleanupScene()
        {
            DestroyOrphanTableaus();
            // Do not destroy BattleTabletopRoom — match ApplyMatchVisuals cleans menus
            // after HexBoardBuilder.Rebuild, which just spawned the tabletop stage.
        }

        static bool IsMenuPropName(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            if (name is "MenuBackdropBattlefield" or "MenuBackdrop3D" or "MenuElements")
                return true;
            if (name.StartsWith("BackdropHex")) return true;
            if (name is "Sword" or "Shield" or "Skeleton" or "Banner" or "Ground") return true;
            if (name.StartsWith("Rubble_") || name.StartsWith("Wall_")) return true;
            return false;
        }

        static void DestroyOrphanTableaus()
        {
#pragma warning disable CS0618
            var all = Object.FindObjectsOfType<Transform>(true);
#pragma warning restore CS0618
            var doomed = new System.Collections.Generic.List<GameObject>();
            foreach (var t in all)
            {
                if (t == null) continue;
                // Only destroy roots / HexBoard children — not nested Shield under a doomed parent twice.
                if (!IsMenuPropName(t.name)) continue;
                if (t.parent != null && IsMenuPropName(t.parent.name)) continue;
                if (t.parent != null && t.parent.name == "MenuBackdropBattlefield") continue;
                doomed.Add(t.gameObject);
            }

            var board = GameObject.Find("HexBoard");
            if (board != null)
            {
                for (var i = 0; i < board.transform.childCount; i++)
                {
                    var child = board.transform.GetChild(i);
                    if (child == null) continue;
                    if (IsMenuPropName(child.name) && !doomed.Contains(child.gameObject))
                        doomed.Add(child.gameObject);
                }
            }

            foreach (var go in doomed)
            {
                if (go == null) continue;
                Object.DestroyImmediate(go);
            }
        }

        void EnsureBuilt()
        {
            if (_built) return;
            _built = true;
            EnsureMaterials();

            _root = new GameObject("MenuBackdropBattlefield").transform;
            _root.SetParent(transform, false);
            _root.localPosition = new Vector3(0f, -1.2f, 8f);

            // Scorched earth
            var ground = CreatePrim(PrimitiveType.Cylinder, "Ground", _root,
                new Vector3(0f, -0.05f, 0f), new Vector3(48f, 0.08f, 48f), _dirt);
            ground.transform.localRotation = Quaternion.identity;

            // Rubble rings
            for (var i = 0; i < 18; i++)
            {
                var a = i * 37.7f * Mathf.Deg2Rad;
                var r = 4f + (i % 5) * 2.4f;
                var pos = new Vector3(Mathf.Cos(a) * r, 0.15f + (i % 3) * 0.08f, Mathf.Sin(a) * r);
                var rock = CreatePrim(PrimitiveType.Cube, $"Rubble_{i}", _root, pos,
                    new Vector3(0.7f + (i % 3) * 0.25f, 0.35f + (i % 2) * 0.2f, 0.55f), _rust);
                rock.transform.localRotation = Quaternion.Euler(12f * (i % 5), i * 41f, 8f * (i % 4));
            }

            // Fallen swords
            for (var i = 0; i < 10; i++)
            {
                var a = i * 36f * Mathf.Deg2Rad;
                var r = 3.5f + (i % 4) * 1.8f;
                PlaceSword(_root, new Vector3(Mathf.Cos(a) * r, 0.12f, Mathf.Sin(a) * r),
                    Quaternion.Euler(5f + i, i * 47f, 70f + (i % 3) * 12f));
            }

            // Shields
            for (var i = 0; i < 7; i++)
            {
                var a = (i * 51f + 15f) * Mathf.Deg2Rad;
                var r = 5f + (i % 3) * 2.2f;
                PlaceShield(_root, new Vector3(Mathf.Cos(a) * r, 0.35f, Mathf.Sin(a) * r),
                    Quaternion.Euler(-18f, i * 55f, 55f + i * 8f), i % 2 == 0);
            }

            // Skeletons / bone piles
            for (var i = 0; i < 6; i++)
            {
                var a = (i * 60f + 25f) * Mathf.Deg2Rad;
                var r = 6.5f + (i % 2) * 2.5f;
                PlaceSkeleton(_root, new Vector3(Mathf.Cos(a) * r, 0.2f, Mathf.Sin(a) * r), i * 40f);
            }

            // Banner poles
            for (var i = 0; i < 5; i++)
            {
                var a = (i * 72f + 10f) * Mathf.Deg2Rad;
                var r = 9f + (i % 2);
                PlaceBanner(_root, new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r),
                    i * 30f, i % 2 == 0 ? _clothRed : _clothBlue);
            }

            // Broken wall fragments
            for (var i = 0; i < 4; i++)
            {
                var a = (i * 90f + 45f) * Mathf.Deg2Rad;
                var wall = CreatePrim(PrimitiveType.Cube, $"Wall_{i}", _root,
                    new Vector3(Mathf.Cos(a) * 12f, 0.9f, Mathf.Sin(a) * 12f),
                    new Vector3(3.2f, 1.8f, 0.55f), _rust);
                wall.transform.localRotation = Quaternion.Euler(0f, i * 90f + 20f, (i % 2 == 0 ? -8f : 10f));
            }
        }

        void PlaceSword(Transform parent, Vector3 pos, Quaternion rot)
        {
            var root = new GameObject("Sword").transform;
            root.SetParent(parent, false);
            root.localPosition = pos;
            root.localRotation = rot;
            CreatePrim(PrimitiveType.Cube, "Blade", root, new Vector3(0f, 0.05f, 0.55f),
                new Vector3(0.08f, 0.05f, 1.4f), _metal);
            CreatePrim(PrimitiveType.Cube, "Guard", root, new Vector3(0f, 0.05f, -0.15f),
                new Vector3(0.45f, 0.08f, 0.1f), _metal);
            CreatePrim(PrimitiveType.Cylinder, "Hilt", root, new Vector3(0f, 0.05f, -0.45f),
                new Vector3(0.08f, 0.22f, 0.08f), _wood);
        }

        void PlaceShield(Transform parent, Vector3 pos, Quaternion rot, bool round)
        {
            var kind = round ? PrimitiveType.Cylinder : PrimitiveType.Cube;
            var shield = CreatePrim(kind, "Shield", parent, pos,
                round ? new Vector3(1.1f, 0.08f, 1.1f) : new Vector3(0.95f, 0.12f, 1.2f), _metal);
            shield.transform.localRotation = rot;
            var boss = CreatePrim(PrimitiveType.Sphere, "Boss", shield.transform,
                new Vector3(0f, 0.12f, 0f), new Vector3(0.28f, 0.18f, 0.28f), _rust);
            boss.name = "Boss";
        }

        void PlaceSkeleton(Transform parent, Vector3 pos, float yaw)
        {
            var root = new GameObject("Skeleton").transform;
            root.SetParent(parent, false);
            root.localPosition = pos;
            root.localRotation = Quaternion.Euler(0f, yaw, 12f);

            CreatePrim(PrimitiveType.Sphere, "Skull", root, new Vector3(0.1f, 0.55f, 0.05f),
                new Vector3(0.38f, 0.4f, 0.42f), _bone);
            CreatePrim(PrimitiveType.Capsule, "Ribs", root, new Vector3(0f, 0.22f, 0f),
                new Vector3(0.35f, 0.28f, 0.22f), _bone);
            CreatePrim(PrimitiveType.Capsule, "FemurL", root, new Vector3(-0.18f, 0.05f, 0.35f),
                new Vector3(0.1f, 0.35f, 0.1f), _bone).transform.localRotation = Quaternion.Euler(75f, 0f, 15f);
            CreatePrim(PrimitiveType.Capsule, "FemurR", root, new Vector3(0.2f, 0.02f, -0.25f),
                new Vector3(0.1f, 0.32f, 0.1f), _bone).transform.localRotation = Quaternion.Euler(20f, 40f, -70f);
            CreatePrim(PrimitiveType.Capsule, "Arm", root, new Vector3(0.35f, 0.25f, 0.15f),
                new Vector3(0.08f, 0.28f, 0.08f), _bone).transform.localRotation = Quaternion.Euler(10f, 0f, 55f);
        }

        void PlaceBanner(Transform parent, Vector3 pos, float yaw, Material cloth)
        {
            var root = new GameObject("Banner").transform;
            root.SetParent(parent, false);
            root.localPosition = pos;
            root.localRotation = Quaternion.Euler(0f, yaw, 6f);

            CreatePrim(PrimitiveType.Cylinder, "Pole", root, new Vector3(0f, 2.1f, 0f),
                new Vector3(0.1f, 2.1f, 0.1f), _wood);
            var flag = CreatePrim(PrimitiveType.Cube, "Cloth", root, new Vector3(0.7f, 3.2f, 0f),
                new Vector3(1.5f, 1.1f, 0.05f), cloth);
            flag.transform.localRotation = Quaternion.Euler(0f, 0f, -4f);
            _sway.Add(flag.transform);

            // Optional fallen race token near banner
            if (_unitCatalog != null)
            {
                var prefab = _unitCatalog.ForRole("Unit", "Undead");
                if (prefab != null)
                {
                    var token = Instantiate(prefab, root);
                    token.name = "FallenToken";
                    token.transform.localPosition = new Vector3(0.8f, 0.35f, 0.6f);
                    token.transform.localRotation = Quaternion.Euler(80f, 20f, 0f);
                    token.transform.localScale = Vector3.one * 0.9f;
                }
            }
        }

        void EnsureMaterials()
        {
            _dirt = Mat(new Color(0.22f, 0.16f, 0.1f), 0.05f, 0.05f);
            _metal = Mat(new Color(0.55f, 0.56f, 0.58f), 0.65f, 0.55f);
            _bone = Mat(new Color(0.86f, 0.82f, 0.72f), 0.25f, 0.05f);
            _clothRed = Mat(new Color(0.45f, 0.08f, 0.08f), 0.2f, 0f);
            _clothBlue = Mat(new Color(0.12f, 0.2f, 0.38f), 0.2f, 0f);
            _wood = Mat(new Color(0.28f, 0.18f, 0.1f), 0.15f, 0f);
            _rust = Mat(new Color(0.35f, 0.22f, 0.14f), 0.1f, 0.15f);
        }

        static Material Mat(Color color, float smooth, float metal)
        {
            var m = TerrainMaterialFactory.CreateTileInstance(color);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metal);
            m.hideFlags = HideFlags.HideAndDontSave;
            return m;
        }

        static GameObject CreatePrim(PrimitiveType type, string name, Transform parent,
            Vector3 localPos, Vector3 localScale, Material mat)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            // Never leave default colliders on decorative menu props.
            var col = go.GetComponent<Collider>();
            if (col != null)
            {
                if (Application.isPlaying)
                    UnityEngine.Object.Destroy(col);
                else
                    UnityEngine.Object.DestroyImmediate(col);
            }
            var rend = go.GetComponent<Renderer>();
            if (rend != null && mat != null) rend.sharedMaterial = mat;
            return go;
        }

        void Update()
        {
            if (_root == null || !_root.gameObject.activeSelf) return;
            _root.Rotate(0f, _spinSpeed * Time.unscaledDeltaTime, 0f, Space.World);
            for (var i = 0; i < _sway.Count; i++)
            {
                var t = _sway[i];
                if (t == null) continue;
                var z = Mathf.Sin(Time.unscaledTime * 1.3f + i) * 6f;
                t.localRotation = Quaternion.Euler(0f, 0f, -4f + z);
            }
        }
    }
}
