using CommandWarfare.Board;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Net
{
    /// <summary>
    /// Bridges PlaySocketClient ↔ BoardGameController for live multiplayer.
    /// Attach alongside both components on HexBoard. Disable SkirmishAi when using network mode.
    /// </summary>
    [RequireComponent(typeof(BoardGameController))]
    [RequireComponent(typeof(PlaySocketClient))]
    public class PlayNetworkBridge : MonoBehaviour
    {
        [SerializeField] bool _autoConnectOnStart;
        [SerializeField] bool _networkMode;

        BoardGameController _game;
        PlaySocketClient _socket;
        SkirmishAi _ai;

        public bool NetworkMode
        {
            get => _networkMode;
            set => _networkMode = value;
        }

        void Awake()
        {
            _game = GetComponent<BoardGameController>();
            _socket = GetComponent<PlaySocketClient>();
            _ai = GetComponent<SkirmishAi>();
        }

        void OnEnable()
        {
            _socket.OnWelcome += HandleWelcome;
            _socket.OnState += HandleState;
            _socket.OnError += HandleError;
            _socket.OnConnected += HandleConnected;
        }

        void OnDisable()
        {
            _socket.OnWelcome -= HandleWelcome;
            _socket.OnState -= HandleState;
            _socket.OnError -= HandleError;
            _socket.OnConnected -= HandleConnected;
        }

        void Start()
        {
            if (_networkMode && _ai != null)
                _ai.enabled = false;

            if (_autoConnectOnStart)
                _socket.Connect();
        }

        void HandleConnected()
        {
            if (_networkMode && _ai != null)
                _ai.enabled = false;
        }

        void HandleWelcome(PlayJson.WelcomeDto welcome)
        {
            ApplyServerState(welcome.state, _socket.LastStateJson);
            Debug.Log($"[PlayNetwork] Joined as {welcome.seat}");
        }

        void HandleState(PlayJson.GameStateDto dto, string rawJson)
        {
            ApplyServerState(dto, rawJson);
        }

        void HandleError(string message)
        {
            Debug.LogWarning($"[PlayNetwork] {message}");
        }

        void ApplyServerState(PlayJson.GameStateDto dto, string rawJson)
        {
            if (dto == null || _game.State == null) return;
            PlayStateApplier.Apply(_game.State, dto, rawJson);
            _game.ApplyNetworkStateRefresh();
        }

        /// <summary>Send move to server if it's our turn and we control the unit.</summary>
        public bool TrySendMove(UnitToken unit, int col, int row)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            if (_socket.LocalSeat == null || unit.Seat != _socket.LocalSeat) return false;
            _socket.SendMove(unit.Id, col, row);
            return true;
        }

        public bool TrySendAttack(UnitToken attacker, UnitToken defender)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            if (_socket.LocalSeat == null || attacker.Seat != _socket.LocalSeat) return false;
            _socket.SendResolveAttack(attacker.Id, defender.Id);
            return true;
        }

        public void TrySendEndTurn()
        {
            if (!_networkMode || !_socket.IsConnected) return;
            _socket.SendEndTurn();
        }

        public bool TrySendActivateCompany(string officerUnitId)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendActivateCompany(officerUnitId);
            return true;
        }

        public bool TrySendActivateCommander()
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendActivateCommander();
            return true;
        }

        public bool TrySendActivateEvade(string unitId)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendActivateEvade(unitId);
            return true;
        }

        public bool TrySendCastAbility(string casterUnitId, string abilityName, string targetUnitId = null)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendCastAbility(casterUnitId, abilityName, targetUnitId);
            return true;
        }

        public void TrySendContinueTrample()
        {
            if (!_networkMode || !_socket.IsConnected) return;
            _socket.SendContinueTrample();
        }

        public void TrySendDeclineTrample()
        {
            if (!_networkMode || !_socket.IsConnected) return;
            _socket.SendDeclineTrample();
        }

        public bool TrySendChooseCommandZoneMode(string mode)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendChooseCommandZoneMode(mode);
            return true;
        }

        public bool TrySendFloodCommandZone(string kind)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendFloodCommandZone(kind);
            return true;
        }

        public bool TrySendPickTerrain(string pieceId)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendPickTerrain(pieceId);
            return true;
        }

        public bool TrySendPlaceTerrain(int col, int row, int rotation = 0, int? handIndex = null, string pieceId = null)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendPlaceTerrain(col, row, rotation, handIndex, pieceId);
            return true;
        }

        public bool TrySendSkipTerrain()
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendSkipTerrain();
            return true;
        }

        public bool TrySendConfirmTerrain()
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendConfirmTerrain();
            return true;
        }

        public bool TrySendUndoMove(string unitId)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendUndoMove(unitId);
            return true;
        }

        public bool TrySendToggleFortifyHex(int col, int row)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendToggleFortifyHex(col, row);
            return true;
        }

        public bool TrySendReviveFromGrave(string deathId, int? col = null, int? row = null, int toughness = 1)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendReviveFromGrave(deathId, col, row, toughness);
            return true;
        }

        public bool TrySendSpendPool(string pool, int amount, string companyOfficerId = null)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendSpendPool(pool, amount, companyOfficerId);
            return true;
        }

        public bool TrySendRollDice(int count, int sides = 6, string note = null)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendRollDice(count, sides, note);
            return true;
        }

        public bool TrySendApplyDamage(string unitId, int amount)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendApplyDamage(unitId, amount);
            return true;
        }

        public bool TrySendApplyHeal(string unitId, int amount)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            _socket.SendApplyHeal(unitId, amount);
            return true;
        }

        public void TrySendSetupAdvance(Phase phase, QuickPickArmyLoader.PresetDto preset = null)
        {
            if (!_networkMode || !_socket.IsConnected) return;

            if (PlaySetupAutomator.TryGetNextStep(
                    _socket.LastStateJson,
                    _socket.LocalSeat ?? SeatId.N,
                    phase,
                    _game.State,
                    preset,
                    out var step))
            {
                _socket.SendRawAction(step.ActionJson);
                return;
            }

            switch (phase)
            {
                case Phase.Lobby:
                case Phase.ArmyBuild:
                case Phase.Commanders:
                case Phase.Objectives:
                case Phase.ForceSelect:
                    _socket.SendForceStart();
                    break;
                case Phase.Terrain:
                    _socket.SendConfirmTerrain();
                    break;
                case Phase.Deploy:
                    _socket.SendConfirmDeploy();
                    break;
            }
        }

        public bool TrySendQuickPickArmy(string submitArmyJson)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            if (string.IsNullOrWhiteSpace(submitArmyJson)) return false;
            _socket.SendRawAction(submitArmyJson);
            return true;
        }

        public bool TrySendConfirmForceSelect(string confirmForceSelectJson)
        {
            if (!_networkMode || !_socket.IsConnected) return false;
            if (string.IsNullOrWhiteSpace(confirmForceSelectJson)) return false;
            _socket.SendRawAction(confirmForceSelectJson);
            return true;
        }

        public bool IsLocalSeat(SeatId seat) =>
            _socket.LocalSeat.HasValue && _socket.LocalSeat.Value == seat;

        public SeatId? LocalSeat => _socket.LocalSeat;
    }
}
