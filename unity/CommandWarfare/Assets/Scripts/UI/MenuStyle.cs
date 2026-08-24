using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Slate panels (readable) + worn wood/metal shield buttons for battle feel.
    /// </summary>
    public static class MenuStyle
    {
        public static readonly Color Bg = new(0.071f, 0.078f, 0.102f, 0.94f);
        public static readonly Color Panel = new(0.086f, 0.102f, 0.133f, 0.96f);
        public static readonly Color PanelBorder = new(0.165f, 0.192f, 0.251f, 1f);
        public static readonly Color Text = new(0.91f, 0.918f, 0.929f, 1f);
        public static readonly Color Muted = new(0.545f, 0.58f, 0.62f, 1f);
        public static readonly Color Primary = new(0.231f, 0.431f, 0.647f, 1f);
        public static readonly Color PrimaryBorder = new(0.29f, 0.498f, 0.722f, 1f);
        public static readonly Color Accent = new(0.831f, 0.627f, 0.09f, 1f);
        public static readonly Color Ok = new(0.42f, 0.81f, 0.557f, 1f);
        public static readonly Color Danger = new(0.878f, 0.424f, 0.459f, 1f);
        public static readonly Color Control = new(0.165f, 0.2f, 0.267f, 1f);

        static GUIStyle _title;
        static GUIStyle _subtitle;
        static GUIStyle _body;
        static GUIStyle _muted;
        static GUIStyle _button;
        static GUIStyle _primaryButton;
        static GUIStyle _panel;
        static Texture2D _panelTex;
        static Texture2D _shieldTex;
        static Texture2D _shieldHoverTex;
        static Texture2D _shieldPressTex;
        static Texture2D _bannerTex;
        static Texture2D _bannerHoverTex;
        static Texture2D _bannerPressTex;

        public static void Ensure()
        {
            if (_title != null) return;

            // Panels stay slate (readable). Only buttons use wood/metal shield art.
            _panelTex = Solid(Panel);
            _shieldTex = MakeShield(64, 40, lit: false, pressed: false, crimson: false);
            _shieldHoverTex = MakeShield(64, 40, lit: true, pressed: false, crimson: false);
            _shieldPressTex = MakeShield(64, 40, lit: false, pressed: true, crimson: false);
            _bannerTex = MakeShield(64, 40, lit: false, pressed: false, crimson: true);
            _bannerHoverTex = MakeShield(64, 40, lit: true, pressed: false, crimson: true);
            _bannerPressTex = MakeShield(64, 40, lit: false, pressed: true, crimson: true);

            _title = new GUIStyle(GUI.skin.label)
            {
                fontSize = 42,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Text },
                richText = true,
            };
            _subtitle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 16,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Muted },
                wordWrap = true,
            };
            _body = new GUIStyle(GUI.skin.label)
            {
                fontSize = 14,
                normal = { textColor = Text },
                wordWrap = true,
                richText = true,
            };
            _muted = new GUIStyle(GUI.skin.label)
            {
                fontSize = 12,
                normal = { textColor = Muted },
                wordWrap = true,
            };
            var onWood = new Color(0.95f, 0.9f, 0.75f);
            _button = new GUIStyle(GUI.skin.button)
            {
                fontSize = 15,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                clipping = TextClipping.Overflow,
                border = new RectOffset(12, 12, 10, 10),
                padding = new RectOffset(18, 18, 10, 10),
                normal = { background = _shieldTex, textColor = onWood },
                hover = { background = _shieldHoverTex, textColor = Color.white },
                active = { background = _shieldPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
                focused = { background = _shieldHoverTex, textColor = onWood },
            };
            _primaryButton = new GUIStyle(_button)
            {
                fontSize = 17,
                normal = { background = _bannerTex, textColor = onWood },
                hover = { background = _bannerHoverTex, textColor = Color.white },
                active = { background = _bannerPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
                focused = { background = _bannerHoverTex, textColor = onWood },
            };
            _panel = new GUIStyle(GUI.skin.box)
            {
                normal = { background = _panelTex, textColor = Text },
                border = new RectOffset(8, 8, 8, 8),
                padding = new RectOffset(16, 16, 16, 16),
            };
        }

        static GUIStyle _compactButton;
        static GUIStyle _compactPrimary;

        public static GUIStyle Title => EnsureRet(() => _title);
        public static GUIStyle Subtitle => EnsureRet(() => _subtitle);
        public static GUIStyle Body => EnsureRet(() => _body);
        public static GUIStyle MutedLabel => EnsureRet(() => _muted);
        public static GUIStyle Button => EnsureRet(() => _button);
        public static GUIStyle PrimaryButton => EnsureRet(() => _primaryButton);
        public static GUIStyle CompactButton
        {
            get
            {
                Ensure();
                EnsureCompact();
                return _compactButton;
            }
        }
        public static GUIStyle CompactPrimary
        {
            get
            {
                Ensure();
                EnsureCompact();
                return _compactPrimary;
            }
        }
        public static GUIStyle PanelBox => EnsureRet(() => _panel);

        static void EnsureCompact()
        {
            if (_compactButton != null) return;
            var onWood = new Color(0.95f, 0.9f, 0.75f);
            _compactButton = new GUIStyle(GUI.skin.button)
            {
                fontSize = 12,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft,
                clipping = TextClipping.Clip,
                wordWrap = false,
                border = new RectOffset(12, 12, 10, 10),
                padding = new RectOffset(14, 12, 6, 6),
                normal = { background = _shieldTex, textColor = onWood },
                hover = { background = _shieldHoverTex, textColor = Color.white },
                active = { background = _shieldPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
            };
            _compactPrimary = new GUIStyle(_compactButton)
            {
                normal = { background = _bannerTex, textColor = onWood },
                hover = { background = _bannerHoverTex, textColor = Color.white },
                active = { background = _bannerPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
            };
        }

        public static void DrawPanel(Rect rect, string title = null)
        {
            Ensure();
            GUI.Box(rect, GUIContent.none, PanelBox);
            if (!string.IsNullOrEmpty(title))
            {
                var prev = GUI.color;
                GUI.color = Accent;
                GUI.Label(new Rect(rect.x + 18, rect.y + 10, rect.width - 36, 22), title.ToUpperInvariant(), MutedLabel);
                GUI.color = prev;
            }
        }

        static GUIStyle _dropdownItem;
        static GUIStyle _dropdownItemOn;
        static GUIStyle _dropdownField;
        static Vector2 _dropdownScroll;
        static int _dropdownHighlight = -1;
        static int _dropdownFocusId = -1;

        public static Color RarityColor(string rarity) => (rarity ?? "").ToLowerInvariant() switch
        {
            "legendary" => new Color(0.486f, 0.227f, 0.929f),
            "epic" => new Color(0.918f, 0.345f, 0.047f),
            "rare" => new Color(0.831f, 0.686f, 0.216f),
            "uncommon" => new Color(0.659f, 0.663f, 0.678f),
            _ => new Color(0.35f, 0.37f, 0.4f),
        };

        static Texture2D _whiteDot;

        /// <summary>Small filled rarity pip (Common gray → Legendary purple).</summary>
        public static void DrawRarityDot(Rect r, string rarity)
        {
            Ensure();
            if (_whiteDot == null)
                _whiteDot = Solid(Color.white);
            var prev = GUI.color;
            GUI.color = RarityColor(rarity);
            GUI.DrawTexture(r, _whiteDot);
            GUI.color = prev;
        }

        public static bool PrimaryBtn(Rect r, string label) => GUI.Button(r, label, PrimaryButton);
        public static bool Btn(Rect r, string label) => GUI.Button(r, label, Button);

        /// <summary>One-shot dropdown (field + popup). Prefer the drawPopup overload when stacking fields.</summary>
        public static bool Dropdown(Rect rect, string[] options, ref int index, ref bool open)
        {
            var id = unchecked((int)(rect.x * 31 + rect.y * 997 + (options?.Length ?? 0)));
            Dropdown(rect, options, ref index, ref open, id, drawPopup: false);
            return Dropdown(rect, options, ref index, ref open, id, drawPopup: true);
        }

        /// <summary>
        /// Compact dropdown with scroll + arrow/enter/escape. When <paramref name="drawPopup"/> is false,
        /// only the closed field is drawn (call again later with drawPopup true so the list paints on top).
        /// </summary>
        public static bool Dropdown(
            Rect rect,
            string[] options,
            ref int index,
            ref bool open,
            int controlId,
            bool drawPopup,
            float maxPopupHeight = 200f)
        {
            Ensure();
            EnsureDropdownStyles();
            if (options == null || options.Length == 0) return false;
            index = Mathf.Clamp(index, 0, options.Length - 1);
            var changed = false;

            if (!drawPopup)
            {
                var label = options[index] + "  ▾";
                if (GUI.Button(rect, label, _dropdownField))
                {
                    open = !open;
                    if (open)
                    {
                        _dropdownFocusId = controlId;
                        _dropdownHighlight = index;
                        _dropdownScroll = Vector2.zero;
                    }
                    else if (_dropdownFocusId == controlId)
                        _dropdownFocusId = -1;
                }
                return false;
            }

            if (!open || _dropdownFocusId != controlId) return false;

            if (_dropdownHighlight < 0 || _dropdownHighlight >= options.Length)
                _dropdownHighlight = index;

            const float rowH = 30f;
            var contentH = 4f + options.Length * rowH + 4f;
            var listH = Mathf.Min(contentH, maxPopupHeight);
            var list = new Rect(rect.x, rect.yMax + 2f, Mathf.Max(rect.width, 160f), listH);

            var e = Event.current;
            // Click outside field+popup closes without activating covered controls.
            if (e != null && e.type == EventType.MouseDown)
            {
                var inField = rect.Contains(e.mousePosition);
                var inList = list.Contains(e.mousePosition);
                if (!inField && !inList)
                {
                    open = false;
                    _dropdownFocusId = -1;
                    e.Use();
                    return false;
                }
            }

            if (e != null && e.type == EventType.KeyDown)
            {
                if (e.keyCode == KeyCode.UpArrow)
                {
                    _dropdownHighlight = Mathf.Max(0, _dropdownHighlight - 1);
                    EnsureHighlightVisible(options.Length, rowH, listH);
                    e.Use();
                }
                else if (e.keyCode == KeyCode.DownArrow)
                {
                    _dropdownHighlight = Mathf.Min(options.Length - 1, _dropdownHighlight + 1);
                    EnsureHighlightVisible(options.Length, rowH, listH);
                    e.Use();
                }
                else if (e.keyCode is KeyCode.Return or KeyCode.KeypadEnter)
                {
                    if (_dropdownHighlight != index)
                    {
                        index = _dropdownHighlight;
                        changed = true;
                    }
                    open = false;
                    _dropdownFocusId = -1;
                    e.Use();
                }
                else if (e.keyCode == KeyCode.Escape)
                {
                    open = false;
                    _dropdownFocusId = -1;
                    e.Use();
                }
            }

            GUI.Box(list, GUIContent.none, PanelBox);
            var view = new Rect(0, 0, list.width - 18f, contentH);
            _dropdownScroll = GUI.BeginScrollView(list, _dropdownScroll, view, false, contentH > listH);
            for (var i = 0; i < options.Length; i++)
            {
                var row = new Rect(6f, 4f + i * rowH, view.width - 12f, rowH - 2f);
                var on = i == _dropdownHighlight;
                if (GUI.Button(row, options[i], on ? _dropdownItemOn : _dropdownItem))
                {
                    if (i != index)
                    {
                        index = i;
                        changed = true;
                    }
                    open = false;
                    _dropdownFocusId = -1;
                }
            }
            GUI.EndScrollView();
            return changed;
        }

        static void EnsureHighlightVisible(int count, float rowH, float listH)
        {
            var top = 4f + _dropdownHighlight * rowH;
            var bottom = top + rowH;
            if (top < _dropdownScroll.y)
                _dropdownScroll.y = top;
            else if (bottom > _dropdownScroll.y + listH - 8f)
                _dropdownScroll.y = bottom - listH + 8f;
            _dropdownScroll.y = Mathf.Clamp(_dropdownScroll.y, 0f, Mathf.Max(0f, 4f + count * rowH + 4f - listH));
        }

        /// <summary>Close any open MenuStyle dropdown (e.g. when clicking elsewhere).</summary>
        public static void CloseDropdowns(ref bool a, ref bool b)
        {
            a = false;
            b = false;
            _dropdownFocusId = -1;
        }

        /// <summary>Dismiss the currently focused dropdown without touching caller open flags.</summary>
        public static void DismissOpenDropdown()
        {
            _dropdownFocusId = -1;
        }

        static void EnsureDropdownStyles()
        {
            if (_dropdownField != null) return;
            var onWood = new Color(0.95f, 0.9f, 0.75f);
            _dropdownField = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft,
                border = new RectOffset(12, 12, 10, 10),
                padding = new RectOffset(14, 14, 6, 6),
                clipping = TextClipping.Clip,
                normal = { background = _shieldTex, textColor = onWood },
                hover = { background = _shieldHoverTex, textColor = Color.white },
                active = { background = _shieldPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
            };
            _dropdownItem = new GUIStyle(GUI.skin.button)
            {
                fontSize = 12,
                alignment = TextAnchor.MiddleLeft,
                border = new RectOffset(12, 12, 10, 10),
                padding = new RectOffset(12, 10, 4, 4),
                clipping = TextClipping.Clip,
                wordWrap = false,
                normal = { background = _shieldTex, textColor = onWood },
                hover = { background = _shieldHoverTex, textColor = Color.white },
                active = { background = _shieldPressTex, textColor = new Color(1f, 0.92f, 0.7f) },
            };
            _dropdownItemOn = new GUIStyle(_dropdownItem)
            {
                fontStyle = FontStyle.Bold,
                normal = { background = _bannerTex, textColor = onWood },
            };
        }

        static GUIStyle EnsureRet(System.Func<GUIStyle> get)
        {
            Ensure();
            return get();
        }

        static Texture2D Solid(Color c)
        {
            var t = new Texture2D(2, 2, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            t.SetPixels(new[] { c, c, c, c });
            t.Apply(false, true);
            return t;
        }

        /// <summary>Worn wooden shield face with soft rounded corners and metal rim.</summary>
        static Texture2D MakeShield(int w, int h, bool lit, bool pressed, bool crimson)
        {
            var t = NewTex(w, h);
            const float radius = 9f;
            const float rim = 3.5f;
            for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var dist = RoundedRectSignedDist(x + 0.5f, y + 0.5f, w, h, radius);
                if (dist > 0.75f)
                {
                    t.SetPixel(x, y, Color.clear);
                    continue;
                }

                var n = Hash(x + (crimson ? 17 : 0), y + (lit ? 3 : 0));
                Color c;
                if (dist > -rim)
                {
                    var brass = crimson || lit;
                    var baseMetal = brass
                        ? new Color(0.72f, 0.6f, 0.32f)
                        : new Color(0.42f, 0.42f, 0.44f);
                    var shade = pressed ? 0.75f : (lit ? 1.1f : 1f);
                    c = baseMetal * (shade * (0.85f + n * 0.2f));
                    c.a = 1f;
                    if (dist > -1.2f)
                        c *= 0.55f;
                }
                else if (crimson)
                {
                    var v = pressed ? 0.22f : (lit ? 0.4f : 0.32f);
                    v += Mathf.Sin(x * 0.35f) * 0.03f + n * 0.04f;
                    c = new Color(0.48f * (v + 0.5f), 0.12f + v * 0.1f, 0.1f, 1f);
                }
                else
                {
                    var grain = Mathf.Sin(x * 0.7f + y * 0.05f) * 0.045f;
                    var v = pressed ? 0.18f : (lit ? 0.34f : 0.26f);
                    v += grain + n * 0.04f;
                    if (x % (w / 4) == 0) v *= 0.75f;
                    c = new Color(0.38f * v + 0.12f, 0.24f * v + 0.07f, 0.1f * v + 0.04f, 1f);
                    if (((x * 13 + y * 7) & 31) == 0)
                        c = Color.Lerp(c, c * 0.6f, 0.5f);
                }

                // Soft AA on the outer edge
                if (dist > -0.5f)
                    c.a *= Mathf.Clamp01(0.75f - dist);
                t.SetPixel(x, y, c);
            }
            t.Apply(false, true);
            return t;
        }

        /// <summary>Negative inside, positive outside a rounded rect covering [0..w] x [0..h].</summary>
        static float RoundedRectSignedDist(float px, float py, int w, int h, float radius)
        {
            var half = new Vector2(w * 0.5f, h * 0.5f);
            var p = new Vector2(px, py) - half;
            var b = half - new Vector2(radius, radius);
            var q = new Vector2(Mathf.Abs(p.x), Mathf.Abs(p.y)) - b;
            return Vector2.Max(q, Vector2.zero).magnitude + Mathf.Min(Mathf.Max(q.x, q.y), 0f) - radius;
        }

        static Texture2D NewTex(int w, int h)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            return t;
        }

        static float Hash(int x, int y)
        {
            var n = x * 374761393 + y * 668265263;
            n = (n ^ (n >> 13)) * 1274126177;
            return ((n ^ (n >> 16)) & 0xFFFF) / 65535f;
        }
    }
}
