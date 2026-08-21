using System.Linq;
using CommandWarfare.Board;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEditor;
using UnityEngine;

namespace CommandWarfare.EditorTools
{
    /// <summary>Edit-mode combat smoke: ArmyBuild → Deploy → Play → attack / Slow / Cleave.</summary>
    public static class SkirmishCombatSmoke
    {
        [MenuItem("CommandWarfare/Smoke Test Combat Loop")]
        public static void Run()
        {
            var board = GameObject.Find("HexBoard");
            var ctrl = board != null ? board.GetComponent<BoardGameController>() : null;
            if (ctrl == null)
            {
                HexBoardBootstrap.BootstrapSkirmishScene();
                board = GameObject.Find("HexBoard");
                ctrl = board.GetComponent<BoardGameController>();
            }
            else
            {
                HexBoardBootstrap.BootstrapSkirmishScene();
            }

            var ai = board.GetComponent<SkirmishAi>();
            if (ai != null) ai.enabled = false;

            var flow = board.GetComponent<CommandWarfare.UI.GameFlowController>();
            if (flow != null) flow.EnterMatch();

            ctrl.RestartSkirmish();
            ctrl.SetArmyRace(SeatId.N, "Human");
            ctrl.SetArmyRace(SeatId.S, "Dwarf");

            RunForceSelectPath(ctrl);
            RunScoutCrHelpers();
            RunTerrainPlacementHelpers();
            RunCommandZonePiecesPath(ctrl);

            ctrl.RestartSkirmish();
            ctrl.SetArmyRace(SeatId.N, "Human");
            ctrl.SetArmyRace(SeatId.S, "Dwarf");
            ctrl.BeginDeployFromArmyBuild();
            ctrl.ConfirmDeploy(SeatId.N);
            ctrl.ConfirmDeploy(SeatId.S);

            var state = ctrl.State;
            var sample = state.Units.FirstOrDefault(u => u.Seat == SeatId.N && u.Kind == UnitKind.Unit);
            Debug.Log(
                $"[Smoke] Play phase={state.Phase} units={state.Units.Count} active={state.ActiveSeat} " +
                $"sample={sample?.CardName} cardId={sample?.CardId}");

            if (sample != null && sample.CardId == "placeholder")
            {
                Debug.LogError("[Smoke] Armies still using placeholders — card database did not load.");
                return;
            }

            RunBasicAttack(ctrl, state);
            RunSlowLifecycle(ctrl, state);
            RunCleavePlan(ctrl, state);
            RunFrenzyFollowup(ctrl, state);
            RunTrampleFollowup(ctrl, state);
            RunReviveFromGrave(ctrl, state);
            RunUndoMove(ctrl, state);
            RunGmActions(ctrl, state);
            RunAssetCatalogWiring(ctrl);

            ctrl.EndTurn();
            ctrl.RebuildTokenViews();
            Debug.Log($"[Smoke] After EndTurn active={state.ActiveSeat} round={state.Round}");
            Debug.Log("[Smoke] Combat loop smoke complete.");
        }

