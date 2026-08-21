using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Play-prototype slate + editor gold accents for IMGUI menus.</summary>
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
        static Texture2D _primaryTex;
        static Texture2D _controlTex;
        static Texture2D _accentTex;

        public static void Ensure()
        {
            if (_title != null) return;

            _panelTex = Solid(Panel);
            _primaryTex = Solid(Primary);
            _controlTex = Solid(Control);
            _accentTex = Solid(Accent);

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
            _button = new GUIStyle(GUI.skin.button)
            {
                fontSize = 15,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                normal = { background = _controlTex, textColor = Text },
                hover = { background = _primaryTex, textColor = Text },
                active = { background = _accentTex, textColor = Color.black },
                padding = new RectOffset(12, 12, 8, 8),
            };
            _primaryButton = new GUIStyle(_button)
            {
                fontSize = 17,
                normal = { background = _primaryTex, textColor = Text },
                hover = { background = _accentTex, textColor = Color.black },
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
            _compactButton = new GUIStyle(GUI.skin.button)
            {
                fontSize = 12,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft,
                clipping = TextClipping.Clip,
                wordWrap = false,
                padding = new RectOffset(8, 8, 4, 4),
                normal = { background = _controlTex, textColor = Text },
                hover = { background = _primaryTex, textColor = Text },
                active = { background = _accentTex, textColor = Color.black },
            };
            _compactPrimary = new GUIStyle(_compactButton)
            {
                normal = { background = _primaryTex, textColor = Text },
                hover = { background = _accentTex, textColor = Color.black },
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

            const float rowH = 26f;
            var contentH = 4f + options.Length * rowH + 4f;
            var listH = Mathf.Min(contentH, maxPopupHeight);
            var list = new Rect(rect.x, rect.yMax + 2f, Mathf.Max(rect.width, 160f), listH);

            // Keyboard while this popup owns focus.
            var e = Event.current;
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

        static void EnsureDropdownStyles()
        {
            if (_dropdownField != null) return;
            _dropdownField = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(10, 10, 4, 4),
                clipping = TextClipping.Clip,
                normal = { background = _controlTex, textColor = Text },
                hover = { background = _primaryTex, textColor = Text },
                active = { background = _accentTex, textColor = Color.black },
            };
            _dropdownItem = new GUIStyle(GUI.skin.button)
            {
                fontSize = 12,
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(10, 8, 2, 2),
                clipping = TextClipping.Clip,
                wordWrap = false,
                normal = { background = _controlTex, textColor = Text },
                hover = { background = _primaryTex, textColor = Text },
                active = { background = _accentTex, textColor = Color.black },
            };
            _dropdownItemOn = new GUIStyle(_dropdownItem)
            {
                fontStyle = FontStyle.Bold,
                normal = { background = _primaryTex, textColor = Text },
            };
        }

        static GUIStyle EnsureRet(System.Func<GUIStyle> get)
        {
            Ensure();
            return get();
        }

        static Texture2D Solid(Color c)
        {
            var t = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            t.SetPixels(new[] { c, c, c, c });
            t.Apply();
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }
    }
}
