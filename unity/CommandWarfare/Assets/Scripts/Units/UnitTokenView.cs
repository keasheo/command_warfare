using System.Collections.Generic;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>
    /// Board token: procedural miniature figure (or real catalog mesh), seat plate, HP bar.
    /// </summary>
    public class UnitTokenView : MonoBehaviour
    {
        [SerializeField] string _label = "U";
        [SerializeField] Color _seatColor = Color.white;
        [SerializeField] UnitKind _kind = UnitKind.Unit;

        Transform _root;
        Transform _modelRoot;
        Transform _plate;
        Transform _plateRim;
        Transform _hpRoot;
        Transform _hpFill;
        Animator _animator;
        bool _selected;
        float _idlePhase;
        Vector3 _baseLocalPos;
        float _hpFrac = 1f;
        bool _showHp;
        string _unitId;
        int _col;
        int _row;

        public UnitKind Kind => _kind;
        public Animator Animator => _animator;
        public string UnitId => _unitId;
        public int Col => _col;
        public int Row => _row;

        public void SetBoardIdentity(string unitId, int col, int row)
        {
            _unitId = unitId;
            _col = col;
            _row = row;
        }

        public void Bind(string label, Color seatColor, UnitKind kind = UnitKind.Unit)
        {
            Bind(label, seatColor, kind, null, Color.white, null, null, null, 1, null, null);
        }

        public void Bind(
            string label,
            Color seatColor,
            UnitKind kind,
            GameObject catalogPrefab,
            Color modelTint)
        {
            Bind(label, seatColor, kind, catalogPrefab, modelTint, null, null, null, 1, null, null);
        }

        public void Bind(
            string label,
            Color seatColor,
            UnitKind kind,
            GameObject catalogPrefab,
            Color modelTint,
            string cardId,
            string race,
            IReadOnlyList<string> keywords,
            int range,
            int? toughnessCurrent,
            int? toughnessMax)
        {
            _label = label;
            _seatColor = seatColor;
            _kind = kind;
            SetHp(toughnessCurrent, toughnessMax);
            Rebuild(catalogPrefab, modelTint, cardId, race, keywords, range);
        }

        public void SetHp(int? current, int? max)
        {
            _showHp = max.HasValue && max.Value > 0;
            if (!_showHp)
            {
                _hpFrac = 1f;
                ApplyHpBar();
                return;
            }
            var cur = current ?? max.Value;
            _hpFrac = Mathf.Clamp01(cur / (float)max.Value);
            ApplyHpBar();
        }

        void Rebuild(
            GameObject catalogPrefab,
            Color modelTint,
            string cardId,
            string race,
            IReadOnlyList<string> keywords,
            int range)
        {
            ClearChildren();
            _root = new GameObject("Visual").transform;
            _root.SetParent(transform, false);
            _baseLocalPos = Vector3.zero;
            _idlePhase = Random.value * Mathf.PI * 2f;

            BuildSeatPlate();

            _modelRoot = new GameObject("Model").transform;
            _modelRoot.SetParent(_root, false);

            var useCatalog = catalogPrefab != null && !IsPlaceholderPrefab(catalogPrefab);
            if (useCatalog)
            {
                var model = Instantiate(catalogPrefab, _modelRoot);
                model.name = "CatalogModel";
                model.transform.localPosition = Vector3.zero;
                model.transform.localRotation = Quaternion.identity;
                var bounds = ApproxBounds(model);
                var targetH = TargetModelHeight(_kind, race);
                if (bounds.size.y > 0.01f)
                {
                    var s = targetH / bounds.size.y;
                    model.transform.localScale = Vector3.one * s;
                    model.transform.localPosition = new Vector3(0f, -bounds.min.y * s, 0f);
                }
                ApplyTint(model, modelTint);
                StripColliders(model);
                _animator = model.GetComponentInChildren<Animator>();
                if (_animator != null)
                {
                    TrySetAnimBool("Idle", true);
                    TrySetAnimTrigger("Idle");
                }
            }
            else
            {
                var spec = new MiniFigureBuilder.FigureSpec
                {
                    Kind = _kind,
                    Race = race,
                    CardId = cardId,
                    Keywords = keywords,
                    Range = Mathf.Max(1, range),
                    SeatColor = _seatColor,
                };
                MiniFigureBuilder.Build(_modelRoot, spec);
            }

            AttachRoleBadge(_label);
            BuildHpBar();
            EnsureClickCollider();
            ApplySelectedVisual();
        }

        /// <summary>Solid circle (or wide pill for PO/PC) with role letter above the head.</summary>
        void AttachRoleBadge(string label)
        {
            if (string.IsNullOrEmpty(label)) label = "U";
            var twoChar = label.Length > 1;
            var y = _kind switch
            {
                UnitKind.Commander => 2.05f,
                UnitKind.Officer => 1.85f,
                _ => 1.68f,
            };

            var badge = new GameObject("RoleBadge").transform;
            badge.SetParent(_root, false);
            badge.localPosition = new Vector3(0f, y, 0f);
            badge.gameObject.AddComponent<BillboardToCamera>();

            var bgColor = _kind switch
            {
                UnitKind.Commander => new Color(0.12f, 0.1f, 0.08f, 1f),
                UnitKind.Officer => new Color(0.1f, 0.11f, 0.14f, 1f),
                _ => new Color(0.08f, 0.09f, 0.1f, 1f),
            };
            var accent = _kind switch
            {
                UnitKind.Commander => new Color(0.95f, 0.82f, 0.28f),
                UnitKind.Officer => new Color(0.82f, 0.86f, 0.92f),
                _ => Color.Lerp(_seatColor, Color.white, 0.55f),
            };

            var discScale = twoChar
                ? new Vector3(0.38f, 0.04f, 0.26f)
                : new Vector3(0.26f, 0.04f, 0.26f);
            Prim(PrimitiveType.Cylinder, "BadgeDisc", badge,
                Vector3.zero, discScale, bgColor, castShadow: false);
            Prim(PrimitiveType.Cylinder, "BadgeRing", badge,
                new Vector3(0f, -0.01f, 0f),
                new Vector3(discScale.x * 1.12f, 0.02f, discScale.z * 1.12f),
                accent, castShadow: false);

            var letterGo = new GameObject("BadgeLetter");
            letterGo.transform.SetParent(badge, false);
            letterGo.transform.localPosition = new Vector3(0f, 0.06f, 0f);
            letterGo.transform.localRotation = Quaternion.identity;
            var tm = letterGo.AddComponent<TextMesh>();
            tm.text = label;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.characterSize = twoChar ? 0.055f : 0.07f;
            tm.fontSize = 64;
            tm.fontStyle = FontStyle.Bold;
            tm.color = accent;
            tm.richText = false;
            var mr = letterGo.GetComponent<MeshRenderer>();
            if (mr != null)
            {
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
                // Keep letter readable against sky / terrain.
                if (mr.sharedMaterial != null)
                {
                    var mat = new Material(mr.sharedMaterial);
                    if (mat.HasProperty("_Color")) mat.color = accent;
                    mr.sharedMaterial = mat;
                }
            }
        }

        /// <summary>Capsule on the token root so raycasts hit the figure, not only the hex below.</summary>
        void EnsureClickCollider()
        {
            var col = GetComponent<CapsuleCollider>();
            if (col == null) col = gameObject.AddComponent<CapsuleCollider>();
            var radius = _kind switch
            {
                UnitKind.Commander => 0.55f,
                UnitKind.Officer => 0.48f,
                _ => 0.42f,
            };
            var height = _kind switch
            {
                UnitKind.Commander => 2.0f,
                UnitKind.Officer => 1.75f,
                _ => 1.55f,
            };
            col.radius = radius;
            col.height = height;
            col.center = new Vector3(0f, height * 0.42f, 0f);
            col.direction = 1; // Y-axis
            col.isTrigger = false;
        }

        void BuildSeatPlate()
        {
            var plateR = _kind switch
            {
                UnitKind.Commander => 0.55f,
                UnitKind.Officer => 0.46f,
                _ => 0.38f,
            };

            _plate = Prim(PrimitiveType.Cylinder, "Plate", _root,
                new Vector3(0f, 0.035f, 0f),
                new Vector3(plateR, 0.04f, plateR),
                _seatColor,
                castShadow: true).transform;

            var rimColor = _kind switch
            {
                UnitKind.Commander => new Color(0.92f, 0.78f, 0.28f),
                UnitKind.Officer => new Color(0.75f, 0.78f, 0.85f),
                _ => Color.Lerp(_seatColor, Color.black, 0.35f),
            };
            _plateRim = Prim(PrimitiveType.Cylinder, "PlateRim", _root,
                new Vector3(0f, 0.02f, 0f),
                new Vector3(plateR * 1.12f, 0.025f, plateR * 1.12f),
                rimColor,
                castShadow: false).transform;
        }

        void BuildHpBar()
        {
            // Keep HP under the role badge so both stay readable.
            _hpRoot = new GameObject("HpBar").transform;
            _hpRoot.SetParent(_root, false);
            _hpRoot.localPosition = new Vector3(0f, _kind == UnitKind.Commander ? 1.72f : 1.5f, 0f);
            _hpRoot.gameObject.AddComponent<BillboardToCamera>();

            Prim(PrimitiveType.Cube, "HpBg", _hpRoot,
                Vector3.zero, new Vector3(0.55f, 0.06f, 0.04f),
                new Color(0.12f, 0.12f, 0.14f), castShadow: false);

            var fillGo = Prim(PrimitiveType.Cube, "HpFill", _hpRoot,
                new Vector3(0f, 0f, -0.01f), new Vector3(0.52f, 0.045f, 0.03f),
                new Color(0.25f, 0.85f, 0.35f), castShadow: false);
            _hpFill = fillGo.transform;
            ApplyHpBar();
        }

        void ApplyHpBar()
        {
            if (_hpRoot == null) return;
            _hpRoot.gameObject.SetActive(_showHp);
            if (!_showHp || _hpFill == null) return;

            var w = Mathf.Max(0.02f, 0.52f * _hpFrac);
            _hpFill.localScale = new Vector3(w, 0.045f, 0.03f);
            _hpFill.localPosition = new Vector3((-0.52f + w) * 0.5f, 0f, -0.01f);

            var r = _hpFill.GetComponent<Renderer>();
            if (r != null && r.sharedMaterial != null)
            {
                var col = _hpFrac > 0.5f
                    ? Color.Lerp(new Color(0.9f, 0.75f, 0.2f), new Color(0.25f, 0.85f, 0.35f), (_hpFrac - 0.5f) * 2f)
                    : Color.Lerp(new Color(0.85f, 0.2f, 0.18f), new Color(0.9f, 0.75f, 0.2f), _hpFrac * 2f);
                if (r.sharedMaterial.HasProperty("_BaseColor"))
                    r.sharedMaterial.SetColor("_BaseColor", col);
                else if (r.sharedMaterial.HasProperty("_Color"))
                    r.sharedMaterial.color = col;
            }
        }

        public static bool IsPlaceholderPrefab(GameObject prefab)
        {
            if (prefab == null) return true;
            var n = prefab.name;
            return n.StartsWith("CW_") || n.Contains("Placeholder");
        }

        static float TargetModelHeight(UnitKind kind, string race)
        {
            var baseH = kind switch
            {
                UnitKind.Commander => 1.55f,
                UnitKind.Officer => 1.35f,
                _ => 1.15f,
            };
            if (string.IsNullOrEmpty(race)) return baseH;
            return race switch
            {
                "Dwarf" => baseH * 0.78f,
                "Dragon" => baseH * 1.35f,
                "Lizardman" or "Lizardmen" => baseH * 1.05f,
                "Beastfolk" => baseH * 1.08f,
                "Demon" => baseH * 1.12f,
                "Construct" => baseH,
                _ => baseH,
            };
        }

        void Update()
        {
            if (_root == null || !Application.isPlaying) return;
            _idlePhase += Time.deltaTime * (_selected ? 2.4f : 1.6f);
            var bob = Mathf.Sin(_idlePhase) * 0.025f;
            _root.localPosition = _baseLocalPos + new Vector3(0f, bob, 0f);
            if (_animator != null && _animator.enabled)
                TrySetAnimBool("Idle", true);
        }

        public void PlayMove()
        {
            TrySetAnimTrigger("Move");
            TrySetAnimBool("Moving", true);
        }

        public void StopMove()
        {
            TrySetAnimBool("Moving", false);
            TrySetAnimTrigger("Idle");
        }

        public void PlayAttack() => TrySetAnimTrigger("Attack");

        public void PlayHit()
        {
            TrySetAnimTrigger("Hit");
            TrySetAnimTrigger("Hurt");
        }

        void TrySetAnimTrigger(string name)
        {
            if (_animator == null) return;
            foreach (var p in _animator.parameters)
            {
                if (p.name == name && p.type == AnimatorControllerParameterType.Trigger)
                {
                    _animator.SetTrigger(name);
                    return;
                }
            }
        }

        void TrySetAnimBool(string name, bool value)
        {
            if (_animator == null) return;
            foreach (var p in _animator.parameters)
            {
                if (p.name == name && p.type == AnimatorControllerParameterType.Bool)
                {
                    _animator.SetBool(name, value);
                    return;
                }
            }
        }

        static Bounds ApproxBounds(GameObject go)
        {
            var renderers = go.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) return new Bounds(Vector3.zero, Vector3.one);
            var b = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++)
                b.Encapsulate(renderers[i].bounds);
            return new Bounds(go.transform.InverseTransformPoint(b.center), b.size);
        }

        static void ApplyTint(GameObject go, Color tint)
        {
            if (go == null || tint.a < 0.01f) return;
            // Near-white keeps Quaternius / catalog textures intact.
            if (tint.r > 0.95f && tint.g > 0.95f && tint.b > 0.95f) return;

            foreach (var r in go.GetComponentsInChildren<Renderer>())
            {
                if (r == null) continue;
                var mats = r.materials;
                for (var i = 0; i < mats.Length; i++)
                {
                    if (mats[i] == null) continue;
                    if (mats[i].HasProperty("_BaseColor"))
                        mats[i].SetColor("_BaseColor", Color.Lerp(mats[i].GetColor("_BaseColor"), tint, 0.35f));
                    else if (mats[i].HasProperty("_Color"))
                        mats[i].SetColor("_Color", Color.Lerp(mats[i].color, tint, 0.35f));
                }
                r.materials = mats;
            }
        }

        static void StripColliders(GameObject go)
        {
            foreach (var col in go.GetComponentsInChildren<Collider>(true))
            {
                if (Application.isPlaying) Object.Destroy(col);
                else Object.DestroyImmediate(col);
            }
        }

        static GameObject Prim(
            PrimitiveType type,
            string name,
            Transform parent,
            Vector3 localPos,
            Vector3 localScale,
            Color color,
            bool castShadow = false)
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
                    color, null, 1f, 0.35f, 0.05f, color * 0.2f);
                r.sharedMaterial = mat;
                r.shadowCastingMode = castShadow
                    ? UnityEngine.Rendering.ShadowCastingMode.On
                    : UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = castShadow;
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
            _modelRoot = null;
            _plate = null;
            _plateRim = null;
            _hpRoot = null;
            _hpFill = null;
            _animator = null;
        }

        public void SetSelected(bool selected)
        {
            _selected = selected;
            ApplySelectedVisual();
        }

        void ApplySelectedVisual()
        {
            if (_root == null) return;
            _root.localScale = _selected ? Vector3.one * 1.08f : Vector3.one;
            if (_plateRim != null)
            {
                var r = _plateRim.GetComponent<Renderer>();
                if (r != null && r.sharedMaterial != null)
                {
                    var baseRim = _kind switch
                    {
                        UnitKind.Commander => new Color(0.92f, 0.78f, 0.28f),
                        UnitKind.Officer => new Color(0.75f, 0.78f, 0.85f),
                        _ => Color.Lerp(_seatColor, Color.black, 0.35f),
                    };
                    var col = _selected ? Color.Lerp(baseRim, Color.white, 0.55f) : baseRim;
                    var emission = _selected ? col * 0.45f : col * 0.12f;
                    if (r.sharedMaterial.HasProperty("_BaseColor"))
                        r.sharedMaterial.SetColor("_BaseColor", col);
                    if (r.sharedMaterial.HasProperty("_EmissionColor"))
                    {
                        r.sharedMaterial.EnableKeyword("_EMISSION");
                        r.sharedMaterial.SetColor("_EmissionColor", emission);
                    }
                }
            }
        }
    }

    /// <summary>Keeps transform facing the main camera.</summary>
    public class BillboardToCamera : MonoBehaviour
    {
        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
        }
    }
}