        static void RunForceSelectPath(BoardGameController ctrl)
        {
            ctrl.BeginForceSelectFromArmyBuild();
            var state = ctrl.State;
            if (state.Phase != Phase.ForceSelect)
            {
                Debug.LogError($"[Smoke] Expected ForceSelect, got {state.Phase}");
                return;
            }
            if (!state.OfflineArmies.TryGetValue(SeatId.N, out var army) || army?.Companies == null || army.Companies.Count == 0)
            {
                Debug.LogError("[Smoke] ForceSelect missing North demo army.");
                return;
            }

            var loadout = state.BattleLoadouts[SeatId.N];
            var totals = BattleLoadoutUtil.Totals(army, loadout);
            Debug.Log(
                $"[Smoke] ForceSelect N companies={army.Companies.Count} " +
                $"UV D{totals.Deploy}/R{totals.Reserve}/U{totals.Unused}");

            ctrl.ConfirmForceSelect(SeatId.N);
            ctrl.ConfirmForceSelect(SeatId.S);
            if (ctrl.State.Phase != Phase.Terrain)
            {
                Debug.LogError($"[Smoke] Expected Terrain after ForceSelect, got {ctrl.State.Phase}");
                return;
            }

            ctrl.ChooseCommandZoneMode(SeatId.N, "flood");
            ctrl.FloodCommandZone(SeatId.N, OfflineTerrain.FavoredFloodKind("Human"));
            ctrl.ConfirmTerrain(SeatId.N);
            ctrl.ChooseCommandZoneMode(SeatId.S, "flood");
            ctrl.FloodCommandZone(SeatId.S, OfflineTerrain.FavoredFloodKind("Dwarf"));
            ctrl.ConfirmTerrain(SeatId.S);
            if (ctrl.State.Phase != Phase.Terrain || !OfflineTerrain.IsLandStage(ctrl.State.TerrainStage))
            {
                Debug.LogError($"[Smoke] Expected land stage after command zone, got {ctrl.State.Phase}/{ctrl.State.TerrainStage}");
                return;
            }

            // Skip all land drops (N and S × 3 × 3 tiers).
            var guard = 0;
            while (ctrl.State.Phase == Phase.Terrain && OfflineTerrain.IsLandStage(ctrl.State.TerrainStage) && guard++ < 40)
            {
                var seat = ctrl.State.ActiveSeat ?? SeatId.N;
                ctrl.SkipLandDrop(seat);
            }
            if (ctrl.State.Phase != Phase.Deploy)
            {
                Debug.LogError($"[Smoke] Expected Deploy after land stages, got {ctrl.State.Phase}/{ctrl.State.TerrainStage}");
                return;
            }

            var queueN = OfflineDeploy.QueueFor(ctrl.State, SeatId.N);
            Debug.Log($"[Smoke] Deploy queues built N={queueN.Count} (unplaced={queueN.Count(i => i != null && !i.Placed)})");
            ctrl.AutoPlaceDeploy(SeatId.N);
            ctrl.AutoPlaceDeploy(SeatId.S);

            var deployedOfficers = ctrl.State.Units.Count(u => u.Seat == SeatId.N && u.Kind == UnitKind.Officer);
            var deployBucket = loadout.Count(kv => kv.Value == BattleBucket.Deploy);
            Debug.Log($"[Smoke] ForceSelect → Terrain land → Deploy N officers={deployedOfficers} (deploy bucket={deployBucket})");
            if (deployedOfficers != deployBucket)
                Debug.LogError("[Smoke] Deployed officer count does not match Deploy bucket.");
            if (!OfflineDeploy.AllPlaced(ctrl.State, SeatId.N))
                Debug.LogError("[Smoke] North deploy queue not fully placed after AutoPlace.");
        }

        static void RunScoutCrHelpers()
        {
            var officer = new HexCoord(10, 10);
            var inside = new HexCoord(10, 14); // dist 4
            var scoutReach = new HexCoord(10, 17); // dist 7 = 4+3
            var tooFar = new HexCoord(10, 18); // dist 8

            var scout = new UnitToken
            {
                Id = "scout",
                Kind = UnitKind.Unit,
                Keywords = new System.Collections.Generic.List<string> { "Scout" },
            };
            var normal = new UnitToken
            {
                Id = "normal",
                Kind = UnitKind.Unit,
                Keywords = new System.Collections.Generic.List<string>(),
            };

            const int radius = 4;
            if (!CombatResolve.UnitInOfficerRadius(inside, officer, radius, normal))
                Debug.LogError("[Smoke] Scout CR: normal unit should be in base radius.");
            if (CombatResolve.UnitInOfficerRadius(scoutReach, officer, radius, normal))
                Debug.LogError("[Smoke] Scout CR: normal unit should NOT get +3.");
            if (!CombatResolve.UnitInOfficerRadius(scoutReach, officer, radius, scout))
                Debug.LogError("[Smoke] Scout CR: Scout should reach base+3.");
            if (CombatResolve.UnitInOfficerRadius(tooFar, officer, radius, scout))
                Debug.LogError("[Smoke] Scout CR: Scout should not exceed base+3.");
            if (CombatResolve.EffectiveRadiusForUnit(radius, scout) != radius + 3)
                Debug.LogError("[Smoke] Scout CR: EffectiveRadiusForUnit mismatch.");
            Debug.Log("[Smoke] Scout CR helpers OK.");
        }

