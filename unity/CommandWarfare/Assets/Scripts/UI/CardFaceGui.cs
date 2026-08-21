using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Prototype CardFace port — 5:7 parchment card with gold frame, typed banner,
    /// art|stats mid, type strip, keywords/abilities (cost + icon + description), flavor.
    /// </summary>
    public static class CardFaceGui
    {
        public const float RefW = 420f;
        public const float RefH = 588f; // 5:7
        const float RootPx = 16f;
        const int MaxAbilities = 5;

        static Texture2D _parchment;
        static Texture2D _gold;
        static Texture2D _artBg;
        static Texture2D _bannerCommander;
        static Texture2D _bannerOfficer;
        static Texture2D _bannerUnit;
        static Texture2D _statRow;
        static Texture2D _statRowAlt;
        static Texture2D _typeStrip;
        static Texture2D _white;
        static Texture2D _ruleDivider;
        static Texture2D _paperTexture;
        static Texture2D _iconPassive;
        static Texture2D _iconActive;
        static Texture2D _iconUltimate;
        static Texture2D _roundParchment;
        static Texture2D _roundFrameTex;
        static GUIStyle _roundCard;
        static GUIStyle _roundFrame;
        static int _roundBorderPx = -1;
        static bool _textureTried;
        static string _textureFail;

        public static Rect FitCardRect(Rect bounds)
        {
            var w = bounds.width;
            var h = w * (RefH / RefW);
            if (h > bounds.height)
            {
                h = bounds.height;
                w = h * (RefW / RefH);
            }
            return new Rect(
                bounds.x + (bounds.width - w) * 0.5f,
                bounds.y + (bounds.height - h) * 0.5f,
                w, h);
        }

        public static void Draw(Rect bounds, CardDefinition card, AbilityDatabase abilities = null)
        {
            EnsureTextures();
            var rect = FitCardRect(bounds);
            var s = Scale(rect.width);
            var radius = Mathf.Max(14f, 18f * s);
            if (card == null)
            {
                DrawRoundedParchment(rect, radius);
                DrawOrnateBorder(rect, Mathf.Max(2f, 3f * s), s, radius);
                DrawPaperOverlay(Inset(rect, radius * 0.5f), s);
                Label(rect, "Select a card", Style(Rem(0.85f) * s, FontStyle.Normal,
                    new Color(0.4f, 0.35f, 0.3f), TextAnchor.MiddleCenter, true));
                return;
            }

            var ink = new Color(0.11f, 0.09f, 0.08f);
            var muted = new Color(0.29f, 0.26f, 0.22f);
            var cream = new Color(0.973f, 0.945f, 0.89f);
            var abilityInk = new Color(0.165f, 0.141f, 0.11f);
            var ultimateInk = new Color(0.486f, 0.227f, 0.176f);

            DrawRoundedParchment(rect, radius);
            DrawOrnateBorder(rect, Mathf.Max(2f, 3f * s), s, radius);

            // Single content inset (css .kb-content-wrapper inset: 12px) + thin inner gold.
            var content = Inset(rect, 12f * s);
            DrawFrame(content, Mathf.Max(1f, 1.5f * s), _gold);
            content = Inset(content, Mathf.Max(1f, 2f * s));

            var rows = BuildStatRows(card);
            var bannerH = content.height * 0.043f;
            var midH = content.height * 0.39f;

            // Type strip sized to the actual type line (css: padding 0.16rem + 0.66rem text).
            // Too-small typeH was clipping lines like "… · FLYING · …" against abilities below.
            var typeLine = BuildTypeLine(card);
            var typeStyle = Style(Rem(0.66f) * s, FontStyle.Bold, ink, TextAnchor.MiddleCenter, false);
            var typePadY = 0.2f * RootPx * s;
            var typeTextH = Mathf.Max(
                typeStyle.CalcHeight(new GUIContent(typeLine), content.width - 4f * s),
                Rem(0.66f) * 1.35f * s);
            var typeH = Mathf.Max(typeTextH + typePadY * 2f + 2f * s, 22f * s);
            // Prefer stealing a little from mid over clipping the type line.
            if (bannerH + midH + typeH > content.height * 0.92f)
                midH = Mathf.Max(content.height * 0.32f, content.height * 0.92f - bannerH - typeH);
            var rulesH = Mathf.Max(1f, content.height - bannerH - midH - typeH);

            // Banner
            var banner = new Rect(content.x, content.y, content.width, bannerH);
            var bannerTex = card.cardType switch
            {
                "Commander" => _bannerCommander,
                "Officer" => _bannerOfficer,
                _ => _bannerUnit,
            };
            GUI.DrawTexture(banner, bannerTex);
            GUI.DrawTexture(new Rect(banner.x, banner.yMax - Mathf.Max(1.5f, 2f * s), banner.width,
                Mathf.Max(1.5f, 2f * s)), _gold);
            var bannerColor = card.cardType == "Unit" ? ink : cream;
            Label(banner, (card.displayName ?? "?").ToUpperInvariant(),
                Style(Rem(0.72f) * s, FontStyle.Bold, bannerColor, TextAnchor.MiddleCenter, true));

            // Mid: art | stats (1.85 : 1)
            var mid = new Rect(content.x, banner.yMax, content.width, midH);
            var artW = mid.width * (1.85f / 2.85f);
            var artRect = new Rect(mid.x, mid.y, artW, mid.height);
            var statsRect = new Rect(mid.x + artW, mid.y, mid.width - artW, mid.height);
            GUI.DrawTexture(artRect, _artBg);
            GUI.DrawTexture(new Rect(artRect.xMax - Mathf.Max(1.5f, 2f * s), artRect.y,
                Mathf.Max(1.5f, 2f * s), artRect.height), _gold);

            var art = CardArtLoader.Get(card.cardId);
            if (art != null)
                GUI.DrawTexture(artRect, art, ScaleMode.ScaleAndCrop);
            else
                Label(artRect, "No image", Style(Rem(0.85f) * s, FontStyle.Normal,
                    new Color(0.7f, 0.72f, 0.78f), TextAnchor.MiddleCenter, false));

            DrawStatsColumn(statsRect, rows, s, ink, muted);

            // Type strip
            var typeRect = new Rect(content.x, mid.yMax, content.width, typeH);
            GUI.DrawTexture(typeRect, _typeStrip);
            var goldT = Mathf.Max(1f, 1f * s);
            GUI.DrawTexture(new Rect(typeRect.x, typeRect.y, typeRect.width, goldT), _gold);
            GUI.DrawTexture(new Rect(typeRect.x, typeRect.yMax - goldT, typeRect.width, goldT), _gold);
            var typeLabelRect = new Rect(typeRect.x + 4f * s, typeRect.y + goldT + 1f * s,
                typeRect.width - 8f * s, typeRect.height - goldT * 2f - 2f * s);
            Label(typeLabelRect, typeLine, typeStyle);

            // Rules
            var rules = new Rect(content.x, typeRect.yMax, content.width, rulesH);
            GUI.DrawTexture(rules, _parchment);
            var padX = 0.6f * RootPx * s;
            var padY = 0.3f * RootPx * s;
            var footerH = Mathf.Max(22f, (Rem(0.66f) + 14f) * s);
            var ry = rules.y + padY;

            if (card.keywords != null && card.keywords.Length > 0)
            {
                var kwText = string.Join(", ", card.keywords);
                var kwStyle = Style(Rem(0.72f) * s, FontStyle.Bold, ink, TextAnchor.UpperLeft, true);
                var kwW = rules.width - padX * 2;
                var kwH = Mathf.Max(
                    kwStyle.CalcHeight(new GUIContent(kwText), kwW),
                    Rem(0.72f) * 1.35f * s);
                Label(new Rect(rules.x + padX, ry, kwW, kwH), kwText, kwStyle);
                ry += kwH + 0.22f * RootPx * s;
                GUI.DrawTexture(new Rect(rules.x + padX, ry, kwW, 1f), _ruleDivider);
                ry += 0.32f * RootPx * s; // clear gap so abilities don't crowd keywords/type
            }
            else
            {
                // Keep a little air under the type strip when there are no keywords.
                ry += 0.12f * RootPx * s;
            }

            var abilityRows = BuildAbilityRows(card, abilities);
            var abilityBottom = rules.yMax - footerH - padY * 0.5f;
            var abilitySpace = Mathf.Max(0f, abilityBottom - ry);
            var abilityH = abilityRows.Count > 0 ? abilitySpace / abilityRows.Count : 0f;
            var abilityFont = Mathf.Min(Rem(0.7f) * s, Mathf.Max(8f, abilityH * 0.42f));
            var costFont = Mathf.Min(Rem(0.62f) * s, Mathf.Max(7f, abilityH * 0.28f));
            for (var i = 0; i < abilityRows.Count; i++)
            {
                var row = abilityRows[i];
                var rowRect = new Rect(rules.x + padX, ry + i * abilityH, rules.width - padX * 2,
                    Mathf.Max(1f, abilityH - 1f * s));
                DrawAbilityRow(rowRect, row, s, abilityFont, costFont, abilityInk, ultimateInk);
            }

            // Footer
            var footer = new Rect(rules.x + padX, rules.yMax - footerH, rules.width - padX * 2, footerH);
            GUI.DrawTexture(new Rect(footer.x, footer.y, footer.width, 1f), _ruleDivider);
            if (!string.IsNullOrEmpty(card.flavorText))
            {
                var flavor = card.flavorText.Length > 110 ? card.flavorText[..110] + "…" : card.flavorText;
                Label(new Rect(footer.x, footer.y + 4f * s, footer.width - 22f * s, footer.height - 6f * s),
                    $"“{flavor}”",
                    Style(Rem(0.66f) * s, FontStyle.Italic, muted, TextAnchor.MiddleLeft, true));
            }
            var mark = 20f * s;
            DrawRarityMark(new Rect(footer.xMax - mark, footer.y + (footer.height - mark) * 0.5f, mark, mark),
                card.rarity);

            // Paper grit is baked into parchment fills (see TryLoadPaperTexture).
            // A light top overlay remains so banner/art edges also pick up grain like css ::before.
            DrawPaperOverlay(Inset(rect, radius * 0.5f), s);
        }

        static void DrawAbilityRow(Rect row, AbilityRow data, float s, float abilityFont, float costFont,
            Color abilityInk, Color ultimateInk)
        {
            var costColW = 3.6f * RootPx * s;
            var iconSize = Mathf.Min(16f * s, row.height * 0.55f);
            var costCol = new Rect(row.x, row.y, costColW, row.height);
            var textCol = new Rect(row.x + costColW + 0.3f * RootPx * s, row.y,
                Mathf.Max(1f, row.width - costColW - 0.3f * RootPx * s), row.height);

            var iconTex = data.kind switch
            {
                AbilityKind.Passive => _iconPassive,
                AbilityKind.Ultimate => _iconUltimate,
                _ => _iconActive,
            };
            var iconRect = new Rect(costCol.x + (costCol.width - iconSize) * 0.5f, costCol.y + 1f * s,
                iconSize, iconSize);
            if (iconTex != null)
                GUI.DrawTexture(iconRect, iconTex, ScaleMode.ScaleToFit);

            if (!string.IsNullOrEmpty(data.costLabel))
            {
                Label(new Rect(costCol.x, iconRect.yMax + 1f * s, costCol.width,
                        Mathf.Max(1f, costCol.yMax - iconRect.yMax - 1f * s)),
                    data.costLabel,
                    Style(costFont, FontStyle.Bold, new Color(0.29f, 0.25f, 0.20f), TextAnchor.UpperCenter, false));
            }

            var ink = data.kind == AbilityKind.Ultimate ? ultimateInk : abilityInk;
            var body = string.IsNullOrEmpty(data.description)
                ? $"<b>{Escape(data.name)}</b>"
                : $"<b>{Escape(data.name)}</b> - {Escape(data.description)}";
            Label(textCol, body, Style(abilityFont, FontStyle.Normal, ink, TextAnchor.UpperLeft, true, true));
        }

        static void DrawStatsColumn(Rect rect, List<(string label, string value)> rows, float s,
            Color ink, Color muted)
        {
            if (rows.Count == 0) return;
            var rowH = rect.height / rows.Count;
            var fontPx = Mathf.Min(Rem(0.72f) * s, Mathf.Max(8f, rowH * 0.68f));
            var labelStyle = Style(fontPx, FontStyle.Normal, muted, TextAnchor.MiddleLeft, false);
            var valueStyle = Style(fontPx, FontStyle.Bold, ink, TextAnchor.MiddleRight, false);
            var padL = 0.4f * RootPx * s;
            var padR = 0.4f * RootPx * s;
            for (var i = 0; i < rows.Count; i++)
            {
                var row = new Rect(rect.x, rect.y + i * rowH, rect.width, rowH);
                GUI.DrawTexture(row, i % 2 == 1 ? _statRowAlt : _statRow);
                var split = row.width * 0.62f;
                Label(new Rect(row.x + padL, row.y, split - padL, row.height), rows[i].label, labelStyle);
                Label(new Rect(row.x + split, row.y, row.width - split - padR, row.height),
                    rows[i].value, valueStyle);
            }
        }

        static List<(string label, string value)> BuildStatRows(CardDefinition card)
        {
            var rows = new List<(string, string)>
            {
                ("UV", Stat(card.uv)),
                ("Move", Stat(card.move)),
                ("Damage", Stat(card.damage)),
                ("Range", Stat(card.range)),
                ("Toughness", Stat(card.toughness)),
            };
            if (string.Equals(card.cardType, "Officer", StringComparison.OrdinalIgnoreCase))
            {
                rows.Add(("Company AP", Stat(card.companyAp)));
                rows.Add(("Company Cap.", Stat(card.companyCapacity)));
                rows.Add(("Unit cap", Stat(card.companyUnitCap)));
                rows.Add(("Cmd Radius", Stat(card.commandRadius)));
            }
            else if (string.Equals(card.cardType, "Commander", StringComparison.OrdinalIgnoreCase))
            {
                rows.Add(("AP", Stat(card.apGeneration)));
                rows.Add(("CC", Stat(card.ccGeneration)));
                rows.Add(("Cmd Radius", Stat(card.commandRadius)));
            }
            return rows;
        }

        static List<AbilityRow> BuildAbilityRows(CardDefinition card, AbilityDatabase db)
        {
            var list = new List<AbilityRow>();
            var names = new List<string>();
            if (card.abilities != null)
            {
                foreach (var a in card.abilities)
                {
                    if (string.IsNullOrWhiteSpace(a)) continue;
                    names.Add(a.Trim());
                }
            }

            names.Sort((a, b) =>
            {
                var ra = DisplayRank(db?.FindByName(a));
                var rb = DisplayRank(db?.FindByName(b));
                if (ra != rb) return ra.CompareTo(rb);
                var aa = db?.FindByName(a);
                var ab = db?.FindByName(b);
                var ca = aa?.costAmount ?? 0;
                var cb = ab?.costAmount ?? 0;
                if (ca != cb) return ca.CompareTo(cb);
                return string.Compare(a, b, StringComparison.OrdinalIgnoreCase);
            });

            var hasUltimate = !string.IsNullOrWhiteSpace(card.ultimate);
            var maxRegular = hasUltimate ? MaxAbilities - 1 : MaxAbilities;
            for (var i = 0; i < names.Count && list.Count < maxRegular; i++)
            {
                var name = names[i];
                var def = db?.FindByName(name);
                list.Add(new AbilityRow
                {
                    name = name,
                    description = def?.description ?? "",
                    costLabel = FormatCostLabel(def, false),
                    kind = ResolveKind(def, false),
                });
            }

            if (hasUltimate)
            {
                var ultName = card.ultimate.Trim();
                var def = db?.FindByName(ultName);
                list.Add(new AbilityRow
                {
                    name = ultName,
                    description = def?.description ?? "",
                    costLabel = "",
                    kind = AbilityKind.Ultimate,
                });
            }

            return list;
        }

        static AbilityKind ResolveKind(AbilityDefinition ability, bool forceUltimate)
        {
            if (forceUltimate) return AbilityKind.Ultimate;
            if (ability == null) return AbilityKind.Active;
            var type = (ability.type ?? "").Trim();
            var cost = (ability.cost ?? "").Trim().ToLowerInvariant();
            if (type == "Passive" || cost == "passive") return AbilityKind.Passive;
            if (type == "Ultimate" || cost == "ultimate") return AbilityKind.Ultimate;
            return AbilityKind.Active;
        }

        static string FormatCostLabel(AbilityDefinition ability, bool ultimate)
        {
            if (ultimate || ability == null) return "";
            var type = (ability.type ?? "").Trim();
            if (type == "Passive" || type == "Ultimate") return "";
            var resource = (ability.costResource ?? "").Trim().ToUpperInvariant();
            if (ability.costAmount > 0 && (resource == "AP" || resource == "CC"))
                return $"{ability.costAmount} {resource}";
            var cost = (ability.cost ?? "").Trim();
            if (string.IsNullOrEmpty(cost) || Regex.IsMatch(cost, @"^(passive|ultimate)$", RegexOptions.IgnoreCase))
                return "";
            var match = Regex.Match(cost, @"^(\d+)\s*(CC|AP|COMPANY\s*AP)\b", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                var res = match.Groups[2].Value.ToUpperInvariant().Contains("CC") ? "CC" : "AP";
                return $"{match.Groups[1].Value} {res}";
            }
            return cost;
        }

        static int DisplayRank(AbilityDefinition ability)
        {
            if (ability == null) return 90;
            var kind = ResolveKind(ability, false);
            if (kind == AbilityKind.Passive) return 0;
            if (kind == AbilityKind.Ultimate) return 40;
            var resource = (ability.costResource ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(resource))
            {
                var upper = (ability.cost ?? "").ToUpperInvariant();
                if (upper.Contains("CC") && !upper.Contains("COMPANY")) resource = "CC";
                else if (upper.Contains("AP")) resource = "AP";
            }
            if (resource == "AP") return 10;
            if (resource == "CC") return 20;
            return 15;
        }

        static string BuildTypeLine(CardDefinition card)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(card.race)) parts.Add(card.race);
            if (!string.IsNullOrEmpty(card.primaryType) &&
                !string.Equals(card.primaryType, "ranged", StringComparison.OrdinalIgnoreCase))
                parts.Add(card.primaryType);
            if (!string.IsNullOrEmpty(card.secondaryType) &&
                !string.Equals(card.secondaryType, "ranged", StringComparison.OrdinalIgnoreCase))
                parts.Add(card.secondaryType);
            if (parts.Count == 0 && !string.IsNullOrEmpty(card.cardType))
                parts.Add(card.cardType);
            return string.Join(" · ", parts).ToUpperInvariant();
        }

        static void DrawRarityMark(Rect r, string rarity)
        {
            var c = (rarity ?? "").ToLowerInvariant() switch
            {
                "legendary" => new Color(0.486f, 0.227f, 0.929f),
                "epic" => new Color(0.918f, 0.345f, 0.047f),
                "rare" => new Color(0.831f, 0.686f, 0.216f),
                "uncommon" => new Color(0.659f, 0.663f, 0.678f),
                _ => new Color(0.102f, 0.102f, 0.102f),
            };
            var prev = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, _white);
            GUI.color = prev;
            DrawFrame(r, 1f, _gold);
            Label(r, "A", Style(r.height * 0.7f, FontStyle.Bold, Color.white, TextAnchor.MiddleCenter, false));
        }

        static void DrawPaperOverlay(Rect rect, float s)
        {
            if (_paperTexture == null) return;
            // Light grain pass over the finished card (css ::before). Keep alpha modest so text stays readable.
            DrawTiled(rect, _paperTexture, 200f * s, 0.22f);
        }

        static float Scale(float cardWidth) => Mathf.Max(0.01f, cardWidth / RefW);
        static float Rem(float rem) => rem * RootPx;
        static string Escape(string t) =>
            string.IsNullOrEmpty(t) ? "" : t.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

        static GUIStyle Style(float size, FontStyle font, Color color, TextAnchor align, bool wrap,
            bool rich = false) =>
            new(GUI.skin.label)
            {
                fontSize = Mathf.Max(7, Mathf.RoundToInt(size)),
                fontStyle = font,
                alignment = align,
                wordWrap = wrap,
                clipping = TextClipping.Clip,
                richText = rich,
                normal = { textColor = color },
                hover = { textColor = color },
                active = { textColor = color },
            };

        static void Label(Rect r, string text, GUIStyle style) => GUI.Label(r, text ?? "", style);

        static void DrawFrame(Rect r, float t, Texture2D tex)
        {
            GUI.DrawTexture(new Rect(r.x, r.y, r.width, t), tex);
            GUI.DrawTexture(new Rect(r.x, r.yMax - t, r.width, t), tex);
            GUI.DrawTexture(new Rect(r.x, r.y, t, r.height), tex);
            GUI.DrawTexture(new Rect(r.xMax - t, r.y, t, r.height), tex);
        }

        static void DrawRoundedParchment(Rect r, float radius)
        {
            EnsureRoundStyles(radius);
            GUI.Box(r, GUIContent.none, _roundCard);
        }

        static void EnsureRoundStyles(float radiusPx)
        {
            var border = Mathf.Clamp(Mathf.CeilToInt(radiusPx) + 2, 16, 40);
            if (_roundCard != null && _roundFrame != null && _roundBorderPx == border) return;
            _roundBorderPx = border;

            var sliceR = Mathf.Clamp(border - 2, 14, 36);
            const int slice = 96;
            _roundParchment = MakeRoundedParchmentSlice(slice, sliceR);
            _roundFrameTex = MakeRoundedFrameSlice(slice, sliceR,
                stroke: Mathf.Max(3, sliceR / 5),
                gap: Mathf.Max(2, sliceR / 8),
                innerStroke: Mathf.Max(2, sliceR / 7),
                color: new Color(0.776f, 0.655f, 0.369f));

            _roundCard = new GUIStyle(GUI.skin.box)
            {
                border = new RectOffset(border, border, border, border),
                normal = { background = _roundParchment },
                padding = new RectOffset(0, 0, 0, 0),
                margin = new RectOffset(0, 0, 0, 0),
            };
            _roundFrame = new GUIStyle(GUI.skin.box)
            {
                border = new RectOffset(border, border, border, border),
                normal = { background = _roundFrameTex },
                padding = new RectOffset(0, 0, 0, 0),
                margin = new RectOffset(0, 0, 0, 0),
            };
        }

        /// <summary>Continuous rounded gold frame via 9-slice (no separate arc joins).</summary>
        static void DrawOrnateBorder(Rect r, float t, float s, float radius)
        {
            EnsureRoundStyles(radius);
            GUI.Box(r, GUIContent.none, _roundFrame);
        }

        static Texture2D MakeRoundedFrameSlice(int size, int radius, int stroke, int gap, int innerStroke, Color color)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
                name = "RoundCardFrame",
            };
            var pixels = new Color[size * size];
            var rad = (float)radius;
            var band0 = (float)stroke;
            var band1 = stroke + gap;
            var band2 = stroke + gap + innerStroke;

            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var py = size - 1 - y;
                var dist = RoundedRectSignedDist(x + 0.5f, py + 0.5f, size, size, rad);
                Color c = Color.clear;
                if (dist <= 0.75f)
                {
                    var depth = -dist;
                    var onOuter = depth <= band0;
                    var onInner = depth >= band1 && depth <= band2;
                    if (onOuter || onInner)
                    {
                        var a = 1f;
                        if (dist > -0.5f) a = Mathf.Clamp01(0.75f - dist);
                        if (onOuter && depth > band0 - 1.25f)
                            a = Mathf.Min(a, Mathf.Clamp01(band0 - depth + 1.25f));
                        if (onInner)
                        {
                            if (depth < band1 + 1.25f)
                                a = Mathf.Min(a, Mathf.Clamp01(depth - band1 + 1.25f));
                            if (depth > band2 - 1.25f)
                                a = Mathf.Min(a, Mathf.Clamp01(band2 - depth + 1.25f));
                        }
                        c = color;
                        c.a = Mathf.Clamp01(a);
                    }
                }
                pixels[y * size + x] = c;
            }
            t.SetPixels(pixels);
            t.Apply(false, true);
            return t;
        }

        static Texture2D MakeRoundedParchmentSlice(int size, int radius)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            var top = new Color(0.953f, 0.902f, 0.788f, 1f);
            var bot = new Color(0.910f, 0.843f, 0.690f, 1f);
            var pixels = new Color[size * size];
            var rad = (float)radius;
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var py = size - 1 - y;
                var fill = RoundedRectCoverage(x + 0.5f, py + 0.5f, size, size, rad);
                var c = Color.Lerp(bot, top, py / (float)(size - 1));
                c.a = fill;
                pixels[y * size + x] = c;
            }
            t.SetPixels(pixels);
            t.Apply(false, true);
            return t;
        }

        static float RoundedRectCoverage(float px, float py, int w, int h, float radius)
        {
            var dist = RoundedRectSignedDist(px, py, w, h, radius);
            return Mathf.Clamp01(0.75f - dist);
        }

        static float RoundedRectSignedDist(float px, float py, int w, int h, float radius)
        {
            var half = new Vector2(w * 0.5f, h * 0.5f);
            var p = new Vector2(px, py) - half;
            var b = half - new Vector2(radius, radius);
            var q = new Vector2(Mathf.Abs(p.x), Mathf.Abs(p.y)) - b;
            return Vector2.Max(q, Vector2.zero).magnitude + Mathf.Min(Mathf.Max(q.x, q.y), 0f) - radius;
        }

        static void DrawTiled(Rect rect, Texture2D tex, float tilePx, float alpha)
        {
            if (tilePx < 1f) tilePx = 1f;
            var prev = GUI.color;
            GUI.color = new Color(1f, 1f, 1f, alpha);
            var u = rect.width / tilePx;
            var v = rect.height / tilePx;
            GUI.DrawTextureWithTexCoords(rect, tex, new Rect(0f, 0f, u, v));
            GUI.color = prev;
        }

        static Rect Inset(Rect r, float pad) =>
            new(r.x + pad, r.y + pad, Mathf.Max(1f, r.width - pad * 2f), Mathf.Max(1f, r.height - pad * 2f));

        static string Stat(int v) => v <= 0 ? "—" : v.ToString();

        static void EnsureTextures()
        {
            if (_parchment != null)
            {
                if (_paperTexture == null && !_textureTried)
                    TryLoadPaperTexture();
                return;
            }
            _parchment = GradientParchment();
            _gold = Solid(new Color(0.776f, 0.655f, 0.369f));
            _artBg = Solid(new Color(0.165f, 0.192f, 0.259f));
            _bannerCommander = Solid(new Color(0.702f, 0.227f, 0.227f));
            _bannerOfficer = Solid(new Color(0.153f, 0.302f, 0.471f));
            _bannerUnit = Solid(new Color(0.973f, 0.953f, 0.91f));
            _statRow = Solid(new Color(0.973f, 0.945f, 0.89f));
            _statRowAlt = Solid(new Color(0.93f, 0.89f, 0.82f));
            _typeStrip = Solid(new Color(0.937f, 0.894f, 0.8f));
            _white = Solid(Color.white);
            _ruleDivider = Solid(new Color(0.16f, 0.14f, 0.12f, 0.18f));
            _iconPassive = MakeKindIcon(AbilityKind.Passive);
            _iconActive = MakeKindIcon(AbilityKind.Active);
            _iconUltimate = MakeKindIcon(AbilityKind.Ultimate);
            TryLoadPaperTexture();
        }

        static Texture2D GradientParchment()
        {
            const int h = 64;
            var t = new Texture2D(2, h, TextureFormat.RGBA32, false);
            var top = new Color(0.953f, 0.902f, 0.788f);
            var bot = new Color(0.910f, 0.843f, 0.690f);
            for (var y = 0; y < h; y++)
            {
                var c = Color.Lerp(bot, top, y / (float)(h - 1));
                t.SetPixel(0, y, c);
                t.SetPixel(1, y, c);
            }
            t.Apply();
            t.wrapMode = TextureWrapMode.Clamp;
            t.filterMode = FilterMode.Bilinear;
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }

        static Texture2D MakeKindIcon(AbilityKind kind)
        {
            const int n = 32;
            var t = new Texture2D(n, n, TextureFormat.RGBA32, false);
            var clear = new Color(0, 0, 0, 0);
            var pixels = new Color[n * n];
            for (var i = 0; i < pixels.Length; i++) pixels[i] = clear;

            var fill = kind switch
            {
                AbilityKind.Passive => new Color(0.216f, 0.412f, 0.608f),  // #37699b
                AbilityKind.Ultimate => new Color(0.588f, 0.216f, 0.216f), // #963737
                _ => new Color(0.373f, 0.275f, 0.510f),                   // #5f4682
            };
            var ink = new Color(0.973f, 0.945f, 0.89f);
            var edge = new Color(0.165f, 0.141f, 0.118f);
            var cx = (n - 1) * 0.5f;
            var cy = (n - 1) * 0.5f;

            void Set(int x, int y, Color c)
            {
                if (x < 0 || y < 0 || x >= n || y >= n) return;
                pixels[y * n + x] = c;
            }

            float Dist(float x, float y, float ox, float oy)
            {
                var dx = x - ox;
                var dy = y - oy;
                return Mathf.Sqrt(dx * dx + dy * dy);
            }

            for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                var inside = false;
                if (kind == AbilityKind.Passive)
                {
                    var d = Dist(x, y, cx, cy);
                    inside = d <= 14.5f;
                    if (inside) Set(x, y, d >= 13.5f ? edge : fill);
                }
                else if (kind == AbilityKind.Active)
                {
                    // Shield: wide top, point bottom.
                    var ny = (y - 2f) / 28f;
                    var half = Mathf.Lerp(12f, 1f, Mathf.Clamp01((ny - 0.45f) / 0.55f));
                    if (ny < 0.45f) half = 12f;
                    inside = Mathf.Abs(x - cx) <= half && y >= 3 && y <= 28;
                    if (inside) Set(x, y, fill);
                }
                else
                {
                    // 5-point star approx via diamond + cross.
                    var dx = Mathf.Abs(x - cx);
                    var dy = Mathf.Abs(y - cy);
                    inside = (dx + dy * 0.7f) < 12f || (dy + dx * 0.7f) < 12f;
                    if (inside) Set(x, y, fill);
                }
            }

            // Inner glyph
            for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                if (kind == AbilityKind.Passive)
                {
                    // Simple star
                    var dx = Mathf.Abs(x - cx);
                    var dy = Mathf.Abs(y - cy);
                    if (dx + dy < 5.5f || (dx < 1.2f && dy < 7f) || (dy < 1.2f && dx < 7f))
                        if (pixels[y * n + x].a > 0.5f) Set(x, y, ink);
                }
                else if (kind == AbilityKind.Active)
                {
                    var d = Dist(x, y, cx, cy - 1f);
                    if (d > 4.2f && d < 6.2f) Set(x, y, ink);
                    if (d < 1.8f) Set(x, y, ink);
                }
                else
                {
                    var dx = Mathf.Abs(x - cx);
                    var dy = Mathf.Abs(y - cy);
                    if (dx + dy < 5f) Set(x, y, ink);
                }
            }

            t.SetPixels(pixels);
            t.Apply();
            t.filterMode = FilterMode.Bilinear;
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }

        static void TryLoadPaperTexture()
        {
            if (_textureTried) return;
            _textureTried = true;
            var candidates = new[]
            {
                Path.Combine(Application.streamingAssetsPath, "card-texture.png"),
                Path.Combine(Application.dataPath, "StreamingAssets", "card-texture.png"),
            };
            foreach (var path in candidates)
            {
                if (!File.Exists(path)) continue;
                try
                {
                    var bytes = File.ReadAllBytes(path);
                    var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                    if (!tex.LoadImage(bytes))
                    {
                        UnityEngine.Object.Destroy(tex);
                        _textureFail = "LoadImage failed: " + path;
                        continue;
                    }
                    tex.wrapMode = TextureWrapMode.Repeat;
                    tex.filterMode = FilterMode.Bilinear;
                    tex.hideFlags = HideFlags.HideAndDontSave;
                    _paperTexture = tex;
                    _textureFail = null;
                    // Bake multiply grit into parchment so section fills show texture (not only overlay).
                    _parchment = BakeParchmentWithGrit(tex);
                    return;
                }
                catch (Exception e)
                {
                    _textureFail = e.Message;
                }
            }
            if (_paperTexture == null && string.IsNullOrEmpty(_textureFail))
                _textureFail = "card-texture.png not found under StreamingAssets";
            if (_paperTexture == null)
                Debug.LogWarning("[CardFace] Paper texture missing: " + _textureFail);
        }

        /// <summary>css mix-blend multiply @ ~25–45% into parchment gradient.</summary>
        static Texture2D BakeParchmentWithGrit(Texture2D grit)
        {
            const int size = 256;
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var top = new Color(0.953f, 0.902f, 0.788f);
            var bot = new Color(0.910f, 0.843f, 0.690f);
            // Sample grit across 200px tile scale relative to ref card width.
            var tile = 200f / RefW * size;
            for (var y = 0; y < size; y++)
            {
                var pBase = Color.Lerp(bot, top, y / (float)(size - 1));
                for (var x = 0; x < size; x++)
                {
                    var gu = (x / tile) % 1f;
                    var gv = (y / tile) % 1f;
                    if (gu < 0f) gu += 1f;
                    if (gv < 0f) gv += 1f;
                    var g = grit.GetPixelBilinear(gu, gv);
                    var mul = new Color(pBase.r * g.r, pBase.g * g.g, pBase.b * g.b, 1f);
                    t.SetPixel(x, y, Color.Lerp(pBase, mul, 0.42f));
                }
            }
            t.Apply();
            t.wrapMode = TextureWrapMode.Repeat;
            t.filterMode = FilterMode.Bilinear;
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }

        static Texture2D Solid(Color c)
        {
            var t = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            t.SetPixels(new[] { c, c, c, c });
            t.Apply();
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }

        enum AbilityKind { Passive, Active, Ultimate }

        struct AbilityRow
        {
            public string name;
            public string description;
            public string costLabel;
            public AbilityKind kind;
        }
    }
}
