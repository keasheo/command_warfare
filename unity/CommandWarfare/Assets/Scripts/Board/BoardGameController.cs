using System;
using System.Collections.Generic;
using System.Linq;
using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using CommandWarfare.Net;
using CommandWarfare.Units;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Wires hex board to GameState: 2P turns, selection, move, attack, victory.</summary>
    [RequireComponent(typeof(HexBoardBuilder))]
    public class BoardGameController : MonoBehaviour
    {
        [SerializeField] TextAsset _cardsJson;
        [SerializeField] TextAsset _abilitiesJson;
        [SerializeField] TextAsset _abilityAliasesJson;
        [SerializeField] TextAsset _terrainPiecesJson;
        [SerializeField] CardDatabase _cardDatabase;
        [SerializeField] AbilityDatabase _abilityDatabase;
        [SerializeField] UnitAssetCatalog _unitCatalog;
        [SerializeField] string _roomSeed = "dev";

        HexBoardBuilder _board;
        GameState _state;
        SeededRng _rng;
        PlayNetworkBridge _network;
        Transform _tokensRoot;
        readonly Dictionary<string, UnitTokenView> _views = new();
        string _pendingAbilityName;
        string _pendingAbilityTargetId;
        string _pendingAttackTargetId;
        bool _pendingAttackPick;

        public GameState State => _state;
        public string PendingAbilityName => _pendingAbilityName;
        public string PendingAbilityTargetId => _pendingAbilityTargetId;
        public string PendingAttackTargetId => _pendingAttackTargetId;
        public bool PendingAttackPick => _pendingAttackPick;
        public CardDatabase Cards
        {
            get
            {
                EnsureCardDatabase();
                return _cardDatabase;
            }
        }

        public AbilityDatabase Abilities
        {
            get
            {
                EnsureAbilityDatabase();
                return _abilityDatabase;
            }
        }
        public bool IsNetworkMode => _network != null && _network.NetworkMode;
        public string RoomSeed => _roomSeed;
        public event Action TurnChanged;
        public event Action SelectionChanged;

        void Awake()
        {
            _board = GetComponent<HexBoardBuilder>();
            _network = GetComponent<PlayNetworkBridge>();
            _rng = new SeededRng(SeededRng.SeedFromRoomCode(_roomSeed, "combat"));
            EnsureCardDatabase();
            EnsureAbilityDatabase();
            EnsureTerrainPieceCatalog();
            // Demo spawner fights the real token sync and leaves phantom UnitTokens.
            var demoSpawner = GetComponent<UnitTokenSpawner>();
            if (demoSpawner != null) demoSpawner.enabled = false;
            _state = _network != null && _network.NetworkMode
                ? new GameState()
                : GameSessionFactory.CreateArmyBuildLobby(_roomSeed);
        }

        /// <summary>Called by PlayNetworkBridge when server state arrives.</summary>
        public void ApplyNetworkStateRefresh()
        {
            if (!string.IsNullOrEmpty(_state?.RoomCode))
                SyncRoomSeed(_state.RoomCode);
            if (_state.Terrain != null && _state.Terrain.Count > 0)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshBattlefieldOverlays();
            RefreshHighlights();
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        void EnsureAbilityDatabase()
        {
            if (_abilityDatabase != null && _abilityDatabase.abilities != null &&
                _abilityDatabase.abilities.Count > 0)
            {
                _abilityDatabase.RebuildIndex();
                if (_abilityAliasesJson != null)
                    AbilityAliasMap.LoadFromTextAsset(_abilityAliasesJson);
                return;
            }
            if (_abilitiesJson != null)
                _abilityDatabase = AbilityJsonLoader.BuildDatabase(_abilitiesJson);
            if (_abilityAliasesJson != null)
                AbilityAliasMap.LoadFromTextAsset(_abilityAliasesJson);
        }

        void OnEnable() => _board.TileClicked += OnTileClicked;
        void OnDisable() => _board.TileClicked -= OnTileClicked;

        void Start()
        {
            var spawner = GetComponent<UnitTokenSpawner>();
            if (spawner != null) spawner.enabled = false;
            if (_state?.Terrain != null && _state.Terrain.Count > 0)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshHighlights();
            TurnChanged?.Invoke();
        }

        void Update()
        {
            BattleAudio.Tick();
            if (_state.Phase == Phase.Ended) return;
            if (BoardInput.RightMouseDown())
            {
                if (_state.PendingCleave != null)
                {
                    CancelCleave();
                }
                else if (!string.IsNullOrEmpty(_pendingAbilityName) ||
                         !string.IsNullOrEmpty(_pendingAttackTargetId) ||
                         !string.IsNullOrEmpty(_pendingAbilityTargetId) ||
                         _pendingAttackPick)
                {
                    CancelPendingPlayAction();
                }
                else if (_state.SelectedUnitId != null)
                {
                    _state.SelectedUnitId = null;
                    RefreshHighlights();
                    SelectionChanged?.Invoke();
                }
            }
            if (BoardInput.EndTurnKeyDown())
            {
                if (_state.Phase == Phase.ArmyBuild)
                    BeginForceSelectFromArmyBuild();
                else if (_state.Phase == Phase.ForceSelect)
                    ConfirmForceSelect(SeatId.N);
                else if (_state.Phase == Phase.Terrain && _state.TerrainStage == "commandZone")
                    ConfirmTerrain(SeatId.N);
                else if (_state.Phase == Phase.Terrain && OfflineTerrain.IsLandStage(_state.TerrainStage))
                    SkipLandDrop(_state.ActiveSeat ?? SeatId.N);
                else if (_state.Phase == Phase.Deploy)
                    ConfirmDeploy(_state.ActiveSeat ?? SeatId.N);
                else if (_state.PendingCleave != null)
                    ConfirmCleave();
                else if (CombatFollowup.IsPendingTrampleValid(_state, out _))
                    TryContinueTrample();
                else
                    EndTurn();
            }
            HandleAbilityHotkeys();
            if (_state.Phase == Phase.Play && BoardInput.UndoHotkeyDown())
                TryUndoMoveSelected();
        }

        void HandleAbilityHotkeys()
        {
            if (_state.Phase == Phase.Ended || _state.Phase == Phase.ArmyBuild ||
                _state.Phase == Phase.ForceSelect || _state.Phase == Phase.Terrain ||
                _state.Phase == Phase.Deploy)
                return;
            if (_state.PendingCleave != null) return;
            var selected = SelectedUnit();
            if (selected == null) return;

            if (BoardInput.KeyDown(KeyCode.V))
                TryActivateEvade(selected);
            if (BoardInput.KeyDown(KeyCode.H))
                BeginAbilityTarget("Heal");
            if (BoardInput.KeyDown(KeyCode.R))
                TryCastAbility(selected, "Rally", null);
        }

        public void BeginAbilityTarget(string abilityName)
        {
            var selected = SelectedUnit();
            if (selected == null) return;
            if (!HasAbility(selected, abilityName))
            {
                _state.LastActionLog = $"{selected.CardName} does not have {abilityName}.";
                Debug.LogWarning($"[CommandWarfare] {_state.LastActionLog}");
                return;
            }
            _pendingAttackTargetId = null;
            _pendingAttackPick = false;
            _pendingAbilityTargetId = null;
            _pendingAbilityName = abilityName;
            SelectionChanged?.Invoke();
            _state.LastActionLog = $"Select target for {abilityName} (RMB cancel).";
            Debug.Log($"[CommandWarfare] {_state.LastActionLog}");
        }

        public void CancelPendingPlayAction()
        {
            _pendingAbilityName = null;
            _pendingAbilityTargetId = null;
            _pendingAttackTargetId = null;
            _pendingAttackPick = false;
            SelectionChanged?.Invoke();
        }

        /// <summary>Prototype: Attack button → click enemy → confirm.</summary>
        public void BeginAttackPick()
        {
            if (_state?.Phase != Phase.Play || !_state.ActiveSeat.HasValue) return;
            var selected = SelectedUnit();
            if (selected == null || selected.Seat != _state.ActiveSeat.Value) return;

            if (UnitAlreadyAttacked(selected))
            {
                _state.LastActionLog = selected.Kind == UnitKind.Commander
                    ? "Commander already attacked this round."
                    : "Already attacked this turn.";
                SelectionChanged?.Invoke();
                return;
            }
            if (selected.Kind != UnitKind.Commander &&
                !CompanyActivation.IsUnitInActiveCompany(_state, selected))
            {
                _state.LastActionLog = "Activate this company first.";
                SelectionChanged?.Invoke();
                return;
            }

            _pendingAbilityName = null;
            _pendingAbilityTargetId = null;
            _pendingAttackTargetId = null;
            _pendingAttackPick = true;
            _state.LastActionLog = "Click an enemy to attack (RMB cancel).";
            RefreshHighlights();
            SelectionChanged?.Invoke();
            // Prevent the Attack button's own mouse-down from also raycasting the board.
            BoardInputController.HudBlocksBoardClicks = true;
        }

        public static bool UnitAlreadyAttacked(UnitToken unit)
        {
            if (unit == null) return true;
            if (unit.TrampleLeftoverDamage > 0 || unit.FrenzyAttackPending) return false;
            return unit.Kind == UnitKind.Commander
                ? unit.AttackedThisRound
                : unit.AttackedThisTurn;
        }

        public bool TryConfirmPendingAbility()
        {
            if (string.IsNullOrEmpty(_pendingAbilityName)) return false;
            var caster = SelectedUnit();
            UnitToken target = null;
            if (!string.IsNullOrEmpty(_pendingAbilityTargetId))
                target = _state.Units.FirstOrDefault(u => u.Id == _pendingAbilityTargetId);
            var ability = _pendingAbilityName;
            _pendingAbilityName = null;
            _pendingAbilityTargetId = null;
            if (caster == null) return false;
            return TryCastAbility(caster, ability, target);
        }

        public bool TryConfirmPendingAttack()
        {
            if (string.IsNullOrEmpty(_pendingAttackTargetId)) return false;
            var attacker = SelectedUnit();
            var defender = _state.Units.FirstOrDefault(u => u.Id == _pendingAttackTargetId);
            if (attacker == null || defender == null)
            {
                _pendingAttackTargetId = null;
                _pendingAttackPick = false;
                _state.LastActionLog = "Attack target missing.";
                SelectionChanged?.Invoke();
                return false;
            }
            if (!TryAttack(attacker, defender))
            {
                // Cleave opens its own pending UI — keep that, clear only a failed attack.
                if (_state.PendingCleave != null)
                {
                    _pendingAttackTargetId = null;
                    _pendingAttackPick = false;
                    RefreshHighlights();
                    SelectionChanged?.Invoke();
                    return true;
                }
                _pendingAttackTargetId = null;
                _pendingAttackPick = false;
                SelectionChanged?.Invoke();
                return false;
            }
            _pendingAttackTargetId = null;
            _pendingAttackPick = false;
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryGetAttackPreview(UnitToken attacker, UnitToken defender, out string summary)
        {
            summary = null;
            if (attacker == null || defender == null) return false;
            if (!SkirmishActions.TryPreviewAttack(_state, attacker, defender, _cardDatabase, out var preview, out var err))
            {
                summary = err ?? "Illegal attack";
                return false;
            }
            summary =
                $"Need {preview.HitNeed}+ · dmg {preview.RawDamage}" +
                (preview.Legal ? "" : $" · {preview.Reason}");
            return preview.Legal;
        }

        public bool TryCastAbility(UnitToken caster, string abilityName, UnitToken target)
        {
            if (IsNetworkMode)
            {
                if (!_network.TrySendCastAbility(caster.Id, abilityName, target?.Id)) return false;
                _pendingAbilityName = null;
                _pendingAbilityTargetId = null;
                Debug.Log($"[CommandWarfare] Sent cast {abilityName}");
                SelectionChanged?.Invoke();
                return true;
            }

            EnsureAbilityDatabase();
            var result = AbilityCastResolver.TryCastAbility(
                _state, caster, abilityName, target, _abilityDatabase);
            if (!result.Ok)
            {
                Debug.LogWarning($"[CommandWarfare] {result.Error}");
                return false;
            }
            _state.LastActionLog = result.Log;
            _pendingAbilityName = null;
            _pendingAbilityTargetId = null;
            Debug.Log($"[CommandWarfare] {result.Log}");
            BattleAudio.PlayAbility();
            SyncTokensToState();
            EndTurnAfterAction();
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryActivateEvade(UnitToken unit)
        {
            if (IsNetworkMode)
            {
                if (!_network.TrySendActivateEvade(unit.Id)) return false;
                Debug.Log($"[CommandWarfare] Sent activate Evade");
                return true;
            }

            var result = AbilityCastResolver.TryActivateEvade(_state, unit);
            if (!result.Ok)
            {
                Debug.LogWarning($"[CommandWarfare] {result.Error}");
                return false;
            }
            _state.LastActionLog = result.Log;
            Debug.Log($"[CommandWarfare] {result.Log}");
            SyncTokensToState();
            SelectionChanged?.Invoke();
            return true;
        }

        static bool HasAbility(UnitToken unit, string abilityName) =>
            CombatKeywords.HasUnitAbility(unit, abilityName);

        void EnsureRng()
        {
            var seed = string.IsNullOrEmpty(_roomSeed) ? "dev" : _roomSeed;
            if (_rng == null)
                _rng = new SeededRng(SeededRng.SeedFromRoomCode(seed, "combat"));
        }

        /// <summary>Propagate room code to state, board visuals, and combat RNG.</summary>
        public void SyncRoomSeed(string roomCode)
        {
            if (string.IsNullOrWhiteSpace(roomCode)) return;
            _roomSeed = roomCode.Trim();
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            _board?.SetRoomSeed(_roomSeed);
            if (_state != null) _state.RoomCode = _roomSeed;
            _rng = new SeededRng(SeededRng.SeedFromRoomCode(_roomSeed, "combat"));
        }

        /// <summary>New random map seed for offline skirmish (called at match/room setup).</summary>
        public void AssignNewRoomSeed()
        {
            if (IsNetworkMode) return;
            SyncRoomSeed(RoomSeedGenerator.Generate());
        }

        void EnsureCardDatabase()
        {
            if (CardDatabaseHasCards(_cardDatabase)) return;
            if (_cardsJson != null)
            {
                _cardDatabase = CardJsonLoader.BuildDatabase(_cardsJson);
                if (!CardDatabaseHasCards(_cardDatabase))
                    Debug.LogWarning("[CommandWarfare] Cards JSON loaded but produced an empty database.");
            }
            else
                Debug.LogWarning("[CommandWarfare] No cards JSON assigned — armies will use placeholders.");
        }

        void EnsureTerrainPieceCatalog()
        {
            if (TerrainPieceCatalog.IsLoaded) return;
            if (_terrainPiecesJson != null)
                TerrainPieceCatalog.LoadFromTextAsset(_terrainPiecesJson);
            else
                TerrainPieceCatalog.EnsureFallback();
        }

        static bool CardDatabaseHasCards(CardDatabase db)
        {
            if (db?.All == null || db.All.Count == 0) return false;
            foreach (var c in db.All)
            {
                if (c != null && !string.IsNullOrEmpty(c.cardId))
                    return true;
            }
            return false;
        }

        [ContextMenu("Restart Skirmish")]
        public void RestartSkirmish()
        {
            if (_board == null)
                _board = GetComponent<HexBoardBuilder>();
            EnsureRng();
            EnsureCardDatabase();
            EnsureAbilityDatabase();
            if (IsNetworkMode)
            {
                _state = new GameState();
            }
            else
            {
                AssignNewRoomSeed();
                _state = GameSessionFactory.CreateArmyBuildLobby(
                    _roomSeed,
                    _state?.NorthRace ?? "Human",
                    _state?.SouthRace ?? "Dwarf");
            }
            SyncTokensToState();
            RefreshHighlights();
            TurnChanged?.Invoke();
        }

        public void SetArmyRace(SeatId seat, string race)
        {
            if (_state == null || _state.Phase != Phase.ArmyBuild) return;
            if (seat == SeatId.N) _state.NorthRace = race;
            else if (seat == SeatId.S) _state.SouthRace = race;
            SelectionChanged?.Invoke();
        }

        public void SetOfflineArmy(SeatId seat, DemoArmy army)
        {
            if (_state == null || army == null) return;
            _state.OfflineArmies[seat] = army;
            if (army.Commander != null && !string.IsNullOrEmpty(army.Commander.race))
            {
                if (seat == SeatId.N) _state.NorthRace = army.Commander.race;
                else if (seat == SeatId.S) _state.SouthRace = army.Commander.race;
            }
            SelectionChanged?.Invoke();
        }

        public void SetLoadoutPools(int deployMax, int reserveMax)
        {
            if (_state == null) return;
            _state.LoadoutPools = new LoadoutPools
            {
                DeployMax = Mathf.Clamp(deployMax, 1, 999),
                ReserveMax = Mathf.Clamp(reserveMax, 0, 999),
            };
        }

        public void SetRandomMap(bool randomMap)
        {
            if (_state == null) return;
            _state.RandomMap = randomMap;
        }

        public void ApplyMatchSetup(int deployMax, int reserveMax, bool randomMap)
        {
            if (_state == null) return;
            _state.LoadoutPools = new LoadoutPools
            {
                DeployMax = Mathf.Clamp(deployMax, 1, 999),
                ReserveMax = Mathf.Clamp(reserveMax, 0, 999),
            };
            _state.RandomMap = randomMap;
            SelectionChanged?.Invoke();
        }

        public void SetBattlefieldVisible(bool visible)
        {
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            // Kill leftover menu floaters whenever we show the real board.
            if (visible)
                CommandWarfare.UI.MenuBackdrop3D.ForceCleanupScene();
            _board?.SetBattlefieldVisible(visible);
            var deploy = GetComponent<DeployZoneVisualizer>();
            if (deploy != null) deploy.enabled = visible;
            var objectives = GetComponent<ObjectiveVisualizer>();
            if (objectives != null) objectives.enabled = visible;
            // Ensure token root exists and matches visibility.
            if (_tokensRoot == null)
            {
                var existing = transform.Find("UnitTokens");
                if (existing != null) _tokensRoot = existing;
            }
            if (_tokensRoot != null)
                _tokensRoot.gameObject.SetActive(visible);
            if (visible)
                RefreshBattlefieldOverlays();
        }

        /// <summary>Rebuild deploy wedges + objective markers after map/phase changes.</summary>
        public void RefreshBattlefieldOverlays()
        {
            var deploy = GetComponent<DeployZoneVisualizer>();
            if (deploy != null)
            {
                if (!deploy.enabled) deploy.enabled = true;
                deploy.RebuildOverlay();
            }
            var objectives = GetComponent<ObjectiveVisualizer>();
            if (objectives != null)
            {
                if (!objectives.enabled) objectives.enabled = true;
                objectives.Rebuild();
            }
            // Keep battlefield mesh on whenever overlays rebuild during a match.
            var tiles = transform.Find("Tiles");
            if (tiles != null && !tiles.gameObject.activeSelf)
                tiles.gameObject.SetActive(true);
            var tokens = transform.Find("UnitTokens");
            if (tokens != null && !tokens.gameObject.activeSelf)
                tokens.gameObject.SetActive(true);
            FrameCameraOnBoard();
        }

        public void FrameCameraOnBoard()
        {
            var cam = Camera.main;
            if (cam == null) return;
            var ctrl = cam.GetComponent<BoardCameraController>();
            if (ctrl == null) return;
            // HexBoardBuilder.CenterBoard puts the map midpoint at world origin.
            // Reset pitch/distance so the hex grid is readable (not a flat horizon slab).
            ctrl.ResetToBoardOverview();
        }

        public void BeginForceSelectFromArmyBuild(bool preserveArmies = false)
        {
            if (_state == null || _state.Phase != Phase.ArmyBuild || IsNetworkMode) return;
            EnsureCardDatabase();
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            _state = GameSessionFactory.BeginForceSelectFromArmyBuild(_state, _cardDatabase, preserveArmies);
            SyncRoomSeed(_state.RoomCode);
            if (_state?.Terrain != null && _state.Terrain.Count > 0 && _board != null)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshBattlefieldOverlays();
            RefreshHighlights();
            Debug.Log($"[CommandWarfare] ArmyBuild → ForceSelect ({_state.NorthRace} vs {_state.SouthRace})");
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        /// <summary>Smoke / shortcut: skip interactive ForceSelect and go straight to Deploy.</summary>
        public void BeginDeployFromArmyBuild()
        {
            if (_state == null || _state.Phase != Phase.ArmyBuild || IsNetworkMode) return;
            EnsureCardDatabase();
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            _state = GameSessionFactory.BeginDeployFromArmyBuild(_state, _cardDatabase);
            SyncRoomSeed(_state.RoomCode);
            if (_state?.Terrain != null && _state.Terrain.Count > 0 && _board != null)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshBattlefieldOverlays();
            RefreshHighlights();
            Debug.Log($"[CommandWarfare] ArmyBuild → Deploy ({_state.NorthRace} vs {_state.SouthRace})");
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        public void SetForceSelectBucket(SeatId seat, string officerId, BattleBucket bucket)
        {
            if (_state == null || _state.Phase != Phase.ForceSelect || IsNetworkMode) return;
            if (_state.ForceSelectReady.TryGetValue(seat, out var ready) && ready) return;
            if (!_state.BattleLoadouts.TryGetValue(seat, out var loadout) || loadout == null)
            {
                loadout = new Dictionary<string, BattleBucket>();
                _state.BattleLoadouts[seat] = loadout;
            }
            BattleLoadoutUtil.SetBucket(loadout, officerId, bucket);
            SelectionChanged?.Invoke();
        }

        public void ConfirmForceSelect(SeatId seat)
        {
            if (_state == null || _state.Phase != Phase.ForceSelect || IsNetworkMode) return;
            if (!_state.OfflineArmies.TryGetValue(seat, out var army))
            {
                Debug.LogWarning($"[CommandWarfare] No offline army for {seat}");
                return;
            }
            _state.BattleLoadouts.TryGetValue(seat, out var loadout);
            var err = BattleLoadoutUtil.Validate(army, loadout, _state.LoadoutPools);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }

            _state.ForceSelectReady[seat] = true;
            _state.LastActionLog = $"{seat} confirmed force select.";
            if (GameSessionFactory.TryAdvanceForceSelectToDeploy(_state, _cardDatabase))
            {
                if (_state?.Terrain != null && _state.Terrain.Count > 0 && _board != null)
                    _board.Rebuild(_state.Terrain);
                SetBattlefieldVisible(true);
                SyncTokensToState();
                RefreshBattlefieldOverlays();
                RefreshHighlights();
                Debug.Log($"[CommandWarfare] ForceSelect → {_state.Phase} ({_state.NorthRace} vs {_state.SouthRace})");
                TurnChanged?.Invoke();
            }
            SelectionChanged?.Invoke();
        }

        public void FloodCommandZone(SeatId seat, TerrainKind kind)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                if (OfflineTerrain.ModeFor(_state, seat) == null)
                    _network.TrySendChooseCommandZoneMode("flood");
                _network.TrySendFloodCommandZone(kind.ToString().ToLowerInvariant());
                return;
            }
            if (OfflineTerrain.ModeFor(_state, seat) == null)
                OfflineTerrain.ChooseCommandZoneMode(_state, seat, "flood");
            var err = OfflineTerrain.FloodSeat(_state, seat, kind);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }
            if (_board != null && _state.Terrain != null)
                _board.Rebuild(_state.Terrain);
            SelectionChanged?.Invoke();
        }

        public void ChooseCommandZoneMode(SeatId seat, string mode)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                _network.TrySendChooseCommandZoneMode(mode);
                return;
            }
            var err = OfflineTerrain.ChooseCommandZoneMode(_state, seat, mode);
            if (err != null) _state.LastActionLog = err;
            SelectionChanged?.Invoke();
        }

        public void PickCrPiece(SeatId seat, string pieceId)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                _network.TrySendPickTerrain(pieceId);
                return;
            }
            var err = OfflineTerrain.PickCrPiece(_state, seat, pieceId);
            if (err != null) _state.LastActionLog = err;
            SelectionChanged?.Invoke();
        }

        public void SkipCrHeldPiece(SeatId seat)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                _network.TrySendSkipTerrain();
                return;
            }
            var err = OfflineTerrain.SkipCrHeldPiece(_state, seat);
            if (err != null) _state.LastActionLog = err;
            SelectionChanged?.Invoke();
            if (_state.TerrainStage != "commandZone")
            {
                TurnChanged?.Invoke();
            }
        }

        public void PlaceCrAt(HexCoord anchor)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                var handIndex = _state.PendingCrHandIndex.TryGetValue(SeatId.N, out var hi) ? hi : (int?)null;
                _network.TrySendPlaceTerrain(anchor.Col, anchor.Row, _state.PendingLandRotation, handIndex);
                return;
            }
            var seat = SeatId.N;
            var err = OfflineTerrain.PlaceCrPiece(_state, seat, anchor);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }
            if (_board != null)
                _board.Rebuild(_state.Terrain);
            SelectionChanged?.Invoke();
            if (_state.TerrainStage != "commandZone")
                TurnChanged?.Invoke();
        }

        public void ConfirmTerrain(SeatId seat)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                if (_state.TerrainStage == "commandZone")
                    _network.TrySendConfirmTerrain();
                return;
            }
            if (_state.TerrainStage != "commandZone") return;
            if (!OfflineTerrain.ConfirmCommandZone(_state, seat)) return;
            if (_board != null && _state.Terrain != null)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshHighlights();
            Debug.Log($"[CommandWarfare] {seat} confirmed command zone. Stage={_state.TerrainStage} Phase={_state.Phase}");
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        public void SelectLandPiece(string pieceId)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                // Land stage uses pending piece id locally until place; network place includes pieceId.
                if (!OfflineTerrain.IsLandStage(_state.TerrainStage)) return;
                _state.PendingLandPieceId = pieceId;
                SelectionChanged?.Invoke();
                return;
            }
            if (!OfflineTerrain.IsLandStage(_state.TerrainStage)) return;
            _state.PendingLandPieceId = pieceId;
            SelectionChanged?.Invoke();
        }

        public void RotateLandPiece()
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            _state.PendingLandRotation = (_state.PendingLandRotation + 1) % 6;
            SelectionChanged?.Invoke();
        }

        public void SkipLandDrop(SeatId seat)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                _network.TrySendSkipTerrain();
                return;
            }
            var err = OfflineTerrain.SkipLandDrop(_state, seat);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }
            if (_state.Phase == Phase.Deploy && _board != null)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshHighlights();
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        public void PlaceLandAt(HexCoord anchor)
        {
            if (_state == null || _state.Phase != Phase.Terrain) return;
            if (IsNetworkMode)
            {
                _network.TrySendPlaceTerrain(
                    anchor.Col, anchor.Row, _state.PendingLandRotation,
                    pieceId: _state.PendingLandPieceId);
                return;
            }
            var seat = _state.ActiveSeat ?? SeatId.N;
            var err = OfflineTerrain.PlaceLandPiece(_state, seat, anchor);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }
            if (_board != null)
                _board.Rebuild(_state.Terrain);
            SyncTokensToState();
            RefreshHighlights();
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        public void ConfirmCleave()
        {
            if (_state?.PendingCleave == null || IsNetworkMode) return;
            EnsureRng();
            if (!SkirmishActions.ExecuteCleavePlan(_state, _state.PendingCleave, _rng, _cardDatabase, out var log))
                return;
            _state.LastCombatLog = log;
            _state.LastActionLog = log;
            Debug.Log($"[CommandWarfare] Cleave: {log}");
            SyncTokensToState();
            CheckVictory();
            EndTurnAfterAction();
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        public void CancelCleave()
        {
            if (_state == null) return;
            _state.PendingCleave = null;
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        public void ConfirmDeploy(SeatId seat)
        {
            if (_state.Phase != Phase.Deploy || IsNetworkMode) return;
            var err = OfflineDeploy.ConfirmSeat(_state, seat, _cardDatabase);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return;
            }
            _state.SelectedUnitId = null;
            SyncTokensToState();
            RefreshHighlights();
            Debug.Log($"[CommandWarfare] {seat} confirmed deploy. Phase={_state.Phase}");
            TurnChanged?.Invoke();
            SelectionChanged?.Invoke();
        }

        public void SelectDeployQueueItem(SeatId seat, int index)
        {
            if (_state?.Phase != Phase.Deploy || IsNetworkMode) return;
            OfflineDeploy.SelectQueueIndex(_state, seat, index);
            _state.SelectedUnitId = null;
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        public void AutoPlaceDeploy(SeatId seat)
        {
            if (_state?.Phase != Phase.Deploy || IsNetworkMode) return;
            var n = OfflineDeploy.AutoPlaceAll(_state, seat);
            _state.LastActionLog = $"{seat} auto-placed {n} piece(s).";
            SyncTokensToState();
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        public void EndTurn()
        {
            if (_state.Phase == Phase.Ended) return;
            if (_state.Phase == Phase.Deploy)
            {
                ConfirmDeploy(_state.ActiveSeat ?? SeatId.N);
                return;
            }
            if (IsNetworkMode)
            {
                _network.TrySendEndTurn();
                _state.SelectedUnitId = null;
                RefreshHighlights();
                return;
            }
            CombatFollowup.SanitizePendingFollowups(_state);
            var beforeSeat = _state.ActiveSeat;
            var beforeRound = _state.Round;
            TurnSystem.EndTurn(_state, _cardDatabase);
            RefreshHighlights();
            if (_state.Round != beforeRound)
                Debug.Log($"[CommandWarfare] Round → {_state.Round}; Turn → {_state.ActiveSeat}");
            else if (_state.ActiveSeat != beforeSeat)
                Debug.Log($"[CommandWarfare] Turn → {_state.ActiveSeat} (round {_state.Round})");
            if (!string.IsNullOrEmpty(_state.LastActionLog) &&
                _state.LastActionLog.Contains("skipped"))
                Debug.Log($"[CommandWarfare] {_state.LastActionLog}");
            TurnChanged?.Invoke();
        }

        public void ExecuteSkirmishAction(SkirmishAction action)
        {
            if (_state.Phase == Phase.Ended) return;
            if (_state.Phase == Phase.Deploy) return;

            switch (action.Kind)
            {
                case SkirmishActionKind.EndTurn:
                    EndTurn();
                    return;

                case SkirmishActionKind.Move:
                {
                    var unit = _state.Units.FirstOrDefault(u => u.Id == action.UnitId);
                    if (unit != null && SkirmishActions.ExecuteMove(_state, unit, action.Dest))
                    {
                        SyncTokensToState();
                        Debug.Log($"[CommandWarfare] AI move {unit.CardName} → ({action.Dest.Col},{action.Dest.Row})");
                    }
                    break;
                }
                case SkirmishActionKind.Attack:
                {
                    var attacker = _state.Units.FirstOrDefault(u => u.Id == action.UnitId);
                    var defender = _state.Units.FirstOrDefault(u => u.Id == action.TargetUnitId);
                    if (attacker != null && defender != null && TryAttack(attacker, defender))
                    {
                        // TryAttack already syncs / FX; do not auto-end turn (multi-action AI).
                    }
                    break;
                }
                case SkirmishActionKind.ActivateCommander:
                    TryActivateCommander(_state.ActiveSeat ?? SeatId.S);
                    SyncTokensToState();
                    break;
                case SkirmishActionKind.ActivateCompany:
                {
                    var officer = _state.Units.FirstOrDefault(u => u.Id == action.UnitId);
                    if (officer != null)
                        TryActivateCompanyFor(officer);
                    SyncTokensToState();
                    break;
                }
                case SkirmishActionKind.CastAbility:
                {
                    var caster = _state.Units.FirstOrDefault(u => u.Id == action.UnitId);
                    UnitToken target = null;
                    if (!string.IsNullOrEmpty(action.TargetUnitId))
                        target = _state.Units.FirstOrDefault(u => u.Id == action.TargetUnitId);
                    if (caster != null && !string.IsNullOrEmpty(action.AbilityName))
                        TryCastAbility(caster, action.AbilityName, target);
                    break;
                }
                case SkirmishActionKind.ContinueTrample:
                    TryContinueTrample();
                    break;
                case SkirmishActionKind.DeclineTrample:
                    TryDeclineTrample();
                    break;
            }

            RefreshHighlights();
            SelectionChanged?.Invoke();
            CheckVictory();
        }

        void CheckVictory()
        {
            var winner = VictorySystem.CheckWinner(_state);
            if (!winner.HasValue) return;
            VictorySystem.ApplyVictory(_state, winner.Value);
            RefreshHighlights();
            Debug.Log($"[CommandWarfare] {winner.Value} wins!");
            TurnChanged?.Invoke();
        }

        void SyncTokensToState()
        {
            if (_state?.Units == null)
            {
                RebuildTokenViews();
                return;
            }

            // Incremental: animate moves for surviving tokens; rebuild only when roster changes.
            var liveIds = new HashSet<string>();
            foreach (var unit in _state.Units)
                liveIds.Add(unit.Id);

            var rosterChanged = _views.Count != liveIds.Count;
            if (!rosterChanged)
            {
                foreach (var id in liveIds)
                {
                    if (!_views.ContainsKey(id))
                    {
                        rosterChanged = true;
                        break;
                    }
                }
            }

            if (rosterChanged || _tokensRoot == null)
            {
                RebuildTokenViews();
                return;
            }

            foreach (var unit in _state.Units)
            {
                if (!_views.TryGetValue(unit.Id, out var view) || view == null) continue;
                var dest = TokenWorldPos(unit);
                var mover = view.GetComponent<UnitTokenMover>();
                if (mover == null) mover = view.gameObject.AddComponent<UnitTokenMover>();
                var delta = dest - view.transform.position;
                if (delta.sqrMagnitude > 0.01f)
                    mover.MoveTo(dest);
                else
                    mover.SnapTo(dest);
                view.SetHp(unit.ToughnessCurrent, unit.Toughness);
                view.SetBoardIdentity(unit.Id, unit.Col, unit.Row);
            }
        }

        /// <summary>Rebuild unit token GameObjects from current state (edit-mode smoke / tools).</summary>
        public void RebuildTokenViews()
        {
            ClearChildrenNamed("UnitTokens");
            _tokensRoot = new GameObject("UnitTokens").transform;
            _tokensRoot.SetParent(transform, false);
            _views.Clear();

            if (_state?.Units == null) return;

            foreach (var unit in _state.Units)
            {
                var go = new GameObject($"Token_{unit.Id}");
                go.transform.SetParent(_tokensRoot, false);
                go.transform.position = TokenWorldPos(unit);

                var race = !string.IsNullOrEmpty(unit.Race) ? unit.Race : RaceFor(unit.Seat);
                GameObject prefab = null;
                // Catalog meshes keep authored textures; seat identity is the plate color.
                var tint = Color.white;
                if (_unitCatalog != null)
                    prefab = _unitCatalog.Resolve(unit.Kind, race, unit.CardId);

                var view = go.AddComponent<UnitTokenView>();
                view.SetBoardIdentity(unit.Id, unit.Col, unit.Row);
                view.Bind(
                    LabelFor(unit),
                    SeatColors.Fill(unit.Seat),
                    unit.Kind,
                    prefab,
                    tint,
                    unit.CardId,
                    race,
                    unit.Keywords,
                    unit.Range ?? 1,
                    unit.ToughnessCurrent,
                    unit.Toughness);
                go.AddComponent<UnitTokenMover>();
                _views[unit.Id] = view;
            }
        }

        void ClearChildrenNamed(string childName)
        {
            var doomed = new System.Collections.Generic.List<GameObject>();
            for (var i = 0; i < transform.childCount; i++)
            {
                var child = transform.GetChild(i);
                if (child != null && child.name == childName)
                    doomed.Add(child.gameObject);
            }
            foreach (var go in doomed)
                DestroyImmediate(go);
            if (_tokensRoot != null && (_tokensRoot.Equals(null) || _tokensRoot.name != "UnitTokens"))
                _tokensRoot = null;
        }

        static void AddTokenBaseRing(Transform parent, Color color, UnitKind kind)
        {
            var ring = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            ring.name = "SeatRing";
            ring.transform.SetParent(parent, false);
            var radius = kind == UnitKind.Commander ? 0.55f : kind == UnitKind.Officer ? 0.42f : 0.34f;
            ring.transform.localPosition = new Vector3(0f, 0.02f, 0f);
            ring.transform.localScale = new Vector3(radius, 0.04f, radius);
            var col = ring.GetComponent<Collider>();
            if (col != null) DestroyImmediate(col);
            var r = ring.GetComponent<Renderer>();
            if (r != null)
                r.sharedMaterial = TerrainMaterialFactory.CreateTileInstance(color);
        }

        static string CardTypeFor(UnitKind kind) => kind switch
        {
            UnitKind.Commander => "Commander",
            UnitKind.Officer => "Officer",
            _ => "Unit",
        };

        string RaceFor(SeatId seat)
        {
            if (_state == null) return seat == SeatId.S ? "Dwarf" : "Human";
            return seat == SeatId.S
                ? (_state.SouthRace ?? "Dwarf")
                : (_state.NorthRace ?? "Human");
        }

        void RefreshHighlights()
        {
            ClearAllTileHighlights();
            foreach (var kv in _views)
                kv.Value.SetSelected(kv.Key == _state.SelectedUnitId);

            if (_state.Phase == Phase.Ended || _state.Phase == Phase.ArmyBuild ||
                _state.Phase == Phase.ForceSelect || _state.Phase == Phase.Terrain) return;

            if (_state.PendingCleave != null)
            {
                var attacker = _state.Units.Find(u => u.Id == _state.PendingCleave.AttackerId);
                if (attacker != null)
                {
                    TileAt(attacker.Col, attacker.Row)?.SetHighlight(HighlightKind.Selected);
                    foreach (var foe in CleavePlanner.AdjacentEnemies(_state, attacker))
                        TileAt(foe.Col, foe.Row)?.SetHighlight(HighlightKind.Attack);
                }
                return;
            }

            var selected = SelectedUnit();

            if (_state.Phase == Phase.Deploy)
            {
                if (selected != null)
                {
                    PaintCommandRadii(selected);
                    foreach (var key in OfflineDeploy.DeployHexesForUnit(_state, selected))
                        TileAtKey(key)?.SetHighlight(HighlightKind.Move);
                    TileAt(selected.Col, selected.Row)?.SetHighlight(HighlightKind.Selected);
                    return;
                }

                var seat = SeatId.N;
                var idx = OfflineDeploy.SelectedIndex(_state, seat);
                if (idx >= 0)
                {
                    foreach (var key in OfflineDeploy.DeployHexesForQueueItem(_state, seat, idx))
                        TileAtKey(key)?.SetHighlight(HighlightKind.Move);
                }
                return;
            }

            if (selected == null) return;

            // Inspect-only for enemy / other-seat units — no move/attack rings.
            if (!_state.ActiveSeat.HasValue || selected.Seat != _state.ActiveSeat.Value)
            {
                TileAt(selected.Col, selected.Row)?.SetHighlight(HighlightKind.Selected);
                return;
            }

            // CR under move/attack so legal actions stay readable.
            PaintCommandRadii(selected);

            TileAt(selected.Col, selected.Row)?.SetHighlight(HighlightKind.Selected);

            if (_pendingAttackPick || !string.IsNullOrEmpty(_pendingAttackTargetId))
            {
                foreach (var key in MoveReachability.AttackTargetKeys(_state, selected))
                    TileAtKey(key)?.SetHighlight(HighlightKind.Attack);
                if (!string.IsNullOrEmpty(_pendingAttackTargetId))
                {
                    var foe = _state.Units.Find(u => u.Id == _pendingAttackTargetId);
                    if (foe != null)
                        TileAt(foe.Col, foe.Row)?.SetHighlight(HighlightKind.Attack);
                }
                return;
            }

            foreach (var key in MoveReachability.ReachableHexes(_state, selected))
                TileAtKey(key)?.SetHighlight(HighlightKind.Move);

            foreach (var key in MoveReachability.AttackTargetKeys(_state, selected))
                TileAtKey(key)?.SetHighlight(HighlightKind.Attack);
        }

        void PaintCommandRadii(UnitToken selected)
        {
            if (selected == null || _state == null) return;

            if (selected.Kind == UnitKind.Commander)
            {
                var rad = selected.CommandRadius ?? GameConstants.DefaultCommanderCommandRadius;
                foreach (var key in DeployPlacement.CommandRadiusKeys(
                             new HexCoord(selected.Col, selected.Row), rad, _state.BoardSize))
                    TileAtKey(key)?.SetHighlight(HighlightKind.CommanderRadius);
                return;
            }

            var officer = FindCompanyOfficer(selected);
            if (officer == null) return;
            var officerRad = officer.CommandRadius ?? GameConstants.DefaultOfficerCommandRadius;
            officerRad = DeployPlacement.EffectiveRadiusForUnit(officerRad, selected.Keywords);
            foreach (var key in DeployPlacement.CommandRadiusKeys(
                         new HexCoord(officer.Col, officer.Row), officerRad, _state.BoardSize))
                TileAtKey(key)?.SetHighlight(HighlightKind.CommandRadius);
        }

        UnitToken FindCompanyOfficer(UnitToken unit)
        {
            if (unit == null || _state?.Units == null) return null;
            if (unit.Kind == UnitKind.Officer) return unit;
            if (unit.Kind == UnitKind.Commander) return null;
            if (string.IsNullOrEmpty(unit.OfficerCardId)) return null;
            foreach (var u in _state.Units)
            {
                if (u.Seat != unit.Seat || u.Kind != UnitKind.Officer) continue;
                if (u.CardId == unit.OfficerCardId) return u;
            }
            return null;
        }

        void ClearAllTileHighlights()
        {
            var tiles = transform.Find("Tiles");
            if (tiles == null) return;
            foreach (Transform child in tiles)
                child.GetComponent<HexTile>()?.ClearHighlight();
        }

        HexTile TileAt(int col, int row) => TileAtKey(HexMath.Key(col, row));

        HexTile TileAtKey(string key)
        {
            var parts = key.Split(',');
            if (parts.Length != 2) return null;
            var tiles = transform.Find("Tiles");
            if (tiles == null) return null;
            var t = tiles.Find($"Hex_{parts[0]}_{parts[1]}");
            return t != null ? t.GetComponent<HexTile>() : null;
        }

        Vector3 TokenWorldPos(UnitToken unit)
        {
            if (_board == null)
                _board = GetComponent<HexBoardBuilder>();
            var hexSize = _board != null ? _board.HexSize : 1f;
            var key = HexMath.Key(unit.Col, unit.Row);
            var height = _state != null && _state.Terrain.TryGetValue(key, out var t)
                ? TerrainVisuals.BlockHeight(t)
                : 0.72f;
            return transform.TransformPoint(
                HexMath.OddRToWorld(unit.Col, unit.Row, hexSize)
                + Vector3.up * (height + 0.55f));
        }

        static string LabelFor(UnitToken unit)
        {
            if (unit == null) return "U";
            var promoted = unit.Promoted || HasPromotedKeyword(unit);
            return unit.Kind switch
            {
                UnitKind.Commander => promoted ? "PC" : "C",
                UnitKind.Officer => promoted ? "PO" : "O",
                _ => "U",
            };
        }

        static bool HasPromotedKeyword(UnitToken unit)
        {
            if (unit?.Keywords == null) return false;
            foreach (var k in unit.Keywords)
            {
                if (!string.IsNullOrEmpty(k) &&
                    k.Equals("Promoted", System.StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        UnitToken SelectedUnit() =>
            _state.SelectedUnitId == null
                ? null
                : _state.Units.FirstOrDefault(u => u.Id == _state.SelectedUnitId);

        /// <summary>Select a unit from HUD / quick-pick without requiring a board click.</summary>
        public void SelectUnit(string unitId)
        {
            if (_state == null || string.IsNullOrEmpty(unitId) || _state.Units == null) return;
            UnitToken found = null;
            foreach (var u in _state.Units)
            {
                if (u.Id != unitId) continue;
                found = u;
                break;
            }
            if (found == null) return;

            CancelPendingPlayAction();
            _state.SelectedUnitId = found.Id;
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        void OnTileClicked(HexTile tile)
        {
            if (_state.Phase == Phase.Ended || _state.Phase == Phase.ArmyBuild ||
                _state.Phase == Phase.ForceSelect) return;

            if (_state.Phase == Phase.Terrain)
            {
                if (_state.TerrainStage == "commandZone" &&
                    OfflineTerrain.ModeFor(_state, SeatId.N) == "pieces")
                {
                    PlaceCrAt(tile.Coord);
                    return;
                }
                if (OfflineTerrain.IsLandStage(_state.TerrainStage) &&
                    !string.IsNullOrEmpty(_state.PendingLandPieceId))
                    PlaceLandAt(tile.Coord);
                return;
            }

            if (_state.PendingCleave != null)
            {
                HandleCleaveClick(tile);
                return;
            }

            if (_state.Phase == Phase.Deploy)
            {
                HandleDeployClick(tile);
                return;
            }
            if (_state.Phase != Phase.Play) return;

            var unit = UnitAt(tile.Coord);
            var myTurn = _state.ActiveSeat.HasValue &&
                         (!IsNetworkMode ||
                          (_network != null && _network.IsLocalSeat(_state.ActiveSeat.Value)));

            if (!string.IsNullOrEmpty(_pendingAbilityName))
            {
                if (!myTurn) return;
                // Prototype: pick target first, confirm in HUD.
                if (unit != null)
                {
                    _pendingAbilityTargetId = unit.Id;
                    _state.LastActionLog =
                        $"Confirm cast {_pendingAbilityName} on {unit.CardName}?";
                }
                else
                {
                    _pendingAbilityName = null;
                    _pendingAbilityTargetId = null;
                }
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            // Attack mode: pick enemy and resolve immediately (confirm still available if needed).
            if (_pendingAttackPick || !string.IsNullOrEmpty(_pendingAttackTargetId))
            {
                if (!myTurn) return;
                var attacker = SelectedUnit();
                if (unit != null && attacker != null && unit.Seat != attacker.Seat)
                {
                    _pendingAttackPick = false;
                    _pendingAttackTargetId = unit.Id;
                    _state.LastActionLog = $"Attacking {unit.CardName}…";
                    TryConfirmPendingAttack();
                    return;
                }
                if (unit == null)
                    CancelPendingPlayAction();
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            // Click any unit to inspect (friend or foe). Attack is via Attack button.
            if (unit != null)
            {
                _state.SelectedUnitId = unit.Id == _state.SelectedUnitId ? null : unit.Id;
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            if (!myTurn) return;

            var selected = SelectedUnit();
            if (selected == null)
            {
                RefreshHighlights();
                return;
            }

            // Empty hex: only your own units can move.
            if (selected.Seat == _state.ActiveSeat && TryMove(selected, tile.Coord))
            {
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            RefreshHighlights();
        }

        void HandleCleaveClick(HexTile tile)
        {
            var unit = UnitAt(tile.Coord);
            if (unit == null || !CleavePlanner.IsLegalTarget(_state, _state.PendingCleave, unit))
                return;
            if (CleavePlanner.TryAssign(_state.PendingCleave, unit.Id))
            {
                _state.LastActionLog =
                    $"Cleave: {CleavePlanner.AssignedTotal(_state.PendingCleave)}/{_state.PendingCleave.TotalDamage} assigned · leftover {CleavePlanner.Leftover(_state.PendingCleave)}";
                SelectionChanged?.Invoke();
            }
            RefreshHighlights();
        }

        void HandleDeployClick(HexTile tile)
        {
            var unit = UnitAt(tile.Coord);
            if (_state.SelectedUnitId == null)
            {
                if (unit != null && !OfflineDeploy.IsSeatReady(_state, unit.Seat))
                {
                    _state.SelectedUnitId = unit.Id;
                    RefreshHighlights();
                    SelectionChanged?.Invoke();
                    return;
                }

                // Empty hex: place next queue item (North / local).
                var seat = SeatId.N;
                if (OfflineDeploy.IsSeatReady(_state, seat)) return;
                var idx = OfflineDeploy.SelectedIndex(_state, seat);
                if (idx < 0)
                {
                    _state.LastActionLog =
                        "No Deploy companies left to place — assign some in Force Select, or confirm.";
                    SelectionChanged?.Invoke();
                    return;
                }
                var err = OfflineDeploy.TryPlace(_state, seat, idx, tile.Coord);
                if (err != null)
                {
                    _state.LastActionLog = err;
                    SelectionChanged?.Invoke();
                    return;
                }
                SyncTokensToState();
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            var selected = SelectedUnit();
            if (selected == null)
            {
                _state.SelectedUnitId = null;
                RefreshHighlights();
                return;
            }

            if (unit != null && unit.Seat == selected.Seat)
            {
                _state.SelectedUnitId = unit.Id == selected.Id ? null : unit.Id;
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            if (OfflineDeploy.TryReposition(_state, selected, tile.Coord))
            {
                SyncTokensToState();
                Debug.Log($"[CommandWarfare] Deploy: {selected.CardName} → ({tile.Coord.Col},{tile.Coord.Row})");
            }
            _state.SelectedUnitId = null;
            RefreshHighlights();
            SelectionChanged?.Invoke();
        }

        void EndTurnAfterAction()
        {
            if (IsNetworkMode)
            {
                _state.SelectedUnitId = null;
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }
            CheckVictory();
            if (_state.Phase == Phase.Ended) return;
            if (CombatFollowup.IsPendingTrampleValid(_state, out _) ||
                CombatFollowup.IsPendingCleaveValid(_state, out _))
                return;
            if (HasPendingFollowupAction(out var note))
            {
                if (!string.IsNullOrEmpty(note))
                {
                    _state.LastActionLog = note;
                    Debug.Log($"[CommandWarfare] {note}");
                }
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            // Auto-end only when this seat has nothing left (all companies/commander
            // already used for the round, and no move/attack/cast remaining).
            if (_state.ActiveSeat.HasValue &&
                TurnSystem.SeatCanActThisTurn(_state, _state.ActiveSeat.Value, _abilityDatabase))
            {
                RefreshHighlights();
                SelectionChanged?.Invoke();
                return;
            }

            EndTurn();
        }

        bool HasPendingFollowupAction(out string note)
        {
            note = null;
            if (_state?.Units == null || _state.ActiveSeat == null) return false;
            foreach (var u in _state.Units)
            {
                if (u.Seat != _state.ActiveSeat) continue;
                if (u.FrenzyAttackPending)
                {
                    note = $"Frenzy: {u.CardName} may attack again.";
                    return true;
                }
                if (u.HarassMovePending)
                {
                    note = $"Harass: {u.CardName} may Move 1.";
                    return true;
                }
            }
            return false;
        }

        bool TryMove(UnitToken unit, HexCoord dest)
        {
            if (IsNetworkMode)
            {
                if (!_network.TrySendMove(unit, dest.Col, dest.Row)) return false;
                Debug.Log($"[CommandWarfare] Sent move → ({dest.Col},{dest.Row})");
                return true;
            }
            if (!SkirmishActions.ExecuteMove(_state, unit, dest)) return false;
            SyncTokensToState();
            Debug.Log($"[CommandWarfare] {unit.CardName} → ({dest.Col},{dest.Row})");
            EndTurnAfterAction();
            return true;
        }

        bool TryAttack(UnitToken attacker, UnitToken defender)
        {
            if (IsNetworkMode)
            {
                if (!_network.TrySendAttack(attacker, defender)) return false;
                Debug.Log($"[CommandWarfare] Sent attack → {defender.CardName}");
                return true;
            }

            if (CleavePlanner.CanCleave(attacker, defender, _state))
            {
                _state.PendingCleave = CleavePlanner.Begin(attacker, defender);
                _state.LastActionLog =
                    $"Cleave: assign Damage among adjacent foes ({_state.PendingCleave.TotalDamage} total). Click targets, then Confirm.";
                Debug.Log($"[CommandWarfare] {_state.LastActionLog}");
                SelectionChanged?.Invoke();
                return false;
            }

            EnsureRng();
            if (!SkirmishActions.ExecuteAttack(_state, attacker, defender, _rng, _cardDatabase, out var log))
            {
                _state.LastActionLog = string.IsNullOrEmpty(log) ? "Attack failed." : log;
                Debug.LogWarning($"[CommandWarfare] {_state.LastActionLog}");
                return false;
            }
            _state.LastCombatLog = log;
            _state.LastActionLog = log;
            Debug.Log($"[CommandWarfare] {log}");
            SpawnCombatFx(defender, log);
            SyncTokensToState();
            EndTurnAfterAction();
            return true;
        }

        void TryActivateCommander(SeatId seat)
        {
            if (IsNetworkMode)
            {
                _network.TrySendActivateCommander();
                return;
            }
            var result = CommanderActivation.TryActivateCommander(_state, seat);
            if (result.Ok && result.Log != null)
            {
                _state.LastActionLog = result.Log;
                Debug.Log($"[CommandWarfare] {result.Log}");
            }
            else if (!result.Ok && result.Error != null)
            {
                _state.LastActionLog = result.Error;
                Debug.LogWarning($"[CommandWarfare] {result.Error}");
            }
        }

        void TryActivateCompanyFor(UnitToken unit)
        {
            if (unit.Kind == UnitKind.Commander) return;
            var officer = CompanyActivation.FindOfficerForUnit(_state, unit);
            if (officer == null) return;

            if (IsNetworkMode)
            {
                _network.TrySendActivateCompany(officer.Id);
                return;
            }

            var result = CompanyActivation.TryActivateCompany(_state, officer, _cardDatabase);
            if (result.Ok && result.Log != null)
            {
                _state.LastActionLog = result.Log;
                Debug.Log($"[CommandWarfare] {result.Log}");
            }
            else if (!result.Ok && result.Error != null)
            {
                _state.LastActionLog = result.Error;
                Debug.LogWarning($"[CommandWarfare] {result.Error}");
            }
        }

        /// <summary>HUD: activate the selected officer's company (once per round, one company per turn).</summary>
        public bool TryActivateSelectedCompany()
        {
            if (_state?.Phase != Phase.Play || !_state.ActiveSeat.HasValue) return false;
            if (IsNetworkMode && (_network == null || !_network.IsLocalSeat(_state.ActiveSeat.Value)))
                return false;

            var selected = SelectedUnit();
            if (selected == null || selected.Seat != _state.ActiveSeat) return false;

            var officer = selected.Kind == UnitKind.Officer
                ? selected
                : CompanyActivation.FindOfficerForUnit(_state, selected);
            if (officer == null || officer.Kind != UnitKind.Officer) return false;

            TryActivateCompanyFor(officer);
            var ok = _state.ActiveCompanyOfficerId == officer.Id;
            if (ok)
            {
                _state.SelectedUnitId = officer.Id;
                SyncTokensToState();
                RefreshHighlights();
                SelectionChanged?.Invoke();
            }
            return ok;
        }

        /// <summary>HUD: activate the local-seat commander (once per round; does not end company).</summary>
        public bool TryActivateSelectedCommander()
        {
            if (_state?.Phase != Phase.Play || !_state.ActiveSeat.HasValue) return false;
            if (IsNetworkMode && (_network == null || !_network.IsLocalSeat(_state.ActiveSeat.Value)))
                return false;

            var seat = _state.ActiveSeat.Value;
            var selected = SelectedUnit();
            if (selected == null || selected.Seat != seat || selected.Kind != UnitKind.Commander)
                return false;

            TryActivateCommander(seat);
            var ok = CommanderActivation.IsCommanderActivatedThisRound(_state, seat);
            if (ok)
            {
                SyncTokensToState();
                RefreshHighlights();
                SelectionChanged?.Invoke();
            }
            return ok;
        }

        public void EnsureCompanyActivatedForSeat(SeatId seat)
        {
            if (_state.ActiveCompanyOfficerId != null) return;
            foreach (var u in _state.Units)
            {
                if (u.Seat != seat || u.Kind != UnitKind.Officer) continue;
                if (_state.CompaniesActivatedThisRound.TryGetValue(u.Id, out var done) && done) continue;
                var result = CompanyActivation.TryActivateCompany(_state, u, _cardDatabase);
                if (result.Ok)
                {
                    if (result.Log != null) Debug.Log($"[CommandWarfare] {result.Log}");
                    return;
                }
            }
        }

        void SpawnCombatFx(UnitToken defender, string log)
        {
            var pos = TokenWorldPos(defender);
            CombatFx.SpawnFromCombatLog(pos, log);

            var lower = (log ?? "").ToLowerInvariant();
            var miss = lower.Contains("miss") && !lower.Contains("hit");
            if (miss) BattleAudio.PlayMiss();
            else
            {
                BattleAudio.PlayAttack();
                BattleAudio.PlayHit();
            }

            if (_views.TryGetValue(defender.Id, out var defView) && defView != null)
                defView.PlayHit();
            var attacker = SelectedUnit();
            if (attacker != null && _views.TryGetValue(attacker.Id, out var atkView) && atkView != null)
                atkView.PlayAttack();
        }

        public bool TryContinueTrample()
        {
            if (IsNetworkMode)
            {
                _network.TrySendContinueTrample();
                return true;
            }
            if (!CombatFollowup.ContinueTrample(_state, out var log)) return false;
            _state.LastCombatLog = log;
            SyncTokensToState();
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryDeclineTrample()
        {
            if (IsNetworkMode)
            {
                _network.TrySendDeclineTrample();
                return true;
            }
            if (!CombatFollowup.DeclineTrample(_state, out var log)) return false;
            _state.LastCombatLog = log;
            _state.LastActionLog = log;
            SyncTokensToState();
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        /// <summary>Revive a death-record unit onto an empty hex (owner's turn, Play phase).</summary>
        public bool TryReviveFromGrave(string deathId, HexCoord? dest = null, int toughness = 1)
        {
            if (_state == null || string.IsNullOrEmpty(deathId)) return false;
            if (IsNetworkMode)
            {
                return _network.TrySendReviveFromGrave(
                    deathId, dest?.Col, dest?.Row, toughness);
            }
            if (!_state.ActiveSeat.HasValue) return false;
            var err = UnitDestruction.ReviveFromGrave(
                _state, _state.ActiveSeat.Value, deathId, dest, toughness, _cardDatabase);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SyncTokensToState();
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryToggleFortifyAtSelected()
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            var unit = SelectedUnit();
            if (unit == null || unit.Seat != _state.ActiveSeat.Value) return false;
            if (IsNetworkMode)
                return _network.TrySendToggleFortifyHex(unit.Col, unit.Row);
            var err = FortifyHex.Toggle(
                _state, _state.ActiveSeat.Value, new HexCoord(unit.Col, unit.Row));
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryUndoMoveSelected()
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            var unit = SelectedUnit();
            if (unit == null || unit.Seat != _state.ActiveSeat.Value) return false;
            if (IsNetworkMode)
                return _network.TrySendUndoMove(unit.Id);
            var err = UndoMove.TryUndo(_state, _state.ActiveSeat.Value, unit.Id, _cardDatabase);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SyncTokensToState();
            RefreshHighlights();
            SelectionChanged?.Invoke();
            return true;
        }

        /// <summary>Spend commander AP/CC or company AP (play/shared spendPool).</summary>
        public bool TrySpendPool(string pool, int amount, string companyOfficerId = null)
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            if (IsNetworkMode)
                return _network.TrySendSpendPool(pool, amount, companyOfficerId);

            PoolSpending.SpendResult result;
            if (pool == "commanderAp")
                result = PoolSpending.TrySpendCommanderAp(_state, _state.ActiveSeat.Value, amount);
            else if (pool == "commanderCc")
                result = PoolSpending.TrySpendCommanderCc(_state, _state.ActiveSeat.Value, amount);
            else
                result = PoolSpending.TrySpendCompanyAp(
                    _state,
                    companyOfficerId ?? _state.ActiveCompanyOfficerId,
                    amount);

            if (!result.Ok)
            {
                _state.LastActionLog = result.Error;
                SelectionChanged?.Invoke();
                return false;
            }
            _state.LastActionLog = result.Log;
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryRollDice(int count = 1, int sides = 6, string note = null)
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            if (IsNetworkMode)
                return _network.TrySendRollDice(count, sides, note);
            EnsureRng();
            var err = GmActions.RollDice(_state, _state.ActiveSeat.Value, count, sides, note, _rng);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryApplyDamageSelected(int amount)
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            var unit = SelectedUnit();
            if (unit == null) return false;
            if (IsNetworkMode)
                return _network.TrySendApplyDamage(unit.Id, amount);
            var err = GmActions.ApplyDamage(_state, _state.ActiveSeat.Value, unit.Id, amount);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SyncTokensToState();
            SelectionChanged?.Invoke();
            return true;
        }

        public bool TryApplyHealSelected(int amount)
        {
            if (_state == null || _state.Phase != Phase.Play) return false;
            if (!_state.ActiveSeat.HasValue) return false;
            var unit = SelectedUnit();
            if (unit == null) return false;
            if (IsNetworkMode)
                return _network.TrySendApplyHeal(unit.Id, amount);
            var err = GmActions.ApplyHeal(_state, _state.ActiveSeat.Value, unit.Id, amount);
            if (err != null)
            {
                _state.LastActionLog = err;
                SelectionChanged?.Invoke();
                return false;
            }
            SyncTokensToState();
            SelectionChanged?.Invoke();
            return true;
        }

        UnitToken UnitAt(HexCoord coord) =>
            _state.Units.FirstOrDefault(u => u.Col == coord.Col && u.Row == coord.Row);
    }
}