        static void RunTerrainPlacementHelpers()
        {
            TerrainPieceCatalog.EnsureFallback();
            var pieces = TerrainPieceCatalog.ForSize("large");
            if (pieces.Count == 0)
                Debug.LogError("[Smoke] TerrainPieceCatalog large empty.");
            var shape = new[]
            {
                new TerrainPlacement.AxialOffset(0, 0),
                new TerrainPlacement.AxialOffset(1, 0),
                new TerrainPlacement.AxialOffset(0, 1),
            };
            var cells = TerrainPlacement.ExpandTerrainPiece(new HexCoord(5, 5), shape, 0);
            if (cells.Count != 3)
                Debug.LogError($"[Smoke] ExpandTerrainPiece expected 3 cells, got {cells.Count}");
            var terrain = new System.Collections.Generic.Dictionary<string, TerrainKind>();
            var err = TerrainPlacement.ValidateTerrainPlacement(
                cells, 35, terrain, new System.Collections.Generic.HashSet<string>(), TerrainKind.Forest);
            if (err != null)
                Debug.LogError($"[Smoke] ValidateTerrainPlacement failed: {err}");
            if (!TerrainPlacement.MayCoverCommander(TerrainKind.Forest) ||
                TerrainPlacement.MayCoverCommander(TerrainKind.Water))
                Debug.LogError("[Smoke] MayCoverCommander mismatch.");
            Debug.Log($"[Smoke] TerrainPlacement helpers OK (catalog L={pieces.Count}).");
        }

        static void RunCommandZonePiecesPath(BoardGameController ctrl)
        {
            ctrl.RestartSkirmish();
            ctrl.SetArmyRace(SeatId.N, "Human");
            ctrl.SetArmyRace(SeatId.S, "Dwarf");
            ctrl.BeginForceSelectFromArmyBuild();
            ctrl.ConfirmForceSelect(SeatId.N);
            ctrl.ConfirmForceSelect(SeatId.S);
            if (ctrl.State.Phase != Phase.Terrain)
            {
                Debug.LogError($"[Smoke] CZ pieces: expected Terrain, got {ctrl.State.Phase}");
                return;
            }

            ctrl.ChooseCommandZoneMode(SeatId.N, "pieces");
            var catalog = TerrainPieceCatalog.CommandZoneCatalog(ctrl.State.MaxPlayers);
            if (catalog.Count == 0)
            {
                Debug.LogError("[Smoke] CZ pieces: empty catalog.");
                return;
            }

            var sizesNeeded = new[] { "large", "medium", "medium", "small", "small" };
            foreach (var size in sizesNeeded)
            {
                var pick = catalog.Find(p =>
                    p != null && string.Equals(p.sizeClass, size, System.StringComparison.OrdinalIgnoreCase));
                if (pick == null)
                {
                    Debug.LogError($"[Smoke] CZ pieces: no {size} piece in catalog.");
                    return;
                }
                var err = OfflineTerrain.PickCrPiece(ctrl.State, SeatId.N, pick.id);
                if (err != null)
                {
                    Debug.LogError($"[Smoke] CZ pieces pick failed: {err}");
                    return;
                }
                err = OfflineTerrain.SkipCrHeldPiece(ctrl.State, SeatId.N);
                if (err != null)
                {
                    Debug.LogError($"[Smoke] CZ pieces skip failed: {err}");
                    return;
                }
            }

            if (!OfflineTerrain.IsCommandZoneComplete(ctrl.State, SeatId.N) &&
                !OfflineTerrain.IsSeatReady(ctrl.State, SeatId.N))
            {
                Debug.LogError("[Smoke] CZ pieces: North should be complete/ready after quota skips.");
                return;
            }

            ctrl.ChooseCommandZoneMode(SeatId.S, "flood");
            ctrl.FloodCommandZone(SeatId.S, OfflineTerrain.FavoredFloodKind("Dwarf"));
            if (!OfflineTerrain.IsSeatReady(ctrl.State, SeatId.S))
                ctrl.ConfirmTerrain(SeatId.S);
            if (!OfflineTerrain.IsSeatReady(ctrl.State, SeatId.N))
                ctrl.ConfirmTerrain(SeatId.N);

            if (ctrl.State.Phase != Phase.Terrain || !OfflineTerrain.IsLandStage(ctrl.State.TerrainStage))
                Debug.LogError($"[Smoke] CZ pieces: expected land stage, got {ctrl.State.Phase}/{ctrl.State.TerrainStage}");
            else
                Debug.Log($"[Smoke] CZ pieces path OK → {ctrl.State.TerrainStage}");
        }

