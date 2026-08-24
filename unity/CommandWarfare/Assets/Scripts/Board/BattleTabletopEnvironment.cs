using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;
using UnityEngine.Rendering;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Spacious medieval game hall around a proportionally-scaled hex table.
    /// Hex size ~1.0 keeps the board on a large table while Poly Haven furniture
    /// reads at near-real scale with real walk space between table and walls.
    /// </summary>
    public static class BattleTabletopEnvironment
    {
        public const string RootName = "BattleTabletopRoom";

        public static void Ensure(float boardSize, float hexSize)
        {
            DestroyExisting();

            var size = Mathf.Max(3, Mathf.RoundToInt(boardSize));
            var mid = GameConstants.BoardMid(size);
            var center = HexMath.OddRToWorld(mid, mid, hexSize);
            var corner = HexMath.OddRToWorld(0, 0, hexSize) - center;
            var mapHalf = Mathf.Max(
                Mathf.Abs(corner.x) + hexSize,
                Mathf.Abs(corner.z) + hexSize);

            // Generous apron + wide floor so the hall is not glued to the table.
            var tableHalf = mapHalf + 1.6f;
            var roomHalf = tableHalf + 16f;

            // Human-ish vertical scale (furniture ~1–1.3m tall).
            const float tableTopY = -0.04f;
            const float tableThick = 0.55f;
            var tableCenterY = tableTopY - tableThick * 0.5f;
            const float floorY = -0.95f;
            const float wallH = 5.6f;
            const float wallT = 0.55f;

            var root = new GameObject(RootName).transform;
            root.gameObject.hideFlags = HideFlags.DontSave;
            var decor = LoadCatalog();

            var woodFloor = TexMat("dark_wooden_planks", new Color(0.32f, 0.2f, 0.12f), 3.2f);
            var plaster = TexMat("plastered_wall", new Color(0.55f, 0.48f, 0.4f), 1.8f);
            var brick = TexMat("red_brick_03", new Color(0.55f, 0.28f, 0.2f), 1.6f);
            var beige = TexMat("beige_wall_001", new Color(0.62f, 0.55f, 0.45f), 1.8f);
            var stone = TexMat("concrete_wall_003", new Color(0.45f, 0.43f, 0.4f), 1.6f);

            var wood = Mat(new Color(0.58f, 0.4f, 0.24f), 0.28f, 0.04f);
            var woodDark = Mat(new Color(0.28f, 0.17f, 0.1f), 0.2f, 0.03f);
            var stoneDark = Mat(new Color(0.28f, 0.26f, 0.24f), 0.1f, 0.06f);
            var leather = Mat(new Color(0.32f, 0.2f, 0.12f), 0.3f, 0f);
            var metal = Mat(new Color(0.55f, 0.48f, 0.32f), 0.45f, 0.55f);
            var metalDark = Mat(new Color(0.25f, 0.22f, 0.18f), 0.35f, 0.6f);
            var parchment = Mat(new Color(0.78f, 0.7f, 0.5f), 0.15f, 0f);
            var clothRed = Mat(new Color(0.5f, 0.12f, 0.1f), 0.35f, 0f);
            var candle = Mat(new Color(1f, 0.88f, 0.55f), 0.4f, 0f, new Color(2.4f, 1.2f, 0.35f));
            var flame = Mat(new Color(1f, 0.55f, 0.15f), 0.2f, 0f, new Color(3f, 1.2f, 0.2f));

            Box(root, "RoomFloor", new Vector3(0f, floorY, 0f),
                new Vector3(roomHalf * 2.15f, 0.2f, roomHalf * 2.15f), woodFloor);

            // Large area rug under the whole play table + approach
            Box(root, "MainRug", new Vector3(0f, floorY + 0.12f, -1.5f),
                new Vector3(tableHalf * 2.5f, 0.05f, tableHalf * 2.5f + 4f), leather);

            Box(root, "TableTop", new Vector3(0f, tableCenterY, 0f),
                new Vector3(tableHalf * 2f, tableThick, tableHalf * 2f), wood);
            Box(root, "TableApron", new Vector3(0f, tableCenterY - 0.14f, 0f),
                new Vector3(tableHalf * 2.06f, 0.28f, tableHalf * 2.06f), woodDark);
            BuildTrayLip(root, mapHalf, tableHalf, tableTopY + 0.05f, woodDark);
            BuildTableLegs(root, tableHalf, tableCenterY, tableThick, floorY, woodDark);

            // Four distinct walls
            BuildSolidWall(root, "WallN", AlongZ(roomHalf), roomHalf, wallH, floorY, wallT, brick);
            BuildCrestWall(root, new Vector3(0f, floorY + wallH * 0.58f, roomHalf - wallT * 0.55f),
                Mathf.Min(4.5f, tableHalf * 0.35f), metal, metalDark, clothRed, parchment);

            BuildSolidWall(root, "WallS", AlongZ(-roomHalf), roomHalf, wallH, floorY, wallT, beige);
            BuildParchmentCluster(root, new Vector3(-3.2f, floorY + wallH * 0.55f, -roomHalf + wallT * 0.55f),
                parchment, woodDark);
            BuildParchmentCluster(root, new Vector3(4.0f, floorY + wallH * 0.48f, -roomHalf + wallT * 0.55f),
                parchment, woodDark);

            BuildSolidWall(root, "WallE", AlongX(roomHalf), roomHalf, wallH, floorY, wallT, plaster);
            BuildSolidWall(root, "WallW", AlongX(-roomHalf), roomHalf, wallH, floorY, wallT, plaster);
            BuildStoneArchAlcove(root, new Vector3(roomHalf - 1.8f, floorY, 3.5f), 1f, wallH, stone, stoneDark);
            BuildStoneArchAlcove(root, new Vector3(-roomHalf + 1.8f, floorY, -2.5f), -1f, wallH, stone, stoneDark);

            var postH = wallH * 0.95f;
            var postY = floorY + postH * 0.5f;
            var p = roomHalf - 0.55f;
            foreach (var xz in new[] { new Vector2(-p, -p), new Vector2(p, -p), new Vector2(-p, p), new Vector2(p, p) })
                Box(root, "CornerStone", new Vector3(xz.x, postY, xz.y), new Vector3(0.7f, postH, 0.7f), stoneDark);

            PlaceSconce(root, new Vector3(-3.5f, floorY + wallH * 0.62f, roomHalf - 0.45f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(3.5f, floorY + wallH * 0.62f, roomHalf - 0.45f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(-roomHalf + 0.45f, floorY + wallH * 0.58f, 4.5f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(roomHalf - 0.45f, floorY + wallH * 0.58f, -3.5f), candle, flame, metalDark);

            PlaceGameRoomProps(root, decor, roomHalf, tableHalf, floorY, tableTopY, candle, woodDark, wood);

            // Soft fill only — no point lights over the board (their editor icons
            // show as a lightbulb / sun in the middle of the map).
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.42f, 0.36f, 0.3f);
            RenderSettings.ambientIntensity = 1.15f;

            // Park the scene sun well off the board in XZ. Position (0,80,0) still
            // draws the Scene View sun gizmo on top of the hexes when looking down.
            foreach (var light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light == null || light.type != LightType.Directional) continue;
                var t = light.transform;
                t.position = new Vector3(-40f, 60f, -40f);
                t.rotation = Quaternion.Euler(50f, -30f, 0f);
                if (light.intensity > 1.25f)
                    light.intensity = 1.15f;
            }

            var cam = Camera.main;
            if (cam != null)
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.1f, 0.09f, 0.08f);
            }
        }

        public static void DestroyExisting()
        {
            var existing = GameObject.Find(RootName);
            if (existing != null)
                Object.DestroyImmediate(existing);
        }

        static Vector3 AlongZ(float z) => new Vector3(0f, 0f, z);
        static Vector3 AlongX(float x) => new Vector3(x, 0f, 0f);

        static RoomDecorCatalog LoadCatalog()
        {
            var fromResources = Resources.Load<RoomDecorCatalog>("RoomDecorCatalog");
            if (fromResources != null) return fromResources;
#if UNITY_EDITOR
            return UnityEditor.AssetDatabase.LoadAssetAtPath<RoomDecorCatalog>(
                "Assets/Data/RoomDecorCatalog.asset");
#else
            return null;
#endif
        }

        static void BuildSolidWall(
            Transform root, string name, Vector3 wallCenter, float roomHalf,
            float wallH, float floorY, float wallT, Material mat)
        {
            var alongX = Mathf.Abs(wallCenter.z) > 0.01f;
            Vector3 pos;
            Vector3 scale;
            if (alongX)
            {
                pos = new Vector3(0f, floorY + wallH * 0.5f, wallCenter.z);
                scale = new Vector3(roomHalf * 2.15f, wallH, wallT);
            }
            else
            {
                pos = new Vector3(wallCenter.x, floorY + wallH * 0.5f, 0f);
                scale = new Vector3(wallT, wallH, roomHalf * 2.15f);
            }
            Box(root, name, pos, scale, mat);
        }

        static void BuildCrestWall(
            Transform root, Vector3 center, float span,
            Material metal, Material metalDark, Material cloth, Material parchment)
        {
            var bladeL = Box(root, "BladeL", center + new Vector3(-0.35f, 0.45f, 0f),
                new Vector3(0.08f, 1.9f, 0.08f), metal);
            bladeL.localRotation = Quaternion.Euler(0f, 0f, 28f);
            var bladeR = Box(root, "BladeR", center + new Vector3(0.35f, 0.45f, 0f),
                new Vector3(0.08f, 1.9f, 0.08f), metal);
            bladeR.localRotation = Quaternion.Euler(0f, 0f, -28f);

            Box(root, "CrestShield", center + new Vector3(0f, -0.35f, 0.06f),
                new Vector3(0.85f, 1.0f, 0.12f), cloth);
            Box(root, "CrestBoss", center + new Vector3(0f, -0.35f, 0.14f),
                new Vector3(0.25f, 0.25f, 0.1f), metal);
            Box(root, "RoundShieldL", center + new Vector3(-span * 0.7f, -0.05f, 0.05f),
                new Vector3(0.75f, 0.75f, 0.1f), metalDark);
            Box(root, "RoundShieldR", center + new Vector3(span * 0.7f, -0.05f, 0.05f),
                new Vector3(0.75f, 0.75f, 0.1f), metalDark);
            Box(root, "CrestMap", center + new Vector3(0f, -1.15f, 0.05f),
                new Vector3(1.4f, 0.7f, 0.05f), parchment);
        }

        static void BuildParchmentCluster(Transform root, Vector3 center, Material paper, Material frame)
        {
            Box(root, "FrameA", center, new Vector3(1.35f, 1.0f, 0.08f), frame);
            Box(root, "PaperA", center + new Vector3(0f, 0f, 0.05f), new Vector3(1.15f, 0.85f, 0.04f), paper);
            Box(root, "FrameB", center + new Vector3(1.05f, -0.7f, 0f), new Vector3(0.9f, 0.7f, 0.07f), frame);
            Box(root, "PaperB", center + new Vector3(1.05f, -0.7f, 0.05f), new Vector3(0.75f, 0.55f, 0.04f),
                Mat(new Color(0.7f, 0.62f, 0.42f), 0.15f, 0f));
        }

        static void BuildStoneArchAlcove(
            Transform root, Vector3 basePos, float faceSign, float wallH,
            Material stone, Material stoneDark)
        {
            var alcove = new GameObject("StoneArch").transform;
            alcove.SetParent(root, false);
            alcove.position = basePos;

            Box(alcove, "PillarL", new Vector3(faceSign * 0.1f, wallH * 0.38f, -1.35f),
                new Vector3(0.45f, wallH * 0.76f, 0.45f), stone);
            Box(alcove, "PillarR", new Vector3(faceSign * 0.1f, wallH * 0.38f, 1.35f),
                new Vector3(0.45f, wallH * 0.76f, 0.45f), stone);
            Box(alcove, "Lintel", new Vector3(faceSign * 0.1f, wallH * 0.78f, 0f),
                new Vector3(0.5f, 0.4f, 3.0f), stoneDark);
            Box(alcove, "AlcoveBack", new Vector3(faceSign * 0.55f, wallH * 0.38f, 0f),
                new Vector3(0.2f, wallH * 0.7f, 2.4f), stoneDark);
        }

        static void PlaceSconce(
            Transform root, Vector3 pos, Material candleMat, Material flameMat, Material bracketMat)
        {
            var s = new GameObject("Sconce").transform;
            s.SetParent(root, false);
            s.position = pos;
            Box(s, "Bracket", Vector3.zero, new Vector3(0.12f, 0.12f, 0.28f), bracketMat);
            Box(s, "Candle", new Vector3(0f, 0.2f, 0.05f), new Vector3(0.1f, 0.32f, 0.1f), candleMat);
            var flame = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            flame.name = "Flame";
            flame.transform.SetParent(s, false);
            flame.transform.localPosition = new Vector3(0f, 0.42f, 0.05f);
            flame.transform.localScale = Vector3.one * 0.14f;
            Object.DestroyImmediate(flame.GetComponent<Collider>());
            flame.GetComponent<Renderer>().sharedMaterial = flameMat;
        }

        /// <summary>
        /// Four zones of a real game room: play table seats, token side-table,
        /// library wall, and study desk under the crest — no random doors.
        /// </summary>
        static void PlaceGameRoomProps(
            Transform root,
            RoomDecorCatalog catalog,
            float roomHalf,
            float tableHalf,
            float floorY,
            float tableTopY,
            Material candle,
            Material woodDark,
            Material wood)
        {
            var floor = floorY + 0.02f;
            var seatR = tableHalf + 1.35f;
            const float s = 1.15f; // near real-world meter scale

            // --- Seats around the game table ---
            Spawn(root, Pick(catalog?.Chairs, "WoodenChair_01", "GreenChair_01"),
                new Vector3(0f, floor, -seatR), Quaternion.identity, s);
            Spawn(root, Pick(catalog?.Chairs, "GreenChair_01", "WoodenChair_01"),
                new Vector3(1.1f, floor, seatR), Quaternion.Euler(0f, 175f, 0f), s);
            Spawn(root, Pick(catalog?.Chairs, "WoodenChair_01"),
                new Vector3(-seatR, floor, 0.6f), Quaternion.Euler(0f, 90f, 0f), s);
            Spawn(root, Pick(catalog?.Chairs, "GreenChair_01", "WoodenChair_01"),
                new Vector3(seatR, floor, -0.8f), Quaternion.Euler(0f, -85f, 0f), s);

            // --- Token / dice table in the south open floor (not jammed to the wall) ---
            var tokenZ = -tableHalf - 5.5f;
            Spawn(root, Pick(catalog?.Desks, "gothic_coffee_table", "WoodenTable_02"),
                new Vector3(0f, floor, tokenZ), Quaternion.identity, s);
            BuildTokenTray(root, new Vector3(0.35f, floor + 0.62f, tokenZ), wood, woodDark);
            Spawn(root, Pick(catalog?.Chairs, "WoodenChair_01"),
                new Vector3(-1.2f, floor, tokenZ - 1.1f), Quaternion.Euler(0f, 20f, 0f), s);

            // --- West library wall: cabinet + shelf + reading chair (fills the alcove span) ---
            Spawn(root, Pick(catalog?.Bookcases, "GothicCabinet_01", "Shelf_01"),
                new Vector3(-roomHalf + 1.55f, floor, -1.2f),
                Quaternion.Euler(0f, 90f, 0f), s);
            Spawn(root, Pick(catalog?.Bookcases, "Shelf_01", "painted_wooden_cabinet_02"),
                new Vector3(-roomHalf + 1.55f, floor, 2.4f),
                Quaternion.Euler(0f, 90f, 0f), s);
            Spawn(root, Pick(catalog?.SoftSeating, "ArmChair_01"),
                new Vector3(-roomHalf + 3.6f, floor, 0.6f),
                Quaternion.Euler(0f, 105f, 0f), s);
            Spawn(root, Pick(catalog?.Desks, "side_table_tall_01", "WoodenTable_02"),
                new Vector3(-roomHalf + 3.2f, floor, 2.0f),
                Quaternion.Euler(0f, 15f, 0f), 0.95f);

            // --- East sideboard wall ---
            Spawn(root, Pick(catalog?.Accents, "GothicCommode_01", "ClassicConsole_01"),
                new Vector3(roomHalf - 1.55f, floor, 1.5f),
                Quaternion.Euler(0f, -90f, 0f), s);
            Spawn(root, Pick(catalog?.Accents, "ornate_mirror_01"),
                new Vector3(roomHalf - 0.55f, floorY + 2.35f, 1.5f),
                Quaternion.Euler(0f, -90f, 0f), 1.05f);
            Spawn(root, Pick(catalog?.Desks, "ClassicConsole_01", "side_table_tall_01"),
                new Vector3(roomHalf - 1.7f, floor, -3.2f),
                Quaternion.Euler(0f, -90f, 0f), s);

            // --- North study desk under the crest (reference "battle station" wall) ---
            Spawn(root, Pick(catalog?.Desks, "WoodenTable_01", "ClassicConsole_01"),
                new Vector3(0f, floor, roomHalf - 3.4f),
                Quaternion.identity, 1.05f);
            Spawn(root, Pick(catalog?.Chairs, "ArmChair_01", "WoodenChair_01"),
                new Vector3(0f, floor, roomHalf - 4.5f),
                Quaternion.Euler(0f, 180f, 0f), s);

            PlaceCandle(root, new Vector3(-tableHalf + 0.7f, tableTopY + 0.04f, tableHalf - 0.7f), candle, woodDark);
            PlaceCandle(root, new Vector3(tableHalf - 0.7f, tableTopY + 0.04f, -tableHalf + 0.7f), candle, woodDark);
        }

        static void BuildTokenTray(Transform root, Vector3 pos, Material wood, Material woodDark)
        {
            Box(root, "TokenTray", pos, new Vector3(1.1f, 0.1f, 0.7f), woodDark);
            var colors = new[]
            {
                new Color(0.75f, 0.2f, 0.15f), new Color(0.2f, 0.45f, 0.75f),
                new Color(0.85f, 0.75f, 0.2f), new Color(0.25f, 0.6f, 0.3f),
                new Color(0.7f, 0.7f, 0.75f),
            };
            for (var i = 0; i < 12; i++)
            {
                var ox = ((i % 4) - 1.5f) * 0.2f;
                var oz = ((i / 4) - 1f) * 0.18f;
                Box(root, "TokenPip", pos + new Vector3(ox, 0.1f, oz),
                    new Vector3(0.12f, 0.08f, 0.12f), Mat(colors[i % colors.Length], 0.35f, 0.05f));
            }
        }

        static void BuildTableLegs(
            Transform root, float tableHalf, float tableCenterY, float tableThick, float floorY, Material mat)
        {
            var legInset = tableHalf * 0.82f;
            var legTop = tableCenterY - tableThick * 0.5f;
            var legH = Mathf.Max(0.55f, legTop - floorY - 0.08f);
            var legY = floorY + legH * 0.5f + 0.05f;
            foreach (var xz in new[]
                     {
                         new Vector2(-legInset, -legInset), new Vector2(legInset, -legInset),
                         new Vector2(-legInset, legInset), new Vector2(legInset, legInset),
                     })
            {
                Box(root, "TableLeg", new Vector3(xz.x, legY, xz.y), new Vector3(0.35f, legH, 0.35f), mat);
            }
        }

        static void BuildTrayLip(Transform root, float mapHalf, float tableHalf, float y, Material mat)
        {
            var outer = tableHalf - 0.08f;
            var inner = mapHalf + 0.08f;
            if (outer <= inner + 0.2f) return;
            var mid = (outer + inner) * 0.5f;
            var width = outer - inner;
            const float h = 0.1f;
            Box(root, "TrayN", new Vector3(0f, y, mid), new Vector3(outer * 2f, h, width), mat);
            Box(root, "TrayS", new Vector3(0f, y, -mid), new Vector3(outer * 2f, h, width), mat);
            Box(root, "TrayE", new Vector3(mid, y, 0f), new Vector3(width, h, inner * 2f), mat);
            Box(root, "TrayW", new Vector3(-mid, y, 0f), new Vector3(width, h, inner * 2f), mat);
        }

        static void PlaceCandle(Transform root, Vector3 pos, Material flameMat, Material wood)
        {
            var c = new GameObject("TableCandle").transform;
            c.SetParent(root, false);
            c.position = pos;
            Box(c, "Stick", new Vector3(0f, 0.14f, 0f), new Vector3(0.08f, 0.28f, 0.08f), wood);
            var flame = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            flame.name = "Flame";
            flame.transform.SetParent(c, false);
            flame.transform.localPosition = new Vector3(0f, 0.34f, 0f);
            flame.transform.localScale = Vector3.one * 0.12f;
            Object.DestroyImmediate(flame.GetComponent<Collider>());
            flame.GetComponent<Renderer>().sharedMaterial = flameMat;
        }

        static GameObject Pick(GameObject[] prefabs, params string[] preferNames)
        {
            if (prefabs == null || prefabs.Length == 0) return null;
            foreach (var want in preferNames)
            {
                foreach (var p in prefabs)
                    if (p != null && p.name == want) return p;
            }
            foreach (var p in prefabs)
                if (p != null) return p;
            return null;
        }

        static void Spawn(Transform root, GameObject prefab, Vector3 pos, Quaternion rot, float scale)
        {
            if (prefab == null) return;
            // Never spawn leftover Kenney door / pillar accents.
            if (prefab.name is "door" or "wall-pillar") return;
            var go = Object.Instantiate(prefab, root);
            go.name = prefab.name;
            go.transform.localPosition = pos;
            go.transform.localRotation = rot;
            go.transform.localScale = Vector3.one * scale;
        }

        static Transform Box(Transform parent, string name, Vector3 localPos, Vector3 scale, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = scale;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            var r = go.GetComponent<Renderer>();
            if (r != null)
            {
                r.sharedMaterial = mat;
                r.shadowCastingMode = ShadowCastingMode.On;
                r.receiveShadows = true;
            }
            return go.transform;
        }

        static Material Mat(Color color, float smoothness, float metallic, Color? emission = null) =>
            TerrainMaterialFactory.CreateTileInstance(
                color, null, 1f, smoothness, metallic, emission ?? Color.black);

        static Material TexMat(string textureId, Color fallback, float tiling)
        {
            Texture2D diff = null;
            Texture2D nor = null;
#if UNITY_EDITOR
            diff = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(
                $"Assets/Art/Environment/PolyHavenInterior/_Textures/{textureId}_diff.jpg");
            nor = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(
                $"Assets/Art/Environment/PolyHavenInterior/_Textures/{textureId}_nor.jpg");
            if (diff == null)
            {
                diff = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(
                    $"Assets/Art/Environment/PolyHavenInterior/_Textures/{textureId}.jpg");
            }
#endif
            if (diff == null)
                return Mat(fallback, 0.2f, 0f);

            var mat = TerrainMaterialFactory.CreateTileInstance(Color.white, diff, tiling, 0.28f, 0.02f, Color.black);
            if (nor != null && mat.HasProperty("_BumpMap"))
            {
                mat.SetTexture("_BumpMap", nor);
                mat.EnableKeyword("_NORMALMAP");
            }
            return mat;
        }
    }
}
