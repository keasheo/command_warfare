# CommandWarfare — Unity Port

Unity project path: `D:/Projects/Unity/CommandWarfare`

This folder mirrors `Assets/Scripts` for version control. After editing here, copy to the Unity project or symlink.

## Team structure (AI dev roles)

| Track | Owner focus | Status |
|-------|-------------|--------|
| **Core / Rules** | Port `play/shared/*.ts` → C# (`Hex`, `Combat`, `GameState`, `Abilities`) | Hex, map gen, combat resolve, company activation + AP pools |
| **Board / 3D** | Hex grid, terrain blocks, camera, unit tokens | 35×35 board, deploy overlay, skirmish loop, combat FX |
| **Assets** | URP materials, terrain props, unit placeholders | Catalogs + Generate Placeholder Prefabs + Asset Store slots |
| **Data** | YAML cards → ScriptableObjects or JSON loader | Editor YAML import + `exportCardsJson.mjs` → `cards-unity.json` |
| **Net** | Mirror existing Node server or Unity Netcode | `PlaySocketClient` + state sync + quick-pick army submit |

## Getting the board on screen

1. Open `D:/Projects/Unity/CommandWarfare` in Unity 6 + URP.
2. Ensure MCP bridge is connected (Unity AI Assistant → Cursor).
3. Copy/sync scripts from this folder into `Assets/Scripts`.
4. Run **`CommandWarfare → Bootstrap Skirmish Scene`** (or add `HexBoard` + components manually).
5. Press Play — N (Human) vs S (Dwarf AI) skirmish.

## Free Asset Store picks (starting set)

Use **URP-compatible** packs. Verify license before shipping.

