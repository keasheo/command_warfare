using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Net
{
    /// <summary>
    /// WebSocket client for the Node play server (play/shared/types.ts protocol).
    /// Uses System.Net.WebSockets — works in Unity Editor / standalone builds.
    /// </summary>
    public class PlaySocketClient : MonoBehaviour
    {
        [SerializeField] string _host = "127.0.0.1";
        [SerializeField] int _port = 8788;
        [SerializeField] string _wsPath = "/ws";
        [SerializeField] string _playerName = "Unity Player";
        [SerializeField] bool _createRoomOnConnect = true;
        [SerializeField] string _roomCode = "unity-dev";
        [SerializeField] bool _vsAi = true;
        [SerializeField] bool _randomMap = true;
        [SerializeField] int _deployMax = 110;
        [SerializeField] int _reserveMax = 60;

        ClientWebSocket _socket;
        CancellationTokenSource _cts;
        readonly ConcurrentQueue<Action> _mainThread = new();
        string _sessionToken;

        public bool IsConnected { get; private set; }
        public SeatId? LocalSeat { get; private set; }
        public string SessionToken => _sessionToken;
        public string LastStateJson { get; private set; }

        public event Action OnConnected;
        public event Action OnDisconnected;
        public event Action<string> OnError;
        public event Action<PlayJson.WelcomeDto> OnWelcome;
        public event Action<PlayJson.GameStateDto, string> OnState;
        public event Action<string> OnRawMessage;

        public string WebSocketUrl => $"ws://{_host}:{_port}{_wsPath}";

        void Update()
        {
            PumpMainThread();
        }

        /// <summary>Drain queued socket callbacks (also used by edit-mode smoke).</summary>
        public void PumpMainThread()
        {
            while (_mainThread.TryDequeue(out var action))
                action();
        }

        void OnDestroy() => Disconnect();

        public void ConfigureEndpoint(string host, int port = 8788, string wsPath = "/ws")
        {
            _host = host;
            _port = port;
            _wsPath = string.IsNullOrEmpty(wsPath) ? "/ws" : wsPath;
        }

        public void ConfigureSession(
            string playerName,
            bool createRoom = true,
            bool vsAi = true,
            bool randomMap = true,
            string roomCode = null,
            int deployMax = 110,
            int reserveMax = 60)
        {
            _playerName = string.IsNullOrEmpty(playerName) ? _playerName : playerName;
            _createRoomOnConnect = createRoom;
            _vsAi = vsAi;
            _randomMap = randomMap;
            _deployMax = deployMax;
            _reserveMax = reserveMax;
            if (!string.IsNullOrEmpty(roomCode))
                _roomCode = roomCode;
        }

        public void Connect()
        {
            if (IsConnected) return;
            _ = ConnectAsync();
        }

        public void Disconnect()
        {
            _cts?.Cancel();
            _cts = null;
            if (_socket != null)
            {
                try
                {
                    if (_socket.State == WebSocketState.Open)
                        _ = _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
                }
                catch { /* ignore */ }
                _socket.Dispose();
                _socket = null;
            }
            SetConnected(false);
        }

        async Task ConnectAsync()
        {
            try
            {
                _socket = new ClientWebSocket();
                _cts = new CancellationTokenSource();
                var uri = new Uri(WebSocketUrl);
                // ConfigureAwait(false): edit-mode / MCP smokes do not pump Unity's sync context.
                await _socket.ConnectAsync(uri, _cts.Token).ConfigureAwait(false);

                EnqueueMain(() =>
                {
                    SetConnected(true);
                    OnConnected?.Invoke();
                    Debug.Log($"[PlaySocket] Connected → {WebSocketUrl}");
                });

                if (_createRoomOnConnect)
                    await SendRawAsync(PlayJson.BuildCreate(_playerName, _vsAi, _randomMap, _deployMax, _reserveMax))
                        .ConfigureAwait(false);
                else
                    await SendRawAsync(PlayJson.BuildJoin(_roomCode, _playerName, _sessionToken)).ConfigureAwait(false);

                _ = ReceiveLoopAsync(_cts.Token);
            }
            catch (Exception ex)
            {
                EnqueueMain(() =>
                {
                    Debug.LogError($"[PlaySocket] Connect failed: {ex.Message}");
                    OnError?.Invoke(ex.Message);
                    SetConnected(false);
                });
            }
        }

        async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[8192];
            var builder = new StringBuilder();

            try
            {
                while (!token.IsCancellationRequested && _socket?.State == WebSocketState.Open)
                {
                    builder.Clear();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            EnqueueMain(() =>
                            {
                                Debug.Log("[PlaySocket] Server closed connection.");
                                Disconnect();
                            });
                            return;
                        }
                        builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    } while (!result.EndOfMessage);

                    var json = builder.ToString();
                    EnqueueMain(() => HandleIncoming(json));
                }
            }
            catch (OperationCanceledException)
            {
                // expected on disconnect
            }
            catch (Exception ex)
            {
                EnqueueMain(() =>
                {
                    Debug.LogWarning($"[PlaySocket] Receive ended: {ex.Message}");
                    OnError?.Invoke(ex.Message);
                    Disconnect();
                });
            }
        }

        void HandleIncoming(string json)
        {
            OnRawMessage?.Invoke(json);

            if (PlayJson.TryParseError(json, out var errMsg))
            {
                Debug.LogWarning($"[PlaySocket] Error: {errMsg}");
                OnError?.Invoke(errMsg);
                return;
            }

            if (PlayJson.TryParseWelcome(json, out var welcome))
            {
                _sessionToken = welcome.token;
                LocalSeat = ParseSeat(welcome.seat);
                LastStateJson = json;
                Debug.Log($"[PlaySocket] Welcome seat={welcome.seat} room={welcome.state?.roomCode}");
                OnWelcome?.Invoke(welcome);
                OnState?.Invoke(welcome.state, json);
                return;
            }

            if (PlayJson.TryParseState(json, out var state))
            {
                LastStateJson = json;
                OnState?.Invoke(state, json);
            }
        }

        public void SendAction(string actionJson) => _ = SendRawAsync(actionJson);

        public void SendMove(string unitId, int col, int row) =>
            SendAction(PlayJson.BuildMove(unitId, col, row));

        public void SendEndTurn() => SendAction(PlayJson.BuildEndTurn());

        public void SendResolveAttack(string attackerId, string defenderId) =>
            SendAction(PlayJson.BuildResolveAttack(attackerId, defenderId));

        public void SendActivateCompany(string officerUnitId) =>
            SendAction(PlayJson.BuildActivateCompany(officerUnitId));

        public void SendActivateCommander() =>
            SendAction(PlayJson.BuildActivateCommander());

        public void SendActivateEvade(string unitId) =>
            SendAction(PlayJson.BuildActivateEvade(unitId));

        public void SendCastAbility(string casterUnitId, string abilityName, string targetUnitId = null) =>
            SendAction(PlayJson.BuildCastAbility(casterUnitId, abilityName, targetUnitId));

        public void SendForceStart() => SendAction(PlayJson.BuildForceStart());
        public void SendConfirmTerrain() => SendAction(PlayJson.BuildConfirmTerrain());
        public void SendSkipTerrain() => SendAction(PlayJson.BuildSkipTerrain());
        public void SendConfirmDeploy() => SendAction(PlayJson.BuildConfirmDeploy());
        public void SendContinueTrample() => SendAction(PlayJson.BuildContinueTrample());
        public void SendDeclineTrample() => SendAction(PlayJson.BuildDeclineTrample());

        public void SendChooseCommandZoneMode(string mode) =>
            SendAction(PlayJson.BuildChooseCommandZoneMode(mode));
        public void SendFloodCommandZone(string kind) =>
            SendAction(PlayJson.BuildFloodCommandZone(kind));
        public void SendPickTerrain(string pieceId) =>
            SendAction(PlayJson.BuildPickTerrain(pieceId));
        public void SendUnpickTerrain(int handIndex) =>
            SendAction(PlayJson.BuildUnpickTerrain(handIndex));
        public void SendPlaceTerrain(int col, int row, int rotation = 0, int? handIndex = null, string pieceId = null) =>
            SendAction(PlayJson.BuildPlaceTerrain(col, row, rotation, handIndex, pieceId));
        public void SendUndoMove(string unitId) =>
            SendAction(PlayJson.BuildUndoMove(unitId));
        public void SendToggleFortifyHex(int col, int row) =>
            SendAction(PlayJson.BuildToggleFortifyHex(col, row));
        public void SendReviveFromGrave(string deathId, int? col = null, int? row = null, int toughness = 1) =>
            SendAction(PlayJson.BuildReviveFromGrave(deathId, col, row, toughness));

        public void SendSpendPool(string pool, int amount, string companyOfficerId = null) =>
            SendAction(PlayJson.BuildSpendPool(pool, amount, companyOfficerId));

        public void SendRollDice(int count, int sides = 6, string note = null) =>
            SendAction(PlayJson.BuildRollDice(count, sides, note));

        public void SendApplyDamage(string unitId, int amount) =>
            SendAction(PlayJson.BuildApplyDamage(unitId, amount));

        public void SendApplyHeal(string unitId, int amount) =>
            SendAction(PlayJson.BuildApplyHeal(unitId, amount));

        /// <summary>Send a pre-built action JSON (e.g. from quick-pick export).</summary>
        public void SendRawAction(string actionJson) => SendAction(actionJson);

        async Task SendRawAsync(string json)
        {
            if (_socket == null || _socket.State != WebSocketState.Open)
            {
                Debug.LogWarning("[PlaySocket] Not connected.");
                return;
            }
            try
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                EnqueueMain(() => OnError?.Invoke(ex.Message));
            }
        }

        void SetConnected(bool connected)
        {
            IsConnected = connected;
            if (!connected)
            {
                OnDisconnected?.Invoke();
            }
        }

        void EnqueueMain(Action action) => _mainThread.Enqueue(action);

        static SeatId? ParseSeat(string seat) => seat switch
        {
            "N" => SeatId.N,
            "S" => SeatId.S,
            "E" => SeatId.E,
            "W" => SeatId.W,
            _ => null,
        };
    }
}