        static void RunTrampleFollowup(BoardGameController ctrl, GameState state)
        {
            var attacker = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit);
            var foe = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.S && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 0);
            if (attacker == null || foe == null)
            {
                Debug.LogWarning("[Smoke] Trample: missing units — skipped.");
                return;
            }

            attacker.Keywords ??= new System.Collections.Generic.List<string>();
            if (!attacker.Keywords.Contains("Trample"))
                attacker.Keywords.Add("Trample");

            HexCoord? free = null;
            foreach (var n in HexMath.Neighbors(new HexCoord(foe.Col, foe.Row)))
            {
                if (!HexMath.InBounds(n, state.BoardSize)) continue;
                if (state.Units.Any(u => u.Col == n.Col && u.Row == n.Row && u.Id != attacker.Id))
                    continue;
                free = n;
                break;
            }
            if (!free.HasValue)
            {
                Debug.LogWarning("[Smoke] Trample: no free adjacent hex — skipped.");
                return;
            }

            attacker.Col = free.Value.Col;
            attacker.Row = free.Value.Row;
            var destCol = foe.Col;
            var destRow = foe.Row;
            state.Units.RemoveAll(u => u.Id == foe.Id || (u.Col == destCol && u.Row == destRow && u.Id != attacker.Id));
            state.PendingTrample = new PendingTrample
            {
                AttackerId = attacker.Id,
                DestCol = destCol,
                DestRow = destRow,
                LeftoverDamage = 3,
            };

            if (!CombatFollowup.ContinueTrample(state, out var log))
            {
                Debug.LogError($"[Smoke] Trample Continue failed: {log ?? "(no log)"} pending={state.PendingTrample != null}");
                return;
            }

