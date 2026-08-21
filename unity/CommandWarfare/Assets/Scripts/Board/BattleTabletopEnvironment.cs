using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;
using UnityEngine.Rendering;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Game-hall stage inspired by a medieval scholar / captain's quarters battle-station:
    /// stone arches, warm sconces, crest wall, one bookshelf alcove, seats at the table.
    /// Open top so the orbit camera never hits a ceiling.
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

            var tableHalf = mapHalf + 3.5f;
            var roomHalf = tableHalf + 10f;

            const float tableTopY = -0.15f;
            const float tableThick = 0.85f;
            var tableCenterY = tableTopY - tableThick * 0.5f;
            var floorY = -4.8f;
            var wallH = 26f;
            var wallT = 1.4f;

            var root = new GameObject(RootName).transform;
            var decor = LoadCatalog();

            // Palette from the reference: terracotta, forest green, warm wood, grey stone, amber light
            var wood = Mat(new Color(0.58f, 0.4f, 0.24f), 0.28f, 0.04f);
            var woodDark = Mat(new Color(0.28f, 0.17f, 0.1f), 0.2f, 0.03f);
            var woodFloor = Mat(new Color(0.32f, 0.2f, 0.12f), 0.25f, 0.02f);
            var stone = Mat(new Color(0.45f, 0.43f, 0.4f), 0.12f, 0.05f);
            var stoneDark = Mat(new Color(0.3f, 0.28f, 0.26f), 0.1f, 0.06f);
            var terracotta = Mat(new Color(0.55f, 0.28f, 0.2f), 0.08f, 0f);
            var forest = Mat(new Color(0.22f, 0.32f, 0.24f), 0.08f, 0f);
            var plaster = Mat(new Color(0.55f, 0.48f, 0.4f), 0.08f, 0f);
            var leather = Mat(new Color(0.35f, 0.22f, 0.12f), 0.3f, 0f);
            var metal = Mat(new Color(0.55f, 0.48f, 0.32f), 0.45f, 0.55f);
            var metalDark = Mat(new Color(0.25f, 0.22f, 0.18f), 0.35f, 0.6f);
            var parchment = Mat(new Color(0.78f, 0.7f, 0.5f), 0.15f, 0f);
            var clothRed = Mat(new Color(0.5f, 0.12f, 0.1f), 0.35f, 0f);
            var candle = Mat(new Color(1f, 0.88f, 0.55f), 0.4f, 0f, new Color(2.4f, 1.2f, 0.35f));
            var flame = Mat(new Color(1f, 0.55f, 0.15f), 0.2f, 0f, new Color(3f, 1.2f, 0.2f));

            // Dark wood floor + vintage rug under / around the play table approach
            Box(root, "RoomFloor", new Vector3(0f, floorY, 0f),
                new Vector3(roomHalf * 2.1f, 0.4f, roomHalf * 2.1f), woodFloor);
            Box(root, "Rug", new Vector3(0f, floorY + 0.22f, -tableHalf * 0.15f),
                new Vector3(tableHalf * 1.6f, 0.08f, tableHalf * 1.35f), leather);

            // Game table (hero)
            Box(root, "TableTop", new Vector3(0f, tableCenterY, 0f),
                new Vector3(tableHalf * 2f, tableThick, tableHalf * 2f), wood);
            Box(root, "TableApron", new Vector3(0f, tableCenterY - 0.2f, 0f),
                new Vector3(tableHalf * 2.08f, 0.42f, tableHalf * 2.08f), woodDark);
            BuildTrayLip(root, mapHalf, tableHalf, tableTopY + 0.08f, woodDark);
            BuildTableLegs(root, tableHalf, tableCenterY, tableThick, floorY, woodDark);

            // --- Distinct walls (no repeating window strip) ---
            // Back (N): terracotta panel + crest / arms display (like the monitor wall)
            BuildSolidWall(root, "WallN", AlongZ(roomHalf), roomHalf, wallH, floorY, wallT, terracotta);
            BuildCrestWall(root, new Vector3(0f, floorY + wallH * 0.55f, roomHalf - wallT * 0.55f),
                tableHalf * 0.55f, metal, metalDark, clothRed, parchment);

            // Front (S): forest-green wall with framed parchments / maps
            BuildSolidWall(root, "WallS", AlongZ(-roomHalf), roomHalf, wallH, floorY, wallT, forest);
            BuildParchmentCluster(root, new Vector3(-tableHalf * 0.35f, floorY + wallH * 0.5f, -roomHalf + wallT * 0.55f),
                parchment, woodDark);
            BuildParchmentCluster(root, new Vector3(tableHalf * 0.55f, floorY + wallH * 0.42f, -roomHalf + wallT * 0.55f),
                parchment, woodDark);

            // East / West: stone with arched alcoves (reference arches)
            BuildSolidWall(root, "WallE", AlongX(roomHalf), roomHalf, wallH, floorY, wallT, plaster);
            BuildSolidWall(root, "WallW", AlongX(-roomHalf), roomHalf, wallH, floorY, wallT, plaster);
            BuildStoneArchAlcove(root, new Vector3(roomHalf - 3.2f, floorY, tableHalf * 0.15f),
                1f, wallH, stone, stoneDark);
            BuildStoneArchAlcove(root, new Vector3(-roomHalf + 3.2f, floorY, -tableHalf * 0.1f),
                -1f, wallH, stone, stoneDark);

            // Corner stone posts
            var postH = wallH * 0.92f;
            var postY = floorY + postH * 0.5f;
            var p = roomHalf - 1.0f;
            foreach (var xz in new[] { new Vector2(-p, -p), new Vector2(p, -p), new Vector2(-p, p), new Vector2(p, p) })
                Box(root, "CornerStone", new Vector3(xz.x, postY, xz.y), new Vector3(1.7f, postH, 1.7f), stoneDark);

            // Warm wall sconces (candles in holders) — the amber vibe
            PlaceSconce(root, new Vector3(-tableHalf * 0.7f, floorY + wallH * 0.55f, roomHalf - 1.0f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(tableHalf * 0.7f, floorY + wallH * 0.55f, roomHalf - 1.0f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(-roomHalf + 1.0f, floorY + wallH * 0.5f, tableHalf * 0.45f), candle, flame, metalDark);
            PlaceSconce(root, new Vector3(roomHalf - 1.0f, floorY + wallH * 0.5f, -tableHalf * 0.35f), candle, flame, metalDark);

            PlaceGameRoomProps(root, decor, roomHalf, tableHalf, floorY, tableTopY, candle, woodDark, wood);

            // Moody warm lighting (table key + sconce fills already local)
            AddLight(root, "TableKey", new Vector3(0f, 9.5f, 0f),
                new Color(1f, 0.82f, 0.55f), 7.5f, roomHalf * 2.6f);
            AddLight(root, "WarmFill", new Vector3(-roomHalf * 0.25f, 6.5f, roomHalf * 0.2f),
                new Color(1f, 0.7f, 0.4f), 2.8f, roomHalf * 2f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.35f, 0.28f, 0.22f);
            RenderSettings.ambientIntensity = 1.05f;

            var cam = Camera.main;
            if (cam != null)
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.12f, 0.1f, 0.09f);
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
                scale = new Vector3(roomHalf * 2.1f, wallH, wallT);
            }
            else
            {
                pos = new Vector3(wallCenter.x, floorY + wallH * 0.5f, 0f);
                scale = new Vector3(wallT, wallH, roomHalf * 2.1f);
            }
            Box(root, name, pos, scale, mat);
        }

        static void BuildCrestWall(
            Transform root, Vector3 center, float span,
            Material metal, Material metalDark, Material cloth, Material parchment)
        {
            // Crossed blades
            var bladeL = Box(root, "BladeL", center + new Vector3(-0.8f, 1.2f, 0f),
                new Vector3(0.22f, 5.5f, 0.22f), metal);
            bladeL.localRotation = Quaternion.Euler(0f, 0f, 28f);
            var bladeR = Box(root, "BladeR", center + new Vector3(0.8f, 1.2f, 0f),
                new Vector3(0.22f, 5.5f, 0.22f), metal);
            bladeR.localRotation = Quaternion.Euler(0f, 0f, -28f);

            // Central crest / shield
            Box(root, "CrestShield", center + new Vector3(0f, -1.1f, 0.15f),
                new Vector3(2.4f, 2.8f, 0.35f), cloth);
            Box(root, "CrestBoss", center + new Vector3(0f, -1.1f, 0.35f),
                new Vector3(0.7f, 0.7f, 0.25f), metal);

            // Round shields flanking
            Box(root, "RoundShieldL", center + new Vector3(-span * 0.85f, -0.2f, 0.1f),
                new Vector3(2.2f, 2.2f, 0.3f), metalDark);
            Box(root, "RoundShieldR", center + new Vector3(span * 0.85f, -0.2f, 0.1f),
                new Vector3(2.2f, 2.2f, 0.3f), metalDark);

            // Small framed map scrap under crest
            Box(root, "CrestMap", center + new Vector3(0f, -3.4f, 0.12f),
                new Vector3(3.2f, 1.6f, 0.12f), parchment);
        }

        static void BuildParchmentCluster(Transform root, Vector3 center, Material paper, Material frame)
        {
            Box(root, "FrameA", center, new Vector3(3.4f, 2.6f, 0.2f), frame);
            Box(root, "PaperA", center + new Vector3(0f, 0f, 0.12f), new Vector3(3.0f, 2.2f, 0.08f), paper);
            Box(root, "FrameB", center + new Vector3(2.8f, -1.8f, 0f), new Vector3(2.2f, 1.8f, 0.18f), frame);
            Box(root, "PaperB", center + new Vector3(2.8f, -1.8f, 0.12f), new Vector3(1.9f, 1.5f, 0.08f),
                Mat(new Color(0.7f, 0.62f, 0.42f), 0.15f, 0f));
        }

        static void BuildStoneArchAlcove(
            Transform root, Vector3 basePos, float faceSign, float wallH,
            Material stone, Material stoneDark)
        {
            var alcove = new GameObject("StoneArch").transform;
            alcove.SetParent(root, false);
            alcove.position = basePos;

            // Pillars
            Box(alcove, "PillarL", new Vector3(faceSign * 0.2f, wallH * 0.35f, -3.2f),
                new Vector3(1.3f, wallH * 0.7f, 1.3f), stone);
            Box(alcove, "PillarR", new Vector3(faceSign * 0.2f, wallH * 0.35f, 3.2f),
                new Vector3(1.3f, wallH * 0.7f, 1.3f), stone);
            // Arch lintel + curved suggestion (stepped blocks)
            Box(alcove, "Lintel", new Vector3(faceSign * 0.2f, wallH * 0.72f, 0f),
                new Vector3(1.5f, 1.1f, 7.2f), stoneDark);
            Box(alcove, "ArchKey", new Vector3(faceSign * 0.35f, wallH * 0.78f, 0f),
                new Vector3(1.2f, 0.9f, 2.2f), stone);
            // Recessed back panel inside the arch
            Box(alcove, "AlcoveBack", new Vector3(faceSign * 1.4f, wallH * 0.35f, 0f),
                new Vector3(0.5f, wallH * 0.65f, 5.5f), stoneDark);
        }

        static void PlaceSconce(
            Transform root, Vector3 pos, Material candleMat, Material flameMat, Material bracketMat)
        {
            var s = new GameObject("Sconce").transform;
            s.SetParent(root, false);
            s.position = pos;
            Box(s, "Bracket", new Vector3(0f, 0f, 0f), new Vector3(0.35f, 0.35f, 0.8f), bracketMat);
            Box(s, "Candle", new Vector3(0f, 0.55f, 0.15f), new Vector3(0.28f, 0.9f, 0.28f), candleMat);
            var flame = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            flame.name = "Flame";
            flame.transform.SetParent(s, false);
            flame.transform.localPosition = new Vector3(0f, 1.15f, 0.15f);
            flame.transform.localScale = Vector3.one * 0.4f;
            Object.DestroyImmediate(flame.GetComponent<Collider>());
            flame.GetComponent<Renderer>().sharedMaterial = flameMat;
            AddLight(s, "SconceLight", new Vector3(0f, 1.3f, 0.2f),
                new Color(1f, 0.65f, 0.3f), 2.6f, 18f);
        }

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
            var floor = floorY + 0.26f;
            var seatR = tableHalf + 2.6f;

            // Player seats at the game table
            Spawn(root, Pick(catalog?.Chairs, "chair", "chairDesk"),
                new Vector3(0f, floor, -seatR), Quaternion.identity, 2.1f);
            Spawn(root, Pick(catalog?.Chairs, "chairDesk", "chair"),
                new Vector3(seatR * 0.15f, floor, seatR), Quaternion.Euler(0f, 175f, 0f), 2.1f);
            Spawn(root, Pick(catalog?.Chairs, "chair"),
                new Vector3(-seatR, floor, 0.4f), Quaternion.Euler(0f, 90f, 0f), 2.1f);

            // Token / dice tray table in front of the board (reference foreground table)
            Spawn(root, Pick(catalog?.Desks, "tableCoffee", "sideTable", "desk"),
                new Vector3(0f, floor, -tableHalf - 4.2f),
                Quaternion.identity, 2.3f);

            // Bookshelf alcove on the west arch side (single library moment)
            Spawn(root, Pick(catalog?.Bookcases, "bookcaseOpen", "bookcaseClosedWide"),
                new Vector3(-roomHalf + 4.0f, floor, -tableHalf * 0.35f),
                Quaternion.Euler(0f, 90f, 0f), 2.35f);
            Spawn(root, Pick(catalog?.Accents, "books"),
                new Vector3(-roomHalf + 5.5f, floor + 0.05f, -tableHalf * 0.15f),
                Quaternion.Euler(0f, 95f, 0f), 1.9f);

            // Sideboard / low cabinet under east arch
            Spawn(root, Pick(catalog?.Accents, "cabinetBedDrawerTable", "door"),
                new Vector3(roomHalf - 4.2f, floor, tableHalf * 0.4f),
                Quaternion.Euler(0f, -90f, 0f), 2.15f);

            // Small plant only once, near bookshelf (not every corner)
            Spawn(root, Pick(catalog?.Plants, "pottedPlant", "plantSmall1"),
                new Vector3(-roomHalf + 3.2f, floor, tableHalf * 0.55f),
                Quaternion.identity, 2.2f);

            // Table candles
            PlaceCandle(root, new Vector3(-tableHalf + 1.5f, tableTopY + 0.05f, tableHalf - 1.5f), candle, woodDark);
            PlaceCandle(root, new Vector3(tableHalf - 1.5f, tableTopY + 0.05f, -tableHalf + 1.5f), candle, woodDark);

            // Token tray suggestion on the side table (primitive bowl of colored pips)
            BuildTokenTray(root, new Vector3(0.8f, floor + 1.55f, -tableHalf - 4.2f), wood, woodDark);
        }

        static void BuildTokenTray(Transform root, Vector3 pos, Material wood, Material woodDark)
        {
            Box(root, "TokenTray", pos, new Vector3(2.4f, 0.25f, 1.6f), woodDark);
            var colors = new[]
            {
                new Color(0.75f, 0.2f, 0.15f), new Color(0.2f, 0.45f, 0.75f),
                new Color(0.85f, 0.75f, 0.2f), new Color(0.25f, 0.6f, 0.3f),
                new Color(0.7f, 0.7f, 0.75f),
            };
            for (var i = 0; i < 12; i++)
            {
                var ox = ((i % 4) - 1.5f) * 0.45f;
                var oz = ((i / 4) - 1f) * 0.4f;
                Box(root, "TokenPip", pos + new Vector3(ox, 0.22f, oz),
                    new Vector3(0.28f, 0.18f, 0.28f), Mat(colors[i % colors.Length], 0.35f, 0.05f));
            }
        }

        static void BuildTableLegs(
            Transform root, float tableHalf, float tableCenterY, float tableThick, float floorY, Material mat)
        {
            var legInset = tableHalf * 0.8f;
            var legTop = tableCenterY - tableThick * 0.5f;
            var legH = Mathf.Max(2f, legTop - floorY - 0.25f);
            var legY = floorY + legH * 0.5f + 0.2f;
            foreach (var xz in new[]
                     {
                         new Vector2(-legInset, -legInset), new Vector2(legInset, -legInset),
                         new Vector2(-legInset, legInset), new Vector2(legInset, legInset),
                     })
            {
                Box(root, "TableLeg", new Vector3(xz.x, legY, xz.y), new Vector3(1.35f, legH, 1.35f), mat);
            }
        }

        static void BuildTrayLip(Transform root, float mapHalf, float tableHalf, float y, Material mat)
        {
            var outer = tableHalf - 0.12f;
            var inner = mapHalf + 0.12f;
            if (outer <= inner + 0.35f) return;
            var mid = (outer + inner) * 0.5f;
            var width = outer - inner;
            const float h = 0.2f;
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
            Box(c, "Stick", new Vector3(0f, 0.35f, 0f), new Vector3(0.26f, 0.7f, 0.26f), wood);
            var flame = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            flame.name = "Flame";
            flame.transform.SetParent(c, false);
            flame.transform.localPosition = new Vector3(0f, 0.85f, 0f);
            flame.transform.localScale = Vector3.one * 0.32f;
            Object.DestroyImmediate(flame.GetComponent<Collider>());
            flame.GetComponent<Renderer>().sharedMaterial = flameMat;
            AddLight(c, "Glow", new Vector3(0f, 1.1f, 0f), new Color(1f, 0.7f, 0.35f), 2.4f, 16f);
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
            var go = Object.Instantiate(prefab, root);
            go.name = prefab.name;
            go.transform.localPosition = pos;
            go.transform.localRotation = rot;
            go.transform.localScale = Vector3.one * scale;
        }

        static void AddLight(Transform root, string name, Vector3 pos, Color color, float intensity, float range)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.position = pos;
            var light = go.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.None;
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
    }
}