| Need | Suggested free packs | Notes |
|------|-------------------|-------|
| Low-poly trees | [Simple Nature Pack](https://assetstore.unity.com/packages/3d/environments/simple-nature-pack-162231) | Forest scatter on hex tops |
| Rocks / mountains | [POLYGON Nature](https://assetstore.unity.com/packages/3d/environments/landscapes/polygon-nature-low-poly-3d-art-by-synty-120152) (often on sale/free promos) or [Rock Pack](https://assetstore.unity.com/packages/3d/props/exterior/rock-pack-3-82938) | Mountain hex detail |
| Ground textures | Unity built-in + [Free PBR Materials](https://assetstore.unity.com/packages/2d/textures-materials/free-pbr-materials-210283) | Replace flat vertex colors |
| Unit placeholders | [Mini Legion Footmen](https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/mini-legion-footmen-pbr-polyart-128396) or Synty POLYGON mini packs | Token stand-ins until card art meshes |
| Siege / props | [Medieval Siege Engines](https://assetstore.unity.com/packages/3d/props/weapons/medieval-siege-engines-75409) (check current price) | Ballista/cannon proxies |
| VFX | [Cartoon FX Free](https://assetstore.unity.com/packages/vfx/particles/cartoon-particles-cfx-free-109565) | Combat hits, blast |

Generated assets (via Unity MCP `GenerateMesh` / `GenerateMaterial`) can fill gaps once you confirm generation in chat.

## Port order (recommended sprints)

1. **Sprint 1** — Hex grid + camera + click selection ✅
2. **Sprint 2** — Terrain scatter props + `randomMap` port ✅ *(connectivity + water caps)*
3. **Sprint 3** — Unit token prefabs + deploy zones ✅ *(catalog slots + procedural fallback)*
4. **Sprint 4** — Combat resolve + floating combat text ✅ *(company activation in progress)*
5. **Sprint 5** — Card data pipeline + army builder UI *(JSON export done; builder UI pending)*
6. **Sprint 6** — Socket client to existing play server OR embedded offline skirmish *(skirmish ✅, socket stub)*

## Card data pipeline

Two import paths from `data/cards/**/*.yaml`:

1. **Unity Editor** — `CommandWarfare → Import Cards From YAML`  
   Creates per-card ScriptableObjects under `Assets/Data/Cards/` and a `CardDatabase.asset` index.  
   Set the data root via `CommandWarfare → Set Data Root…` if needed.

2. **Node card export** — `npm run export:unity:cards`  
   Writes `cards.json` and `cards-unity.json`.

3. **Abilities export** — `npm run export:unity:abilities`  
   Writes `abilities-unity.json`. Copy `play/shared/commanderEffectAliases.json` to `Assets/Data/`.

4. **Keywords export** — `npm run export:unity:keywords`  
   Writes `keywords-unity.json`. Unity Editor: **`CommandWarfare → Import Keywords From YAML`**.

5. **Quick-pick armies export** — `npm run export:unity:armies`
   Writes `quick-pick-armies-unity.json` with pre-built `submitArmy` / `confirmForceSelect` WebSocket payloads (36 commander presets).

Assign `Assets/Data/cards-unity.json`, `abilities-unity.json`, and `commanderEffectAliases.json` to `BoardGameController`.

## Asset catalogs

Run **`CommandWarfare → Create Asset Catalogs`**, then either:

- **`CommandWarfare → Generate Placeholder Prefabs`** — primitive tree/peak/rock/reed/volcanic + commander/officer/unit prefabs under `Assets/Prefabs/Generated`, assigned to the catalogs
- or drop Asset Store meshes into `TerrainAssetCatalog` / `UnitAssetCatalog`

- `TerrainAssetCatalog` — forest, mountain, desert, swamp, volcanic scatter
- `UnitAssetCatalog` — commander/officer/unit plus per-race overrides

Run **`CommandWarfare → Validate Asset Catalogs`** to check which prefab slots are still empty.

## Offline skirmish (Play mode)

`BoardGameController` on `HexBoard` loads cards + builds `GameState`:
- Starts in **ArmyBuild** — pick N/S races, then **Start Deploy** / `[E]`
- **Deploy** — reposition units in your zone, then **Confirm Deploy**. AI auto-confirms S → **Play**
- Click friendly unit to select
- Click empty hex to move (uses remaining Move)
- Click enemy to resolve attack (2d6 vs hit need); **Cleave** units enter damage-split assignment first

**2P turns:** N (Human) vs S (Dwarf). **`SkirmishAi`** auto-plays S after 0.65s. Win when enemy officers/units are destroyed.

**Company activation:** selecting a unit auto-activates its officer company (once per turn, once per officer per round). Commander click activates commander move for the round.

**Movement:** terrain-aware pathfinding (water blocked unless Amphibious; minimum-1 overspend rule).

**Combat:** favored terrain hit/damage/harden, flanking, fortified hexes, evade/fear modifiers, **Formation Drill/Guard/March** adjacency auras, Slow status on movement. Kill follow-ups: **Trample** (HUD Continue/Decline), **Blast** splash, **Overpenetrate**, **Counterattack**, Poison/Fear/Slow on hit, Frenzy pending. **MultiStrike** rolls multiple hits; **Cleave** auto-splits melee Damage among adjacent enemies; **Harass** grants free Move 1 after attack; **Guard** Disengage Strikes; **Bone Prison** blocks attacks; **Charge** / **Adaptive Attack** keywords.

**Objectives:** North–South pair zones spawn in offline skirmish. Majority control + **2 VP per held zone at end of round**. Highest VP after 15 rounds wins (wipeout still wins immediately).

**Abilities (offline):** Heal/Medic/Repair, Forge Mend, Repair Rites, Rally, Evade, Harden Order, Overdrive, Counterattack, Howl / Withering Gaze / Mass Fear / Eclipse of Fear / Alpha Howl, Snare / Bone Prison / Entangling Roots / Serpent Coil / Basilisk Glare / Grave Bind, Shadow Orb, Focused Assault, Spectral Strike, Null Pulse, Poison Tide, Tribal Convergence, Prime Protocol, Void Torment, Alpha Rush, Spear Thrust, Siege Barrage, Moonbind, Kindred Roar, Rootweave Surge, Regenerative Surge, Pack Reform, Tactical Withdrawal, Death March / Brood Call / army CR buffs, Fortify hexes.

**Keywords:** Charge (+1 Damage after moving 2+ hexes), Adaptive Attack (Damage = current Toughness), MultiStrike, Cleave, Harass, Guard (Disengage), Bone Prison, Stealth (ranged targeting), Revenant (once-per-battle return), Siege vs Fortified, Shieldwall.

Parity check: `npm run check:unity:abilities` (named `game.ts` effects vs C# switch).

**Highlights:** green = move, red = attack targets. `[E]` end turn, RMB cancel.

Components: `HexBoardBuilder`, `BoardInputController`, `BoardGameController`, `SkirmishHud`, `SkirmishAi`, `DeployZoneVisualizer` (optional).

**Multiplayer:** `Net/PlaySocketClient.cs` connects to `ws://127.0.0.1:8788/ws` (Node play server). Add `PlayNetworkBridge` + `PlayNetworkHud` on `HexBoard`.

1. Start play server: `npm run dev:play:server` (and card API if needed).
2. Export quick-pick armies: `npm run export:unity:armies` → `Assets/Data/quick-pick-armies-unity.json`.
3. Bootstrap scene wires the JSON to `PlayNetworkHud` automatically.
4. Play mode → **Connect (create vs AI)** → **Submit quick-pick army** (pick race/commander) → **Advance setup** through force select / terrain / deploy → play moves sync from server.

During **ArmyBuild**, use **Submit quick-pick army**. During **ForceSelect**, use **Confirm force (default loadout)** — respects deploy/reserve UV caps (110/60).

The setup button label updates per phase (submit army, force start, deploy piece, confirm deploy, etc.). Click through until **Play**.

Verify headless: `npx tsx unity/CommandWarfare/scripts/networkSetupSmoke.ts` (play server must be running).

**Offline skirmish:** leave `PlayNetworkBridge.NetworkMode` unchecked (default) — local rules + Dwarf AI.

## Sync from TypeScript repo

Source of truth for rules: `play/shared/` in the main CommandWarfare repo.

When porting a module, add a comment header: `// Ported from play/shared/foo.ts`