            ctrl.RebuildTokenViews();
            if (attacker.Col != destCol || attacker.Row != destRow)
                Debug.LogError($"[Smoke] Trample move failed — at ({attacker.Col},{attacker.Row})");
            else
                Debug.Log($"[Smoke] Trample OK → ({attacker.Col},{attacker.Row}) leftover={attacker.TrampleLeftoverDamage} · {log}");
        }

        static void RunReviveFromGrave(BoardGameController ctrl, GameState state)
        {
            if (state.ActiveSeat != SeatId.N)
                state.ActiveSeat = SeatId.N;

            var unit = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 0);
            if (unit == null)
            {
                Debug.LogWarning("[Smoke] Revive: no North unit — skipped.");
                return;
            }

            var deathHex = new HexCoord(unit.Col, unit.Row);
            unit.ToughnessCurrent = 0;
            if (!UnitDestruction.RemoveDead(state, unit, out var destroyLog))
            {
                Debug.LogError("[Smoke] Revive: RemoveDead failed.");
                return;
            }

            if (state.Deaths == null || state.Deaths.Count == 0)
            {
                Debug.LogError("[Smoke] Revive: expected a DeathRecord after RemoveDead.");
                return;
            }

            var death = state.Deaths.Last();
            HexCoord? free = null;
            foreach (var n in HexMath.Neighbors(deathHex))
            {
                if (!HexMath.InBounds(n, state.BoardSize)) continue;
                if (state.Units.Any(u => u.Col == n.Col && u.Row == n.Row)) continue;
                free = n;
                break;
            }
            if (!free.HasValue)
                free = deathHex; // original hex should be empty after removal

            if (!ctrl.TryReviveFromGrave(death.Id, free, toughness: 1))
            {
                Debug.LogError($"[Smoke] Revive failed: {state.LastActionLog}");
                return;
            }

            var revived = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.CardId == death.CardId && u.Col == free.Value.Col && u.Row == free.Value.Row);
            if (revived == null || (revived.ToughnessCurrent ?? 0) != 1)
                Debug.LogError("[Smoke] Revive: unit missing or wrong Toughness.");
            else if (state.Deaths.Any(d => d.Id == death.Id))
                Debug.LogError("[Smoke] Revive: death record not removed.");
            else
                Debug.Log($"[Smoke] Revive OK {revived.CardName} T={revived.ToughnessCurrent} · {destroyLog}");

            ctrl.RebuildTokenViews();
        }

        static void RunUndoMove(BoardGameController ctrl, GameState state)
        {
            if (state.ActiveSeat != SeatId.N)
                state.ActiveSeat = SeatId.N;

            ctrl.EnsureCompanyActivatedForSeat(SeatId.N);
            var unit = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit && u.ActivationCol != null);
            if (unit == null)
            {
                Debug.LogWarning("[Smoke] UndoMove: no activated North unit — skipped.");
                return;
            }

            var startCol = unit.ActivationCol.Value;
            var startRow = unit.ActivationRow.Value;
            HexCoord? dest = null;
            foreach (var n in HexMath.Neighbors(new HexCoord(unit.Col, unit.Row)))
            {
                if (!HexMath.InBounds(n, state.BoardSize)) continue;
                if (state.Units.Any(u => u.Col == n.Col && u.Row == n.Row)) continue;
                dest = n;
                break;
            }
            if (!dest.HasValue)
            {
                Debug.LogWarning("[Smoke] UndoMove: no free neighbor — skipped.");
                return;
            }

            unit.Col = dest.Value.Col;
            unit.Row = dest.Value.Row;
            unit.MoveRemaining = System.Math.Max(0, unit.MoveRemaining - 1);
            state.SelectedUnitId = unit.Id;

            if (!ctrl.TryUndoMoveSelected())
            {
                Debug.LogError($"[Smoke] UndoMove failed: {state.LastActionLog}");
                return;
            }

            if (unit.Col != startCol || unit.Row != startRow)
                Debug.LogError($"[Smoke] UndoMove: expected ({startCol},{startRow}), got ({unit.Col},{unit.Row})");
            else
                Debug.Log($"[Smoke] UndoMove OK → ({unit.Col},{unit.Row}) MR={unit.MoveRemaining}");
        }

        static void RunGmActions(BoardGameController ctrl, GameState state)
        {
            if (state.ActiveSeat != SeatId.N)
                state.ActiveSeat = SeatId.N;

            if (!ctrl.TryRollDice(2, 6, "smoke"))
            {
                Debug.LogError($"[Smoke] RollDice failed: {state.LastActionLog}");
                return;
            }
            if (state.LastDiceRoll == null || state.LastDiceRoll.Results == null || state.LastDiceRoll.Results.Count != 2)
                Debug.LogError("[Smoke] RollDice: LastDiceRoll missing/wrong count.");
            else
                Debug.Log($"[Smoke] RollDice OK {state.LastDiceRoll.Count}d{state.LastDiceRoll.Sides} total={state.LastDiceRoll.Total}");

            var unit = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 1);
            if (unit == null)
            {
                Debug.LogWarning("[Smoke] ApplyDamage/Heal: no North unit — skipped.");
                return;
            }

            state.SelectedUnitId = unit.Id;
            var before = unit.ToughnessCurrent ?? 0;
            if (!ctrl.TryApplyDamageSelected(1))
            {
                Debug.LogError($"[Smoke] ApplyDamage failed: {state.LastActionLog}");
                return;
            }
            if ((unit.ToughnessCurrent ?? 0) != before - 1)
                Debug.LogError($"[Smoke] ApplyDamage: expected {before - 1}, got {unit.ToughnessCurrent}");
            else
                Debug.Log($"[Smoke] ApplyDamage OK T={unit.ToughnessCurrent}");

            if (!ctrl.TryApplyHealSelected(1))
            {
                Debug.LogError($"[Smoke] ApplyHeal failed: {state.LastActionLog}");
                return;
            }
            if ((unit.ToughnessCurrent ?? 0) != before)
                Debug.LogError($"[Smoke] ApplyHeal: expected restore to {before}, got {unit.ToughnessCurrent}");
            else
                Debug.Log($"[Smoke] ApplyHeal OK T={unit.ToughnessCurrent}");
        }

        static void RunAssetCatalogWiring(BoardGameController ctrl)
        {
            var so = new SerializedObject(ctrl);
            var unitCat = so.FindProperty("_unitCatalog")?.objectReferenceValue as UnitAssetCatalog;
            var terrainSo = new SerializedObject(ctrl.GetComponent<HexBoardBuilder>());
            var terrainCat = terrainSo.FindProperty("_terrainCatalog")?.objectReferenceValue as TerrainAssetCatalog;

            if (unitCat == null)
                Debug.LogError("[Smoke] Asset pipeline: BoardGameController._unitCatalog not assigned.");
            else if (unitCat.unitPrefab == null && unitCat.commanderPrefab == null)
                Debug.LogWarning("[Smoke] Asset pipeline: UnitAssetCatalog has no prefabs — procedural tokens used.");
            else
                Debug.Log($"[Smoke] Asset pipeline: UnitAssetCatalog wired (unit={(unitCat.unitPrefab != null ? unitCat.unitPrefab.name : "null")}).");

            if (terrainCat == null)
                Debug.LogError("[Smoke] Asset pipeline: HexBoardBuilder._terrainCatalog not assigned.");
            else
                Debug.Log("[Smoke] Asset pipeline: TerrainAssetCatalog wired.");

            // Confirm token rebuild prefers catalog when assigned.
            var before = ctrl.State?.Units?.Count ?? 0;
            ctrl.RebuildTokenViews();
            Debug.Log($"[Smoke] Token rebuild after catalog check (units={before}).");
        }

        static void RunBasicAttack(BoardGameController ctrl, GameState state)
        {
            ctrl.EnsureCompanyActivatedForSeat(SeatId.N);
            var unit = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N &&
                (u.Kind == UnitKind.Unit || u.Kind == UnitKind.Officer) &&
                u.MoveRemaining > 0);
            if (unit == null)
            {
                Debug.LogError("[Smoke] No North unit with MoveRemaining after company activation.");
                return;
            }

            var enemy = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.S && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 0);
            if (enemy == null)
            {
                Debug.LogError("[Smoke] No South unit to attack.");
                return;
            }

            if (!TryPlaceAdjacent(state, unit, enemy))
            {
                Debug.LogError("[Smoke] No free hex adjacent to enemy.");
                return;
            }

            unit.MoveRemaining = System.Math.Max(1, unit.MoveRemaining);
            ctrl.RebuildTokenViews();

            var attacks = MoveReachability.AttackTargetKeys(state, unit);
            Debug.Log($"[Smoke] Attack targets={attacks.Count} for {unit.CardName}");
            if (attacks.Count == 0)
            {
                Debug.LogError("[Smoke] Still no attack targets after adjacency teleport.");
                return;
            }

            var target = state.Units.First(u => attacks.Contains(HexMath.Key(u.Col, u.Row)));
            var rng = new SeededRng(SeededRng.SeedFromRoomCode(state.RoomCode, "smoke"));
            var ok = SkirmishActions.ExecuteAttack(state, unit, target, rng, null, out var log);
            Debug.Log($"[Smoke] Attack ok={ok} log={log}");
        }

        static void RunSlowLifecycle(BoardGameController ctrl, GameState state)
        {
            var officer = state.Units.FirstOrDefault(u => u.Seat == SeatId.N && u.Kind == UnitKind.Officer);
            var unit = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit &&
                officer != null && u.OfficerCardId == officer.CardId);
            if (officer == null || unit == null)
            {
                Debug.LogWarning("[Smoke] Slow lifecycle skipped — no company unit.");
                return;
            }

            // Force a fresh activation with Slow applied.
            state.ActiveCompanyOfficerId = null;
            state.CompaniesActivatedThisRound.Remove(officer.Id);
            state.CompanyActivatedThisTurn.Remove(SeatId.N);
            unit.Slow = true;
            unit.SlowPendingClear = false;
            unit.Move = 5;

            var activate = CompanyActivation.TryActivateCompany(state, officer, null);
            Debug.Log(
                $"[Smoke] Slow activate ok={activate.Ok} moveRem={unit.MoveRemaining} " +
                $"pendingClear={unit.SlowPendingClear} (expect moveRem=4)");

            if (unit.MoveRemaining != 4 || !unit.SlowPendingClear)
                Debug.LogError("[Smoke] Slow did not reduce move budget / mark pending clear.");

            CompanyActivation.EndPreviousCompanyActivation(state, SeatId.N);
            Debug.Log($"[Smoke] After end activation Slow={unit.Slow} pending={unit.SlowPendingClear} (expect both false)");
            if (unit.Slow || unit.SlowPendingClear)
                Debug.LogError("[Smoke] Slow was not cleared at end of company activation.");
        }

        static void RunCleavePlan(BoardGameController ctrl, GameState state)
        {
            var cleaver = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit);
            var foes = state.Units.Where(u =>
                u.Seat == SeatId.S && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 0).Take(2).ToList();
            if (cleaver == null || foes.Count < 2)
            {
                Debug.LogWarning("[Smoke] Cleave skipped — need 1 attacker + 2 foes.");
                return;
            }

            if (!cleaver.Keywords.Any(k => k != null && k.StartsWith("Cleave", System.StringComparison.OrdinalIgnoreCase)))
                cleaver.Keywords.Add("Cleave");
            cleaver.Damage = 3;
            cleaver.Range = 1;

            // Place both foes adjacent to cleaver on free land hexes near board mid-south.
            var anchor = new HexCoord(cleaver.Col, cleaver.Row);
            var neighbors = HexMath.Neighbors(anchor).Where(n => HexMath.InBounds(n, state.BoardSize)).ToList();
            if (neighbors.Count < 2)
            {
                // Relocate cleaver to a safer interior hex first.
                cleaver.Col = state.BoardSize / 2;
                cleaver.Row = state.BoardSize / 2;
                neighbors = HexMath.Neighbors(new HexCoord(cleaver.Col, cleaver.Row))
                    .Where(n => HexMath.InBounds(n, state.BoardSize)).ToList();
            }

            foes[0].Col = neighbors[0].Col;
            foes[0].Row = neighbors[0].Row;
            foes[1].Col = neighbors[1].Col;
            foes[1].Row = neighbors[1].Row;

            // Ensure company allows attack.
            state.ActiveSeat = SeatId.N;
            var officer = CompanyActivation.FindOfficerForUnit(state, cleaver);
            if (officer != null)
            {
                state.ActiveCompanyOfficerId = null;
                state.CompaniesActivatedThisRound.Remove(officer.Id);
                state.CompanyActivatedThisTurn.Remove(SeatId.N);
                CompanyActivation.TryActivateCompany(state, officer, null);
            }

            if (!CleavePlanner.CanCleave(cleaver, foes[0], state))
            {
                Debug.LogError(
                    $"[Smoke] CanCleave=false adj={CleavePlanner.AdjacentEnemyCount(state, cleaver)} dmg={CombatDamage.EffectiveDamage(cleaver)}");
                return;
            }

            var pending = CleavePlanner.Begin(cleaver, foes[0]);
            CleavePlanner.TryAssign(pending, foes[1].Id);
            CleavePlanner.TryAssign(pending, foes[1].Id); // 1+2 split of 3
            state.PendingCleave = pending;
            Debug.Log(
                $"[Smoke] Cleave plan assigned={CleavePlanner.AssignedTotal(pending)}/{pending.TotalDamage} " +
                $"targets={pending.Assignments.Count}");

            ctrl.ConfirmCleave();
            Debug.Log($"[Smoke] Cleave resolved pending={(state.PendingCleave != null)} log={state.LastCombatLog}");
            if (state.PendingCleave != null)
                Debug.LogError("[Smoke] PendingCleave not cleared after ConfirmCleave.");
        }

        static void RunFrenzyFollowup(BoardGameController ctrl, GameState state)
        {
            state.ActiveSeat = SeatId.N;
            var attacker = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.N && u.Kind == UnitKind.Unit);
            var foe = state.Units.FirstOrDefault(u =>
                u.Seat == SeatId.S && u.Kind == UnitKind.Unit && (u.ToughnessCurrent ?? 0) > 0);
            if (attacker == null || foe == null)
            {
                Debug.LogWarning("[Smoke] Frenzy skipped — missing units.");
                return;
            }

            if (!attacker.Keywords.Any(k =>
                    k != null && k.Equals("Frenzy", System.StringComparison.OrdinalIgnoreCase)))
                attacker.Keywords.Add("Frenzy");

            attacker.AttackedThisTurn = true;
            attacker.FrenzyAttackPending = true;
            attacker.Damage = System.Math.Max(1, attacker.Damage ?? 1);
            attacker.Range = System.Math.Max(1, attacker.Range ?? 1);

            if (!TryPlaceAdjacent(state, attacker, foe))
            {
                Debug.LogError("[Smoke] Frenzy: could not place adjacent.");
                return;
            }

            var officer = CompanyActivation.FindOfficerForUnit(state, attacker);
            if (officer != null && state.ActiveCompanyOfficerId != officer.Id)
            {
                state.CompaniesActivatedThisRound.Remove(officer.Id);
                state.CompanyActivatedThisTurn.Remove(SeatId.N);
                CompanyActivation.TryActivateCompany(state, officer, null);
            }

            var rng = new SeededRng(SeededRng.SeedFromRoomCode(state.RoomCode, "frenzy"));
            var foeHpBefore = foe.ToughnessCurrent;
            var ok = SkirmishActions.ExecuteAttack(state, attacker, foe, rng, null, out var log);
            var foeAlive = state.Units.Any(u => u.Id == foe.Id);
            Debug.Log(
                $"[Smoke] Frenzy bonus attack ok={ok} pending={attacker.FrenzyAttackPending} " +
                $"foeAlive={foeAlive} log={log}");
            if (!ok)
                Debug.LogError("[Smoke] Frenzy bonus attack was illegally rejected.");
            // Consuming the bonus clears pending; a new kill can re-arm Frenzy.
            if (ok && foeAlive && attacker.FrenzyAttackPending)
                Debug.LogError("[Smoke] FrenzyAttackPending should clear when bonus attack does not kill.");
        }

        static bool TryPlaceAdjacent(GameState state, UnitToken unit, UnitToken enemy)
        {
            foreach (var n in HexMath.Neighbors(new HexCoord(enemy.Col, enemy.Row)))
            {
                if (!HexMath.InBounds(n, state.BoardSize)) continue;
                if (state.Units.Any(u => u.Id != unit.Id && u.Col == n.Col && u.Row == n.Row)) continue;
                unit.Col = n.Col;
                unit.Row = n.Row;
                return true;
            }
            return false;
        }
    }
}
