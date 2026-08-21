using System.Collections.Generic;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>
    /// Runtime low-poly miniature figures (no animation). Same race shares a silhouette;
    /// cardId/keywords/range drive weapon, cloth, and accent variants.
    /// </summary>
    public static class MiniFigureBuilder
    {
        public enum WeaponStyle { Sword, Axe, Spear, Bow, Staff, Claw, Hammer }

        public struct FigureSpec
        {
            public UnitKind Kind;
            public string Race;
            public string CardId;
            public IReadOnlyList<string> Keywords;
            public int Range;
            public Color SeatColor;
        }

        public static Transform Build(Transform parent, in FigureSpec spec)
        {
            var root = new GameObject("MiniFigure").transform;
            root.SetParent(parent, false);

            var seed = StableHash(spec.CardId ?? spec.Race ?? "unit");
            var race = (spec.Race ?? "").Trim().ToLowerInvariant();
            if (race == "lizardman") race = "lizardmen";

            var body = RaceColors.ForRace(spec.Race);
            var cloth = Color.Lerp(body, spec.SeatColor, 0.35f);
            // Per-card hue nudge so identical-race units differ slightly.
            cloth = ShiftHue(cloth, ((seed % 24) - 12) * 0.012f);
            var accent = Color.Lerp(cloth, Color.white, 0.28f);
            var metal = Color.Lerp(new Color(0.72f, 0.72f, 0.78f), cloth, 0.2f);
            var dark = Color.Lerp(cloth, Color.black, 0.4f);
            var skin = SkinForRace(race, cloth);

            var scaleY = RaceScaleY(race, spec.Kind);
            var scaleXz = RaceScaleXz(race, spec.Kind);
            root.localScale = new Vector3(scaleXz, scaleY, scaleXz);

            // Legs
            Prim(PrimitiveType.Cylinder, "LegL", root,
                new Vector3(-0.09f, 0.22f, 0f), new Vector3(0.1f, 0.22f, 0.1f), dark);
            Prim(PrimitiveType.Cylinder, "LegR", root,
                new Vector3(0.09f, 0.22f, 0f), new Vector3(0.1f, 0.22f, 0.1f), dark);

            // Torso — race shape
            if (race is "construct")
            {
                Prim(PrimitiveType.Cube, "Torso", root,
                    new Vector3(0f, 0.62f, 0f), new Vector3(0.42f, 0.38f, 0.28f), metal);
            }
            else if (race is "dwarf")
            {
                Prim(PrimitiveType.Capsule, "Torso", root,
                    new Vector3(0f, 0.55f, 0f), new Vector3(0.38f, 0.28f, 0.32f), cloth);
            }
            else if (race is "dragon")
            {
                Prim(PrimitiveType.Capsule, "Torso", root,
                    new Vector3(0f, 0.62f, 0.05f), new Vector3(0.4f, 0.34f, 0.36f), cloth);
                Prim(PrimitiveType.Cube, "WingL", root,
                    new Vector3(-0.38f, 0.75f, -0.05f), new Vector3(0.35f, 0.08f, 0.22f), dark);
                Prim(PrimitiveType.Cube, "WingR", root,
                    new Vector3(0.38f, 0.75f, -0.05f), new Vector3(0.35f, 0.08f, 0.22f), dark);
            }
            else
            {
                Prim(PrimitiveType.Capsule, "Torso", root,
                    new Vector3(0f, 0.58f, 0f),
                    new Vector3(race is "elf" ? 0.28f : 0.34f, 0.32f, race is "elf" ? 0.24f : 0.28f),
                    cloth);
            }

            // Arms
            Prim(PrimitiveType.Capsule, "ArmL", root,
                new Vector3(-0.28f, 0.62f, 0f), new Vector3(0.1f, 0.22f, 0.1f), skin);
            Prim(PrimitiveType.Capsule, "ArmR", root,
                new Vector3(0.28f, 0.62f, 0f), new Vector3(0.1f, 0.22f, 0.1f), skin);

            // Head + race features
            BuildHead(root, race, skin, cloth, dark, accent, seed);

            // Clothing / armor layer (variant by seed)
            var armorStyle = seed % 3;
            if (spec.Kind == UnitKind.Commander || armorStyle == 1)
            {
                Prim(PrimitiveType.Cube, "ChestArmor", root,
                    new Vector3(0f, 0.62f, 0.12f), new Vector3(0.36f, 0.28f, 0.06f), metal);
            }
            if (spec.Kind == UnitKind.Officer || armorStyle == 2)
            {
                Prim(PrimitiveType.Cube, "PauldronL", root,
                    new Vector3(-0.3f, 0.78f, 0f), new Vector3(0.16f, 0.1f, 0.16f), metal);
                Prim(PrimitiveType.Cube, "PauldronR", root,
                    new Vector3(0.3f, 0.78f, 0f), new Vector3(0.16f, 0.1f, 0.16f), metal);
            }
            if (spec.Kind == UnitKind.Commander)
            {
                Prim(PrimitiveType.Cube, "Cape", root,
                    new Vector3(0f, 0.55f, -0.18f), new Vector3(0.4f, 0.55f, 0.05f),
                    Color.Lerp(spec.SeatColor, cloth, 0.3f));
                Prim(PrimitiveType.Cylinder, "Crown", root,
                    new Vector3(0f, 1.22f, 0f), new Vector3(0.22f, 0.05f, 0.22f),
                    new Color(0.92f, 0.78f, 0.28f));
            }

            // Cloth sash / tabard variant
            if ((seed / 3) % 2 == 0 && race is not "construct" and not "dragon")
            {
                Prim(PrimitiveType.Cube, "Sash", root,
                    new Vector3(0f, 0.48f, 0.14f), new Vector3(0.22f, 0.2f, 0.04f), accent);
            }

            var weapon = PickWeapon(spec, seed, race);
            AttachWeapon(root, weapon, metal, dark, wood: new Color(0.45f, 0.28f, 0.14f));

            return root;
        }

        static void BuildHead(
            Transform root, string race, Color skin, Color cloth, Color dark, Color accent, int seed)
        {
            var headY = race is "dwarf" ? 0.88f : 1.02f;
            var headScale = race switch
            {
                "dwarf" => 0.28f,
                "dragon" => 0.32f,
                "beastfolk" => 0.3f,
                "construct" => 0.26f,
                _ => 0.26f,
            };

            if (race is "construct")
            {
                Prim(PrimitiveType.Cube, "Head", root,
                    new Vector3(0f, headY, 0f), Vector3.one * headScale, Color.Lerp(skin, cloth, 0.4f));
                return;
            }

            Prim(PrimitiveType.Sphere, "Head", root,
                new Vector3(0f, headY, 0f), Vector3.one * headScale, skin);

            switch (race)
            {
                case "elf":
                    Prim(PrimitiveType.Cube, "EarL", root,
                        new Vector3(-0.16f, headY + 0.02f, 0f), new Vector3(0.04f, 0.12f, 0.04f), skin);
                    Prim(PrimitiveType.Cube, "EarR", root,
                        new Vector3(0.16f, headY + 0.02f, 0f), new Vector3(0.04f, 0.12f, 0.04f), skin);
                    break;
                case "dwarf":
                    Prim(PrimitiveType.Capsule, "Beard", root,
                        new Vector3(0f, headY - 0.12f, 0.06f), new Vector3(0.18f, 0.12f, 0.1f),
                        Color.Lerp(dark, new Color(0.4f, 0.25f, 0.12f), 0.5f));
                    break;
                case "undead":
                    Prim(PrimitiveType.Sphere, "SkullGlow", root,
                        new Vector3(0f, headY, 0.1f), Vector3.one * 0.12f,
                        new Color(0.7f, 0.95f, 0.7f));
                    break;
                case "demon":
                    Prim(PrimitiveType.Cube, "HornL", root,
                        new Vector3(-0.1f, headY + 0.16f, -0.02f), new Vector3(0.05f, 0.16f, 0.05f), dark);
                    Prim(PrimitiveType.Cube, "HornR", root,
                        new Vector3(0.1f, headY + 0.16f, -0.02f), new Vector3(0.05f, 0.16f, 0.05f), dark);
                    break;
                case "beastfolk":
                    Prim(PrimitiveType.Sphere, "Snout", root,
                        new Vector3(0f, headY - 0.02f, 0.14f), Vector3.one * 0.14f, Color.Lerp(skin, dark, 0.2f));
                    Prim(PrimitiveType.Cube, "EarL", root,
                        new Vector3(-0.12f, headY + 0.12f, -0.02f), new Vector3(0.06f, 0.12f, 0.04f), skin);
                    Prim(PrimitiveType.Cube, "EarR", root,
                        new Vector3(0.12f, headY + 0.12f, -0.02f), new Vector3(0.06f, 0.12f, 0.04f), skin);
                    break;
                case "lizardmen":
                    Prim(PrimitiveType.Capsule, "Snout", root,
                        new Vector3(0f, headY - 0.02f, 0.14f), new Vector3(0.12f, 0.1f, 0.18f), skin);
                    Prim(PrimitiveType.Cube, "Crest", root,
                        new Vector3(0f, headY + 0.14f, -0.02f), new Vector3(0.06f, 0.14f, 0.16f), accent);
                    break;
                case "dragon":
                    Prim(PrimitiveType.Capsule, "Muzzle", root,
                        new Vector3(0f, headY - 0.04f, 0.16f), new Vector3(0.16f, 0.12f, 0.22f), skin);
                    Prim(PrimitiveType.Cube, "HornL", root,
                        new Vector3(-0.12f, headY + 0.18f, -0.04f), new Vector3(0.05f, 0.18f, 0.05f), dark);
                    Prim(PrimitiveType.Cube, "HornR", root,
                        new Vector3(0.12f, headY + 0.18f, -0.04f), new Vector3(0.05f, 0.18f, 0.05f), dark);
                    break;
            }

            // Helmet variant for armored rolls
            if (seed % 5 == 0 && race is not "dragon" and not "beastfolk")
            {
                Prim(PrimitiveType.Sphere, "Helm", root,
                    new Vector3(0f, headY + 0.04f, 0f), Vector3.one * (headScale * 1.05f),
                    Color.Lerp(cloth, metalish(cloth), 0.55f));
            }
        }

        static Color metalish(Color c) => Color.Lerp(c, new Color(0.7f, 0.7f, 0.75f), 0.6f);

        static WeaponStyle PickWeapon(in FigureSpec spec, int seed, string race)
        {
            if (HasKeyword(spec.Keywords, "Siege") || HasKeyword(spec.Keywords, "Artillery"))
                return WeaponStyle.Hammer;
            if ((race is "beastfolk" or "dragon") && seed % 3 == 0)
                return WeaponStyle.Claw;
            if (spec.Range > 2)
                return seed % 2 == 0 ? WeaponStyle.Bow : WeaponStyle.Staff;
            if (spec.Range > 1)
                return seed % 2 == 0 ? WeaponStyle.Spear : WeaponStyle.Bow;

            return (seed % 4) switch
            {
                0 => WeaponStyle.Sword,
                1 => WeaponStyle.Axe,
                2 => WeaponStyle.Spear,
                _ => WeaponStyle.Hammer,
            };
        }

        static void AttachWeapon(Transform root, WeaponStyle style, Color metal, Color dark, Color wood)
        {
            var hand = new GameObject("Weapon").transform;
            hand.SetParent(root, false);
            hand.localPosition = new Vector3(0.38f, 0.55f, 0.08f);

            switch (style)
            {
                case WeaponStyle.Sword:
                    Prim(PrimitiveType.Cylinder, "Hilt", hand,
                        new Vector3(0f, 0.05f, 0f), new Vector3(0.04f, 0.08f, 0.04f), wood);
                    Prim(PrimitiveType.Cube, "Blade", hand,
                        new Vector3(0f, 0.28f, 0f), new Vector3(0.05f, 0.4f, 0.02f), metal);
                    break;
                case WeaponStyle.Axe:
                    Prim(PrimitiveType.Cylinder, "Haft", hand,
                        new Vector3(0f, 0.2f, 0f), new Vector3(0.04f, 0.28f, 0.04f), wood);
                    Prim(PrimitiveType.Cube, "Head", hand,
                        new Vector3(0.08f, 0.4f, 0f), new Vector3(0.18f, 0.12f, 0.04f), metal);
                    break;
                case WeaponStyle.Spear:
                    Prim(PrimitiveType.Cylinder, "Shaft", hand,
                        new Vector3(0f, 0.35f, 0f), new Vector3(0.035f, 0.45f, 0.035f), wood);
                    Prim(PrimitiveType.Cube, "Tip", hand,
                        new Vector3(0f, 0.78f, 0f), new Vector3(0.05f, 0.1f, 0.05f), metal);
                    break;
                case WeaponStyle.Bow:
                    Prim(PrimitiveType.Cylinder, "Bow", hand,
                        new Vector3(0f, 0.25f, 0f), new Vector3(0.03f, 0.35f, 0.03f), wood);
                    Prim(PrimitiveType.Cube, "Limb", hand,
                        new Vector3(0f, 0.25f, 0f), new Vector3(0.28f, 0.04f, 0.03f), wood);
                    break;
                case WeaponStyle.Staff:
                    Prim(PrimitiveType.Cylinder, "Staff", hand,
                        new Vector3(0f, 0.4f, 0f), new Vector3(0.04f, 0.5f, 0.04f), wood);
                    Prim(PrimitiveType.Sphere, "Orb", hand,
                        new Vector3(0f, 0.9f, 0f), Vector3.one * 0.12f,
                        new Color(0.55f, 0.75f, 1f));
                    break;
                case WeaponStyle.Claw:
                    Prim(PrimitiveType.Cube, "Claw1", hand,
                        new Vector3(0.02f, 0.12f, 0.06f), new Vector3(0.04f, 0.18f, 0.04f), dark);
                    Prim(PrimitiveType.Cube, "Claw2", hand,
                        new Vector3(0.08f, 0.1f, 0.02f), new Vector3(0.04f, 0.16f, 0.04f), dark);
                    break;
                case WeaponStyle.Hammer:
                    Prim(PrimitiveType.Cylinder, "Haft", hand,
                        new Vector3(0f, 0.18f, 0f), new Vector3(0.04f, 0.22f, 0.04f), wood);
                    Prim(PrimitiveType.Cube, "Head", hand,
                        new Vector3(0f, 0.4f, 0f), new Vector3(0.2f, 0.14f, 0.14f), metal);
                    break;
            }
        }

        static float RaceScaleY(string race, UnitKind kind)
        {
            var baseY = race switch
            {
                "dwarf" => 0.78f,
                "elf" => 1.12f,
                "dragon" => 1.18f,
                "construct" => 1.05f,
                "beastfolk" => 0.95f,
                _ => 1f,
            };
            if (kind == UnitKind.Commander) baseY *= 1.12f;
            else if (kind == UnitKind.Officer) baseY *= 1.05f;
            return baseY;
        }

        static float RaceScaleXz(string race, UnitKind kind)
        {
            var xz = race switch
            {
                "dwarf" => 1.15f,
                "elf" => 0.88f,
                "dragon" => 1.2f,
                "construct" => 1.1f,
                _ => 1f,
            };
            if (kind == UnitKind.Commander) xz *= 1.08f;
            return xz;
        }

        static Color SkinForRace(string race, Color cloth) => race switch
        {
            "human" => new Color(0.86f, 0.7f, 0.58f),
            "elf" => new Color(0.9f, 0.82f, 0.7f),
            "dwarf" => new Color(0.78f, 0.58f, 0.45f),
            "undead" => new Color(0.7f, 0.78f, 0.7f),
            "demon" => new Color(0.55f, 0.18f, 0.2f),
            "dragon" => Color.Lerp(cloth, new Color(0.9f, 0.45f, 0.2f), 0.4f),
            "beastfolk" => new Color(0.7f, 0.55f, 0.35f),
            "lizardmen" => new Color(0.35f, 0.7f, 0.45f),
            "construct" => new Color(0.65f, 0.65f, 0.7f),
            _ => Color.Lerp(cloth, Color.white, 0.35f),
        };

        static bool HasKeyword(IReadOnlyList<string> keywords, string name)
        {
            if (keywords == null) return false;
            for (var i = 0; i < keywords.Count; i++)
            {
                if (string.Equals(keywords[i], name, System.StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        static int StableHash(string s)
        {
            unchecked
            {
                var h = 23;
                if (string.IsNullOrEmpty(s)) return h;
                for (var i = 0; i < s.Length; i++)
                    h = h * 31 + s[i];
                return h & 0x7fffffff;
            }
        }

        static Color ShiftHue(Color c, float amount)
        {
            Color.RGBToHSV(c, out var h, out var s, out var v);
            h = (h + amount + 1f) % 1f;
            return Color.HSVToRGB(h, s, v);
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
                    color, null, 1f, 0.4f, 0.08f, color * 0.15f);
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                r.receiveShadows = true;
            }
            return go;
        }
    }
}
