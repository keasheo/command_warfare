using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>
    /// Distinct board markers by role + seat color:
    /// Commander = banner standard, Officer = diamond, Unit = pawn.
    /// </summary>
    public class UnitTokenView : MonoBehaviour
    {
        [SerializeField] string _label = "U";
        [SerializeField] Color _seatColor = Color.white;
        [SerializeField] UnitKind _kind = UnitKind.Unit;

        Transform _root;
        bool _selected;

        public void Bind(string label, Color seatColor, UnitKind kind = UnitKind.Unit)
        {
            _label = label;
            _seatColor = seatColor;
            _kind = kind;
            Rebuild();
        }

        void Rebuild()
        {
            ClearChildren();
            _root = new GameObject("Icon").transform;
            _root.SetParent(transform, false);

            var accent = Color.Lerp(_seatColor, Color.white, 0.35f);
            var dark = Color.Lerp(_seatColor, Color.black, 0.35f);

            // Wide seat plate so ownership reads from afar.
            var plateR = _kind switch
            {
                UnitKind.Commander => 0.72f,
                UnitKind.Officer => 0.55f,
                _ => 0.42f,
            };
            Prim(PrimitiveType.Cylinder, "Plate", _root,
                new Vector3(0f, 0.04f, 0f),
                new Vector3(plateR, 0.05f, plateR),
                _seatColor);

            // Tall beacon so markers poke above forest scatter.
            Prim(PrimitiveType.Cylinder, "Beacon", _root,
                new Vector3(0f, 0.55f, 0f),
                new Vector3(0.07f, 0.55f, 0.07f),
                dark);

            switch (_kind)
            {
                case UnitKind.Commander:
                    BuildCommander(accent, dark);
                    break;
                case UnitKind.Officer:
                    BuildOfficer(accent, dark);
                    break;
                default:
                    BuildUnit(accent, dark);
                    break;
            }

            // Tiny role badge cube on top of beacon (C / O / U silhouette).
            Prim(PrimitiveType.Cube, "Badge", _root,
                new Vector3(0f, 1.22f, 0f),
                _kind == UnitKind.Commander
                    ? new Vector3(0.28f, 0.28f, 0.28f)
                    : _kind == UnitKind.Officer
                        ? new Vector3(0.22f, 0.22f, 0.22f)
                        : new Vector3(0.16f, 0.16f, 0.16f),
                accent);

            ApplySelectedScale();
        }

        void BuildCommander(Color accent, Color dark)
        {
            // Crown disc
            Prim(PrimitiveType.Cylinder, "Crown", _root,
                new Vector3(0f, 1.05f, 0f),
                new Vector3(0.38f, 0.08f, 0.38f),
                accent);
            // Banner flag
            Prim(PrimitiveType.Cube, "Banner", _root,
                new Vector3(0.32f, 0.85f, 0f),
                new Vector3(0.55f, 0.38f, 0.06f),
                Color.Lerp(accent, Color.white, 0.2f));
            // Star tip
            Prim(PrimitiveType.Sphere, "Star", _root,
                new Vector3(0f, 1.35f, 0f),
                new Vector3(0.22f, 0.22f, 0.22f),
                new Color(1f, 0.85f, 0.2f));
        }

        void BuildOfficer(Color accent, Color dark)
        {
            // Diamond (rotated cube)
            var diamond = Prim(PrimitiveType.Cube, "Diamond", _root,
                new Vector3(0f, 0.7f, 0f),
                new Vector3(0.38f, 0.38f, 0.38f),
                accent);
            diamond.transform.localRotation = Quaternion.Euler(45f, 45f, 0f);
            Prim(PrimitiveType.Sphere, "Core", _root,
                new Vector3(0f, 0.7f, 0f),
                new Vector3(0.18f, 0.18f, 0.18f),
                dark);
        }

        void BuildUnit(Color accent, Color dark)
        {
            // Pawn body + head
            Prim(PrimitiveType.Capsule, "Body", _root,
                new Vector3(0f, 0.55f, 0f),
                new Vector3(0.32f, 0.38f, 0.32f),
                accent);
            Prim(PrimitiveType.Sphere, "Head", _root,
                new Vector3(0f, 0.95f, 0f),
                new Vector3(0.28f, 0.28f, 0.28f),
                Color.Lerp(accent, Color.white, 0.25f));
        }

        static GameObject Prim(
            PrimitiveType type,
            string name,
            Transform parent,
            Vector3 localPos,
            Vector3 localScale,
            Color color)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            var col = go.GetComponent<Collider>();
            if (col != null)
            {
                if (Application.isPlaying) Object.Destroy(col);
                else Object.DestroyImmediate(col);
            }
            var r = go.GetComponent<Renderer>();
            if (r != null)
            {
                var mat = TerrainMaterialFactory.CreateTileInstance(
                    color, null, 1f, 0.35f, 0.05f, color * 0.25f);
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            return go;
        }

        void ClearChildren()
        {
            for (var i = transform.childCount - 1; i >= 0; i--)
            {
                var child = transform.GetChild(i);
                if (Application.isPlaying) Destroy(child.gameObject);
                else DestroyImmediate(child.gameObject);
            }
            _root = null;
        }

        public void SetSelected(bool selected)
        {
            _selected = selected;
            ApplySelectedScale();
        }

        void ApplySelectedScale()
        {
            if (_root == null) return;
            _root.localScale = _selected ? Vector3.one * 1.22f : Vector3.one;
        }

        public void SetWorldPosition(Vector3 worldPos) => transform.position = worldPos;
    }
}
