using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;
using CommandWarfare.Net;
using System.Linq;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Connect/disconnect UI for live multiplayer against the Node play server.</summary>
    [RequireComponent(typeof(PlaySocketClient))]
    [RequireComponent(typeof(PlayNetworkBridge))]
    public class PlayNetworkHud : MonoBehaviour
    {
        [SerializeField] TextAsset _quickPickArmiesJson;
        [SerializeField] string _defaultRace = "Human";

        PlaySocketClient _socket;
        PlayNetworkBridge _bridge;
        BoardGameController _game;
        string _status = "Offline";
        string[] _races = System.Array.Empty<string>();
        int _raceIndex;
        int _presetIndex;
        QuickPickArmyLoader.PresetDto[] _racePresets = System.Array.Empty<QuickPickArmyLoader.PresetDto>();

        void Awake()
        {
            _socket = GetComponent<PlaySocketClient>();
            _bridge = GetComponent<PlayNetworkBridge>();
            _game = GetComponent<BoardGameController>();
            RefreshRaceList();
        }

        void OnEnable()
        {
            _socket.OnConnected += () => _status = "Connected";
            _socket.OnDisconnected += () => _status = "Disconnected";
            _socket.OnWelcome += w => _status = $"Joined {w.seat} · {w.state?.roomCode} · {w.state?.phase}";
            _socket.OnState += (dto, _) => _status = $"Room {dto?.roomCode} · {dto?.phase} · R{dto?.round}";
            _socket.OnError += e => _status = $"Error: {e}";
        }

        void RefreshRaceList()
        {
            _races = _quickPickArmiesJson != null
                ? QuickPickArmyLoader.DistinctRaces(_quickPickArmiesJson)
                : System.Array.Empty<string>();

            if (_races.Length == 0)
                _races = GameSessionFactory.PlayableRaces;

            _raceIndex = 0;
            for (var i = 0; i < _races.Length; i++)
            {
                if (string.Equals(_races[i], _defaultRace, System.StringComparison.OrdinalIgnoreCase))
                {
                    _raceIndex = i;
                    break;
                }
            }
            RefreshPresetsForRace();
        }

        void RefreshPresetsForRace()
        {
            if (_quickPickArmiesJson == null || _races.Length == 0)
            {
                _racePresets = System.Array.Empty<QuickPickArmyLoader.PresetDto>();
                _presetIndex = 0;
                return;
            }

            var race = _races[Mathf.Clamp(_raceIndex, 0, _races.Length - 1)];
            _racePresets = QuickPickArmyLoader.PresetsForRace(_quickPickArmiesJson, race).ToArray();
            if (_presetIndex >= _racePresets.Length) _presetIndex = 0;
        }

        QuickPickArmyLoader.PresetDto CurrentPreset =>
            _racePresets.Length > 0 ? _racePresets[Mathf.Clamp(_presetIndex, 0, _racePresets.Length - 1)] : null;

        void OnGUI()
        {
            var flow = GetComponent<CommandWarfare.UI.GameFlowController>();
            if (flow != null && !flow.IsInMatch) return;

            const float w = 300f;
            var phase = _game?.State?.Phase ?? Phase.Lobby;
            var setupPhase = phase is Phase.Lobby or Phase.ArmyBuild or Phase.Commanders
                or Phase.Objectives or Phase.ForceSelect or Phase.Terrain or Phase.Deploy;
            var armyPhase = phase is Phase.Lobby or Phase.ArmyBuild;
            var forcePhase = phase is Phase.ForceSelect;

            var h = 210f;
            if (!_socket.IsConnected) h = 160f;
            else if (armyPhase && _racePresets.Length > 0) h += 118f;
            else if (armyPhase && _quickPickArmiesJson == null) h += 48f;
            else if (forcePhase && CurrentPreset != null) h += 34f;
            else if (setupPhase) h += 34f;

            GUI.BeginGroup(new Rect(Screen.width - w - 12, 12, w, h));
            GUI.Box(new Rect(0, 0, w, h), "Multiplayer");

            GUI.Label(new Rect(8, 24, w - 16, 36), _status);
            GUI.Label(new Rect(8, 58, w - 16, 20), _socket.WebSocketUrl);

            var y = 82f;
            if (!_socket.IsConnected)
            {
                if (GUI.Button(new Rect(8, y, w - 16, 28), "Connect (create vs AI)"))
                {
                    if (_quickPickArmiesJson == null)
                        RefreshRaceList();
                    _bridge.NetworkMode = true;
                    _socket.Connect();
                }
            }
            else
            {
                if (GUI.Button(new Rect(8, y, w - 16, 28), "Disconnect"))
                    _socket.Disconnect();
                y += 34;

                GUI.Label(new Rect(8, y, w - 16, 20), $"Phase: {phase}");
                y += 22;

                if (armyPhase && _racePresets.Length > 0)
                {
                    if (_races.Length > 0)
                    {
                        var raceLabel = _races[Mathf.Clamp(_raceIndex, 0, _races.Length - 1)];
                        if (GUI.Button(new Rect(8, y, 72, 24), $"Race: {raceLabel}"))
                        {
                            _raceIndex = (_raceIndex + 1) % _races.Length;
                            RefreshPresetsForRace();
                        }
                    }

                    var preset = CurrentPreset;
                    if (preset != null && GUI.Button(new Rect(86, y, w - 94, 24), "Next army"))
                        _presetIndex = (_presetIndex + 1) % _racePresets.Length;
                    y += 28;

                    if (preset != null)
                    {
                        GUI.Label(new Rect(8, y, w - 16, 36),
                            $"{preset.commanderName}\n{preset.companyCount} co · {preset.totalUv} UV");
                        y += 38;

                        if (GUI.Button(new Rect(8, y, w - 16, 28), "Submit quick-pick army"))
                            _bridge.TrySendQuickPickArmy(preset.submitArmyJson);
                        y += 34;
                    }
                }
                else if (armyPhase)
                {
                    GUI.Label(new Rect(8, y, w - 16, 40),
                        _quickPickArmiesJson == null
                            ? "Missing quick-pick JSON.\nRun: npm run export:unity:armies"
                            : "No presets for this race.");
                    y += 44;
                }
                else if (forcePhase && CurrentPreset != null)
                {
                    if (GUI.Button(new Rect(8, y, w - 16, 28), "Confirm force (default loadout)"))
                        _bridge.TrySendConfirmForceSelect(CurrentPreset.confirmForceSelectJson);
                    y += 34;
                }

                if (setupPhase && phase != Phase.Play && phase != Phase.Ended)
                {
                    var preset = CurrentPreset;
                    var stepLabel = PlaySetupAutomator.TryGetNextStep(
                        _socket.LastStateJson,
                        _socket.LocalSeat ?? SeatId.N,
                        phase,
                        _game?.State,
                        preset,
                        out var step)
                        ? step.Label
                        : "Advance setup";

                    if (GUI.Button(new Rect(8, y, w - 16, 28), stepLabel))
                        _bridge.TrySendSetupAdvance(phase, preset);
                    y += 34;
                }

                if (_socket.LocalSeat.HasValue)
                    GUI.Label(new Rect(8, y, w - 16, 20), $"Seat: {_socket.LocalSeat}");
            }

            GUI.EndGroup();
        }
    }
}
