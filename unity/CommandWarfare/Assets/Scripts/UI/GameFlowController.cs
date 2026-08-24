using System.Collections.Generic;
using CommandWarfare.Board;
using CommandWarfare.Core;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;
using CommandWarfare.Net;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Full play-client shell (replaces web prototype lobby):
    /// Title → Match setup (UV + terrain) → Army builder → Match.
    /// </summary>
    public class GameFlowController : MonoBehaviour
    {
        static readonly string[] RaceFilters =
        {
            "All", "Human", "Dwarf", "Elf", "Undead", "Demon", "Dragon",
            "Beastfolk", "Lizardman", "Construct", "Siege",
        };

        static readonly string[] TypeFilters = { "All", "Commander", "Officer", "Unit" };

        [SerializeField] TextAsset _rulebookJson;
        [SerializeField] TextAsset _quickPickArmiesJson;
        [SerializeField] UnitAssetCatalog _unitCatalog;
        [SerializeField] string _defaultAiRace = "Dwarf";

        GameMenuScreen _screen = GameMenuScreen.Title;
        ArmyBuilderMode _armyMode = ArmyBuilderMode.Workshop;
        MatchSetupKind _setupKind = MatchSetupKind.Skirmish;
        DemoArmy _draft = new();
        CardDefinition _previewCard;
        string _status = "";
        string _roomCodeInput = "";
        string _hostName = "Host";
        string _joinName = "Guest";
        string _joinHost = "127.0.0.1";
        bool _hostStarting;
        bool _hostVsAi = true;
        bool _randomMap = true;
        int _deployUvMax = GameConstants.DeployUvMax;
        int _reserveUvMax = GameConstants.ReserveUvMax;
        Vector2 _ruleScroll;
        Vector2 _armyPickerScroll;
        Vector2 _armyRosterScroll;
        Vector2 _raceScroll;
        string _cardFilter = "";
        string _typeFilter = "All";
        string _raceFilter = "All";
        int _selectedCompany;
        string _saveName = "My Army";
        bool _raceDropOpen;
        bool _typeDropOpen;
        List<ArmyListUtil.SavedArmyEntry> _saved = new();
        List<(RulebookLoader.Section section, int depth)> _ruleFlat = new();
        int _ruleSelected;
        MenuBackdrop3D _backdrop;
        BoardGameController _game;
        HexBoardBuilder _board;
        SkirmishHud _skirmishHud;
        PlayNetworkHud _netHud;
        PlaySocketClient _socket;
        PlayNetworkBridge _bridge;
        SkirmishAi _ai;

        public GameMenuScreen CurrentScreen => _screen;
        public bool IsInMatch => _screen == GameMenuScreen.Match;

        void Awake()
        {
            _game = GetComponent<BoardGameController>();
            _board = GetComponent<HexBoardBuilder>();
            _skirmishHud = GetComponent<SkirmishHud>();
            _netHud = GetComponent<PlayNetworkHud>();
            _socket = GetComponent<PlaySocketClient>();
            _bridge = GetComponent<PlayNetworkBridge>();
            _ai = GetComponent<SkirmishAi>();
            _backdrop = GetComponent<MenuBackdrop3D>();
            if (_backdrop == null) _backdrop = gameObject.AddComponent<MenuBackdrop3D>();
            if (_unitCatalog != null) _backdrop.SetCatalog(_unitCatalog);
            _saved = ArmyListUtil.LoadSaved();
            LoadRulebook();
        }

        void Start()
        {
            EnsureRefs();
            if (GameSceneRouter.IsBattleScene)
            {
                if (MatchLaunchContext.PendingBattleStart)
                    ApplyPendingBattleLaunch();
                else if (_screen != GameMenuScreen.Match)
                    EnterMatch();
                return;
            }

            if (GameSceneRouter.IsArmyBuilderScene)
            {
                _deployUvMax = MatchLaunchContext.DeployUvMax;
                _reserveUvMax = MatchLaunchContext.ReserveUvMax;
                _randomMap = MatchLaunchContext.RandomMap;
                _setupKind = MatchLaunchContext.SetupKind;
                _defaultAiRace = MatchLaunchContext.DefaultAiRace ?? _defaultAiRace;
                if (MatchLaunchContext.DraftArmy != null)
                    _draft = MatchLaunchContext.DraftArmy;
                EnterArmyBuilder(MatchLaunchContext.ArmyMode);
                return;
            }

            if (_screen != GameMenuScreen.Match)
            {
                if (MatchLaunchContext.OpenMatchSetupOnMenu)
                {
                    MatchLaunchContext.OpenMatchSetupOnMenu = false;
                    _deployUvMax = MatchLaunchContext.DeployUvMax;
                    _reserveUvMax = MatchLaunchContext.ReserveUvMax;
                    _randomMap = MatchLaunchContext.RandomMap;
                    EnterMatchSetup(MatchLaunchContext.SetupKind);
                }
                else
                    EnterTitle();
            }
        }

        void OnEnable()
        {
            if (_socket == null) return;
            _socket.OnWelcome += OnWelcome;
            _socket.OnError += e => _status = e ?? "Socket error";
            _socket.OnDisconnected += () =>
            {
                if (_screen == GameMenuScreen.MultiplayerLobby)
                    _status = "Disconnected";
            };
        }

        void OnDisable()
        {
            if (_socket == null) return;
            _socket.OnWelcome -= OnWelcome;
        }

        public void EnterTitle()
        {
            if (!GameSceneRouter.IsMainMenuScene &&
                Application.CanStreamedLevelBeLoaded(GameSceneIds.MainMenu))
            {
                GameSceneRouter.LoadMainMenu();
                return;
            }

            _screen = GameMenuScreen.Title;
            _status = "";
            ApplyMenuVisuals();
            if (_bridge != null) _bridge.NetworkMode = false;
            if (_socket != null && _socket.IsConnected) _socket.Disconnect();
        }

        public void ReturnToMainMenu() => EnterTitle();

        public void EnterMatchSetup(MatchSetupKind kind)
        {
            _setupKind = kind;
            _screen = GameMenuScreen.MatchSetup;
            _deployUvMax = GameConstants.DeployUvMax;
            _reserveUvMax = GameConstants.ReserveUvMax;
            _randomMap = true;
            EnsureRefs();
            if (kind == MatchSetupKind.Skirmish && (_bridge == null || !_bridge.NetworkMode))
                _game?.AssignNewRoomSeed();
            ApplyMenuVisuals();
        }

        public void EnterArmyBuilder(ArmyBuilderMode mode)
        {
            MatchLaunchContext.PrepareArmyBuilder(
                mode, _setupKind, _deployUvMax, _reserveUvMax, _randomMap, _defaultAiRace, _draft);

            if (!GameSceneRouter.IsArmyBuilderScene &&
                Application.CanStreamedLevelBeLoaded(GameSceneIds.ArmyBuilder))
            {
                GameSceneRouter.LoadArmyBuilder();
                return;
            }

            _armyMode = mode;
            _screen = GameMenuScreen.ArmyBuilder;
            ApplyMenuVisuals();
            if (_draft == null) _draft = new DemoArmy();
            // Do not auto-fill a demo army — start empty so the full card pool is the focus.
            if (_draft.Commander == null && (_draft.Companies == null || _draft.Companies.Count == 0))
            {
                _typeFilter = "Unit";
                _raceFilter = "All";
            }
        }

        public void EnterRulebook()
        {
            _screen = GameMenuScreen.Rulebook;
            ApplyMenuVisuals();
            LoadRulebook();
        }

        public void EnterMultiplayerLobby()
        {
            _screen = GameMenuScreen.MultiplayerLobby;
            _status = "Host after match setup, or join with a room code.";
            ApplyMenuVisuals();
        }

        public void EnterMatch()
        {
            _screen = GameMenuScreen.Match;
            ApplyMatchVisuals();
        }

        void ApplyMenuVisuals()
        {
            EnsureRefs();
            if (_skirmishHud != null) _skirmishHud.enabled = false;
            if (_netHud != null) _netHud.enabled = false;
            if (_ai != null) _ai.enabled = false;
            _game?.SetBattlefieldVisible(false);
            BattleTabletopEnvironment.DestroyExisting();
            _backdrop?.Show();
        }

        void ApplyMatchVisuals()
        {
            EnsureRefs();
            if (_skirmishHud != null) _skirmishHud.enabled = true;
            if (_netHud != null) _netHud.enabled = false;
            if (_ai != null && _bridge != null && !_bridge.NetworkMode)
                _ai.enabled = true;
            _backdrop?.Hide();
            MenuBackdrop3D.ForceCleanupScene();
            if (_board != null && (_game?.State?.Terrain == null || _game.State.Terrain.Count == 0))
            {
                if (!string.IsNullOrEmpty(_game?.State?.RoomCode))
                    _game.SyncRoomSeed(_game.State.RoomCode);
                _board.Rebuild();
            }
            else if (_game?.State?.Terrain != null && _game.State.Terrain.Count > 0)
            {
                if (!string.IsNullOrEmpty(_game.State.RoomCode))
                    _game.SyncRoomSeed(_game.State.RoomCode);
                _board?.Rebuild(_game.State.Terrain);
            }
            _game?.SetBattlefieldVisible(true);
            _game?.RebuildTokenViews();
            _game?.RefreshBattlefieldOverlays();
            _game?.FrameCameraOnBoard();
            // Second cleanup after rebuild — catch orphans recreated by editor leftovers.
            MenuBackdrop3D.ForceCleanupScene();
            // Room again after cleanup: menu orphan pass matches names like "Banner".
            if (_board != null)
                BattleTabletopEnvironment.Ensure(_board.BoardSize, _board.HexSize);
        }

        void EnsureRefs()
        {
            if (_game == null) _game = GetComponent<BoardGameController>();
            if (_board == null) _board = GetComponent<HexBoardBuilder>();
            if (_skirmishHud == null) _skirmishHud = GetComponent<SkirmishHud>();
            if (_netHud == null) _netHud = GetComponent<PlayNetworkHud>();
            if (_socket == null) _socket = GetComponent<PlaySocketClient>();
            if (_bridge == null) _bridge = GetComponent<PlayNetworkBridge>();
            if (_ai == null) _ai = GetComponent<SkirmishAi>();
            if (_backdrop == null) _backdrop = GetComponent<MenuBackdrop3D>();
            if (_backdrop == null) _backdrop = gameObject.AddComponent<MenuBackdrop3D>();
        }

        void LoadRulebook()
        {
            _ruleFlat.Clear();
            var root = RulebookLoader.Load(_rulebookJson);
            if (root?.sections != null)
                RulebookLoader.Flatten(root.sections, _ruleFlat);
            _ruleSelected = 0;
        }

        void OnWelcome(PlayJson.WelcomeDto welcome)
        {
            _status = $"Joined seat {welcome?.seat} · room {welcome?.state?.roomCode} · {welcome?.state?.phase}";
            if (_screen is GameMenuScreen.MultiplayerLobby or GameMenuScreen.MatchSetup)
                EnterArmyBuilder(ArmyBuilderMode.NetworkSubmit);
        }

        void OnDestroy()
        {
            PlayServerHost.StopOwned();
        }

        void OnApplicationQuit()
        {
            PlayServerHost.StopOwned();
        }

        void OnGUI()
        {
            if (_screen == GameMenuScreen.Match) return;
            MenuStyle.Ensure();
            MenuBackdropGui.Draw();
            switch (_screen)
            {
                case GameMenuScreen.Title: DrawTitle(); break;
                case GameMenuScreen.MatchSetup: DrawMatchSetup(); break;
                case GameMenuScreen.ArmyBuilder: DrawArmyBuilder(); break;
                case GameMenuScreen.Rulebook: DrawRulebook(); break;
                case GameMenuScreen.MultiplayerLobby: DrawMultiplayer(); break;
            }
        }

        void DrawTitle()
        {
            var w = Mathf.Min(520f, UnityEngine.Screen.width - 40f);
            var h = 440f;
            var rect = new Rect((UnityEngine.Screen.width - w) * 0.5f, (UnityEngine.Screen.height - h) * 0.5f, w, h);
            MenuStyle.DrawPanel(rect);

            GUI.Label(new Rect(rect.x, rect.y + 36, rect.width, 56), "COMMAND WARFARE", MenuStyle.Title);
            GUI.Label(new Rect(rect.x + 40, rect.y + 96, rect.width - 80, 48),
                "The full tabletop client — build armies, place terrain, command the field.",
                MenuStyle.Subtitle);

            var y = rect.y + 160f;
            var bw = rect.width - 80f;
            var bx = rect.x + 40f;
            if (MenuStyle.PrimaryBtn(new Rect(bx, y, bw, 44), "1 Player  ·  vs AI"))
                EnterMatchSetup(MatchSetupKind.Skirmish);
            y += 56;
            if (MenuStyle.Btn(new Rect(bx, y, bw, 40), "Multiplayer  ·  Host / Join"))
                EnterMultiplayerLobby();
            y += 52;
            if (MenuStyle.Btn(new Rect(bx, y, bw * 0.48f, 36), "Army Workshop"))
                EnterArmyBuilder(ArmyBuilderMode.Workshop);
            if (MenuStyle.Btn(new Rect(bx + bw * 0.52f, y, bw * 0.48f, 36), "Rulebook"))
                EnterRulebook();
            y += 52;
            GUI.Label(new Rect(bx, y, bw, 40),
                "Card data + art import from the shared database. A separate builder app can update that DB later.",
                MenuStyle.MutedLabel);
        }

        void DrawMatchSetup()
        {
            var w = Mathf.Min(560f, UnityEngine.Screen.width - 40f);
            var h = 460f;
            var rect = new Rect((UnityEngine.Screen.width - w) * 0.5f, (UnityEngine.Screen.height - h) * 0.5f, w, h);
            var title = _setupKind == MatchSetupKind.Host ? "Host match setup" : "Skirmish setup";
            MenuStyle.DrawPanel(rect, title);

            var x = rect.x + 28f;
            var y = rect.y + 48f;
            var bw = rect.width - 56f;

            GUI.Label(new Rect(x, y, bw, 22), "Battle UV capacity (Force Select pools)", MenuStyle.Body);
            y += 28;
            GUI.Label(new Rect(x, y, 160, 22), $"Deploy max UV: {_deployUvMax}", MenuStyle.MutedLabel);
            _deployUvMax = Mathf.RoundToInt(GUI.HorizontalSlider(
                new Rect(x + 170, y + 4, bw - 170, 18), _deployUvMax, 40, 220));
            y += 28;
            GUI.Label(new Rect(x, y, 160, 22), $"Reserve max UV: {_reserveUvMax}", MenuStyle.MutedLabel);
            _reserveUvMax = Mathf.RoundToInt(GUI.HorizontalSlider(
                new Rect(x + 170, y + 4, bw - 170, 18), _reserveUvMax, 0, 120));
            y += 28;
            GUI.Label(new Rect(x, y, bw, 20),
                $"List max remains {GameConstants.ArmyUvMax} UV. Defaults {_deployUvMax}/{_reserveUvMax}.",
                MenuStyle.MutedLabel);
            y += 36;

            GUI.Label(new Rect(x, y, bw, 22), "Battlefield", MenuStyle.Body);
            y += 26;
            if (GUI.Toggle(new Rect(x, y, bw, 24), _randomMap, "  Generate battlefield from deploy armies (2p 30%+40% random, shared terrain penalized)"))
                _randomMap = true;
            y += 28;
            if (GUI.Toggle(new Rect(x, y, bw, 24), !_randomMap, "  Place terrain manually (command zone + land drops)"))
                _randomMap = false;
            y += 40;

            if (_setupKind == MatchSetupKind.Host)
            {
                GUI.Label(new Rect(x, y, 100, 22), "Host name", MenuStyle.MutedLabel);
                _hostName = GUI.TextField(new Rect(x + 100, y, 200, 24), _hostName);
                y += 28;
                _hostVsAi = GUI.Toggle(new Rect(x, y, bw, 22), _hostVsAi, " Opponent: AI");
                y += 36;
                if (MenuStyle.PrimaryBtn(new Rect(x, y, bw, 40), "Continue — build army & host"))
                {
                    HostRoomWithSetup();
                }
            }
            else
            {
                if (MenuStyle.PrimaryBtn(new Rect(x, y, bw, 40), "Continue — build army"))
                    EnterArmyBuilder(ArmyBuilderMode.StartSkirmish);
            }

            y += 52;
            if (MenuStyle.Btn(new Rect(x, y, 140, 32), "Back"))
            {
                if (_setupKind == MatchSetupKind.Host) EnterMultiplayerLobby();
                else EnterTitle();
            }
        }

        void DrawMultiplayer()
        {
            var w = Mathf.Min(560f, UnityEngine.Screen.width - 40f);
            var h = 440f;
            var rect = new Rect((UnityEngine.Screen.width - w) * 0.5f, (UnityEngine.Screen.height - h) * 0.5f, w, h);
            MenuStyle.DrawPanel(rect, "Multiplayer");

            var x = rect.x + 24f;
            var y = rect.y + 48f;
            var bw = rect.width - 48f;
            GUI.Label(new Rect(x, y, bw, 48), _status, MenuStyle.Body);
            y += 52;

            GUI.Label(new Rect(x, y, bw, 36),
                "Host starts a local play server automatically (no .bat). Guests join with your LAN IP + room code.",
                MenuStyle.MutedLabel);
            y += 40;

            GUI.enabled = !_hostStarting;
            if (MenuStyle.PrimaryBtn(new Rect(x, y, bw, 40),
                    _hostStarting ? "Starting local server…" : "Host room…"))
                EnterMatchSetup(MatchSetupKind.Host);
            GUI.enabled = true;
            y += 56;

            GUI.Label(new Rect(x, y, bw, 22), "Join an existing host", MenuStyle.MutedLabel);
            y += 26;
            GUI.Label(new Rect(x, y, 100, 22), "Host IP", MenuStyle.MutedLabel);
            _joinHost = GUI.TextField(new Rect(x + 100, y, 200, 24), _joinHost);
            y += 30;
            GUI.Label(new Rect(x, y, 100, 22), "Your name", MenuStyle.MutedLabel);
            _joinName = GUI.TextField(new Rect(x + 100, y, 200, 24), _joinName);
            y += 30;
            GUI.Label(new Rect(x, y, 100, 22), "Room code", MenuStyle.MutedLabel);
            _roomCodeInput = GUI.TextField(new Rect(x + 100, y, 120, 24), _roomCodeInput).ToUpperInvariant();
            y += 36;
            if (MenuStyle.Btn(new Rect(x, y, bw, 36), "Join room"))
                JoinRoom();
            y += 48;
            if (MenuStyle.Btn(new Rect(x, y, 140, 32), "Back"))
                EnterTitle();
            if (_socket != null)
                GUI.Label(new Rect(x + 160, y + 6, bw - 160, 22), _socket.WebSocketUrl, MenuStyle.MutedLabel);
        }

        async void HostRoomWithSetup()
        {
            if (_socket == null || _bridge == null)
            {
                _status = "Network components missing.";
                return;
            }
            if (_hostStarting) return;
            _hostStarting = true;
            _status = "Starting local play server…";
            try
            {
                var ok = await PlayServerHost.EnsureRunningAsync(msg => _status = msg);
                if (!ok)
                {
                    _status = PlayServerHost.LastError ?? "Failed to start local play server.";
                    return;
                }

                _bridge.NetworkMode = true;
                _socket.ConfigureEndpoint("127.0.0.1", PlayServerHost.DefaultPort, PlayServerHost.DefaultPath);
                _socket.ConfigureSession(
                    string.IsNullOrWhiteSpace(_hostName) ? "Host" : _hostName,
                    createRoom: true,
                    vsAi: _hostVsAi,
                    randomMap: _randomMap);
                var lan = PlayServerHost.GetPreferredLanIPv4();
                _status = $"Hosting… Guests join {lan} with your room code (port {PlayServerHost.DefaultPort}).";
                _socket.Connect();
            }
            finally
            {
                _hostStarting = false;
            }
        }

        void JoinRoom()
        {
            if (_socket == null || _bridge == null)
            {
                _status = "Network components missing.";
                return;
            }
            var code = (_roomCodeInput ?? "").Trim().ToUpperInvariant();
            if (code.Length != 6)
            {
                _status = "Room code must be 6 characters.";
                return;
            }
            var host = string.IsNullOrWhiteSpace(_joinHost) ? "127.0.0.1" : _joinHost.Trim();
            _bridge.NetworkMode = true;
            _socket.ConfigureEndpoint(host, PlayServerHost.DefaultPort, PlayServerHost.DefaultPath);
            _socket.ConfigureSession(
                string.IsNullOrWhiteSpace(_joinName) ? "Guest" : _joinName,
                createRoom: false,
                vsAi: false,
                randomMap: true,
                roomCode: code);
            _status = $"Joining {code} @ {host}…";
            _socket.Connect();
        }

        void DrawRulebook()
        {
            var margin = 24f;
            var leftW = Mathf.Min(280f, UnityEngine.Screen.width * 0.32f);
            var left = new Rect(margin, margin, leftW, UnityEngine.Screen.height - margin * 2);
            var right = new Rect(left.xMax + 16, margin, UnityEngine.Screen.width - left.xMax - margin - 16,
                UnityEngine.Screen.height - margin * 2);
            MenuStyle.DrawPanel(left, "Contents");
            MenuStyle.DrawPanel(right, "Rulebook");

            if (MenuStyle.Btn(new Rect(left.x + 12, left.yMax - 44, left.width - 24, 32), "Back"))
            {
                EnterTitle();
                return;
            }

            _ruleScroll = GUI.BeginScrollView(
                new Rect(left.x + 8, left.y + 40, left.width - 16, left.height - 96),
                _ruleScroll,
                new Rect(0, 0, left.width - 36, Mathf.Max(1, _ruleFlat.Count * 28)));
            for (var i = 0; i < _ruleFlat.Count; i++)
            {
                var (sec, depth) = _ruleFlat[i];
                var indent = 8 + depth * 14;
                var label = sec.title ?? "Section";
                if (label.Length > 32) label = label[..32] + "…";
                if (GUI.Button(new Rect(indent, i * 28, left.width - 40 - indent, 24), label))
                    _ruleSelected = i;
            }
            GUI.EndScrollView();

            if (_ruleFlat.Count == 0)
            {
                GUI.Label(new Rect(right.x + 20, right.y + 50, right.width - 40, 60),
                    "Missing rulebook-unity.json — run npm run export:unity:rulebook", MenuStyle.Body);
                return;
            }

            _ruleSelected = Mathf.Clamp(_ruleSelected, 0, _ruleFlat.Count - 1);
            var selected = _ruleFlat[_ruleSelected].section;
            GUI.Label(new Rect(right.x + 20, right.y + 40, right.width - 40, 28), selected.title ?? "", MenuStyle.Body);
            GUI.Label(new Rect(right.x + 20, right.y + 72, right.width - 40, right.height - 96),
                selected.body ?? "", MenuStyle.Body);
        }

        void DrawArmyBuilder()
        {
            var margin = 12f;
            var top = 10f;
            GUI.Label(new Rect(margin, top, 520, 24),
                _armyMode == ArmyBuilderMode.Workshop ? "Army Workshop"
                : _armyMode == ArmyBuilderMode.NetworkSubmit ? "Lock Army (Multiplayer)"
                : "Build Army — 1 Player", MenuStyle.Body);

            var uv = _draft?.TotalUv ?? 0;
            var prev = GUI.color;
            GUI.color = uv > GameConstants.ArmyUvMax ? MenuStyle.Danger : MenuStyle.Ok;
            GUI.Label(new Rect(UnityEngine.Screen.width - 280, top, 260, 24),
                $"List UV {uv}/{GameConstants.ArmyUvMax} · Deploy≤{_deployUvMax} Res≤{_reserveUvMax}",
                MenuStyle.Body);
            GUI.color = prev;

            // Preview column sized for a full prototype card (420×588) + panel chrome.
            var previewChromeX = 24f;
            var previewW = Mathf.Clamp(
                CardFaceGui.RefW + previewChromeX,
                360f,
                Mathf.Min(448f, UnityEngine.Screen.width * 0.36f));
            var h = UnityEngine.Screen.height - 52;
            var leftW = Mathf.Min(320f, UnityEngine.Screen.width * 0.24f);
            var midW = Mathf.Min(260f, UnityEngine.Screen.width * 0.20f);
            // Provisional Actions width (remaining after pool/army/preview), then move 10% to Card pool.
            var afterPreviewX = margin + leftW + 10f + midW + 10f + previewW + 10f;
            var rightW = Mathf.Max(150f, UnityEngine.Screen.width - afterPreviewX - margin);
            var transfer = rightW * 0.10f;
            leftW += transfer;
            rightW -= transfer;

            var left = new Rect(margin, 40, leftW, h);
            var mid = new Rect(left.xMax + 10, 40, midW, h);
            var preview = new Rect(mid.xMax + 10, 40, previewW, h);
            var right = new Rect(preview.xMax + 10, 40, rightW, h);

            MenuStyle.DrawPanel(left, "Card pool");
            MenuStyle.DrawPanel(mid, "Your army");
            MenuStyle.DrawPanel(preview, "Preview");
            MenuStyle.DrawPanel(right, "Actions");

            DrawCardPool(left);
            DrawRoster(mid);
            DrawPreview(preview);
            DrawArmyActions(right);
        }

        void DrawPreview(Rect panel)
        {
            // Leave room for panel title + Add button; card letterboxes to 5:7 inside.
            var inner = new Rect(panel.x + 12, panel.y + 34, panel.width - 24, panel.height - 100);
            if (_previewCard == null)
            {
                GUI.Label(inner, "Select a card from the pool to preview art + stats.", MenuStyle.MutedLabel);
                return;
            }
            CardFaceGui.Draw(inner, _previewCard, _game != null ? _game.Abilities : null);

            var addLabel = AddButtonLabel(_previewCard);
            if (MenuStyle.PrimaryBtn(new Rect(panel.x + 12, panel.yMax - 44, panel.width - 24, 32), addLabel))
                TryAddCard(_previewCard);
        }

        string AddButtonLabel(CardDefinition card)
        {
            if (card == null) return "Add to army";
            if (card.cardType == "Commander") return "Set as Commander";
            if (card.cardType == "Officer")
            {
                if (_draft?.Companies != null && _draft.Companies.Count > 0 &&
                    _selectedCompany >= 0 && _selectedCompany < _draft.Companies.Count &&
                    _draft.Companies[_selectedCompany]?.Officer == null)
                    return $"Set officer (Company {_selectedCompany + 1})";
                return "Add as new company";
            }
            var coN = (_draft?.Companies?.Count ?? 0) > 0 ? _selectedCompany + 1 : 0;
            return coN > 0 ? $"Add to Company {coN}" : "Add to company";
        }

        void DrawCardPool(Rect panel)
        {
            var x = panel.x + 10;
            var y = panel.y + 36;
            var fieldW = panel.width - 20;

            GUI.Label(new Rect(x, y, fieldW, 16), "Race", MenuStyle.MutedLabel);
            y += 18;
            var raceRect = new Rect(x, y, fieldW, 30);
            var raceIx = System.Array.FindIndex(RaceFilters,
                r => string.Equals(r, _raceFilter, System.StringComparison.OrdinalIgnoreCase));
            if (raceIx < 0) raceIx = 0;
            const int raceId = 101;
            const int typeId = 102;

            var freezeUnder = _raceDropOpen || _typeDropOpen;
            var prevEnabled = GUI.enabled;

            GUI.enabled = prevEnabled && !_typeDropOpen;
            MenuStyle.Dropdown(raceRect, RaceFilters, ref raceIx, ref _raceDropOpen, raceId, drawPopup: false);
            if (_raceDropOpen) _typeDropOpen = false;
            y += 34;

            GUI.enabled = prevEnabled && !_raceDropOpen;
            GUI.Label(new Rect(x, y, fieldW, 16), "Type", MenuStyle.MutedLabel);
            y += 18;
            var typeRect = new Rect(x, y, fieldW, 30);
            var typeIx = System.Array.FindIndex(TypeFilters, t => t == _typeFilter);
            if (typeIx < 0) typeIx = 0;
            MenuStyle.Dropdown(typeRect, TypeFilters, ref typeIx, ref _typeDropOpen, typeId, drawPopup: false);
            if (_typeDropOpen) _raceDropOpen = false;
            y += 34;

            GUI.enabled = prevEnabled && !freezeUnder;
            GUI.Label(new Rect(x, y, fieldW, 16), "Search", MenuStyle.MutedLabel);
            y += 18;
            _cardFilter = GUI.TextField(new Rect(x, y, fieldW, 22), _cardFilter);
            y += 28;

            var matches = FilterCards();
            GUI.Label(new Rect(x, y, fieldW, 18), $"{matches.Count} cards", MenuStyle.MutedLabel);
            y += 20;

            var viewH = Mathf.Max(48f, panel.height - (y - panel.y) - 12);
            _armyPickerScroll = GUI.BeginScrollView(
                new Rect(x, y, fieldW, viewH),
                _armyPickerScroll,
                new Rect(0, 0, fieldW - 24, Mathf.Max(viewH, matches.Count * 30)));
            for (var i = 0; i < matches.Count; i++)
            {
                var c = matches[i];
                var have = ArmyListUtil.CountCopies(_draft, c.cardId);
                var max = ArmyListUtil.MaxCopiesForRarity(c.rarity);
                var label = $"    {c.displayName}  ·{c.uv}  ({have}/{max})";
                var selected = _previewCard != null && _previewCard.cardId == c.cardId;
                var style = selected ? MenuStyle.CompactPrimary : MenuStyle.CompactButton;
                var row = new Rect(0, i * 30, fieldW - 24, 28);
                if (GUI.Button(row, label, style))
                {
                    _previewCard = c;
                    MenuStyle.CloseDropdowns(ref _raceDropOpen, ref _typeDropOpen);
                }
                var dot = 8f;
                MenuStyle.DrawRarityDot(
                    new Rect(row.x + 6f, row.y + (row.height - dot) * 0.5f, dot, dot),
                    c.rarity);
            }
            GUI.EndScrollView();
            GUI.enabled = prevEnabled;

            // Popups last so they paint above Type/Search/list.
            if (MenuStyle.Dropdown(raceRect, RaceFilters, ref raceIx, ref _raceDropOpen, raceId, drawPopup: true))
            {
                _raceFilter = RaceFilters[raceIx];
                _typeDropOpen = false;
            }
            if (MenuStyle.Dropdown(typeRect, TypeFilters, ref typeIx, ref _typeDropOpen, typeId, drawPopup: true))
            {
                _typeFilter = TypeFilters[typeIx];
                _raceDropOpen = false;
            }
        }

        List<CardDefinition> FilterCards()
        {
            var matches = new List<CardDefinition>();
            var cards = _game?.Cards;
            if (cards == null) return matches;
            foreach (var c in cards.All)
            {
                if (c == null) continue;
                if (_typeFilter != "All" && c.cardType != _typeFilter) continue;
                if (!RaceMatches(c.race, _raceFilter)) continue;
                if (!string.IsNullOrEmpty(_cardFilter) &&
                    (c.displayName == null ||
                     c.displayName.IndexOf(_cardFilter, System.StringComparison.OrdinalIgnoreCase) < 0))
                    continue;
                // Hide officers already assigned (unique across companies).
                if (c.cardType == "Officer" &&
                    ArmyListUtil.OfficerAlreadyAssigned(_draft, c.cardId, exceptCompany: -1))
                    continue;
                matches.Add(c);
            }
            matches.Sort((a, b) => string.Compare(a.displayName, b.displayName, System.StringComparison.OrdinalIgnoreCase));
            return matches;
        }

        static bool RaceMatches(string cardRace, string filter)
        {
            if (string.IsNullOrEmpty(filter) || filter == "All") return true;
            if (string.IsNullOrEmpty(cardRace)) return false;
            if (string.Equals(cardRace, filter, System.StringComparison.OrdinalIgnoreCase)) return true;
            if (filter.StartsWith("Lizard", System.StringComparison.OrdinalIgnoreCase) &&
                cardRace.StartsWith("Lizard", System.StringComparison.OrdinalIgnoreCase))
                return true;
            return false;
        }

        void DrawRoster(Rect panel)
        {
            var x = panel.x + 12;
            var y = panel.y + 36;
            var innerW = panel.width - 24;

            GUI.Label(new Rect(x, y, innerW, 56),
                "Select a company below, then add Units from the pool.\n" +
                "Units go into the selected company.",
                MenuStyle.MutedLabel);
            y += 60;

            if (_draft?.Commander != null)
            {
                if (GUI.Button(new Rect(x, y, innerW, 22),
                        $"Cmdr: {_draft.Commander.displayName} ({_draft.Commander.uv})"))
                    _previewCard = _draft.Commander;
            }
            else
                GUI.Label(new Rect(x, y, innerW, 22), "Cmdr: (none) — add a Commander first", MenuStyle.MutedLabel);
            y += 26;

            if (MenuStyle.Btn(new Rect(x, y, innerW, 26), "+ Add company"))
            {
                _draft ??= new DemoArmy();
                _draft.Companies.Add(new DemoCompany());
                _selectedCompany = _draft.Companies.Count - 1;
                _typeFilter = "Officer";
                _status = $"Company {_selectedCompany + 1} — pick an Officer";
            }
            y += 32;

            var companies = _draft?.Companies ?? new List<DemoCompany>();
            if (companies.Count > 0)
            {
                GUI.Label(new Rect(x, y, innerW, 18),
                    $"Selected: Company {_selectedCompany + 1}", MenuStyle.Body);
                y += 22;
            }

            _armyRosterScroll = GUI.BeginScrollView(
                new Rect(x, y, innerW, panel.yMax - y - 12),
                _armyRosterScroll,
                new Rect(0, 0, innerW - 24, Mathf.Max(200, companies.Count * 120 + 40)));

            var ry = 0f;
            for (var i = 0; i < companies.Count; i++)
            {
                var co = companies[i];
                var selected = i == _selectedCompany;
                var offName = co.Officer != null ? co.Officer.displayName : "(no officer)";
                var unitCap = co.Officer != null && co.Officer.companyUnitCap > 0
                    ? co.Officer.companyUnitCap : 0;
                var capUv = co.Officer != null ? co.Officer.companyCapacity : 0;
                var usedUv = ArmyListUtil.CompanyUnitsUv(co);
                var models = co.Units?.Count ?? 0;
                var header =
                    $"{(selected ? "▶ " : "   ")}Co {i + 1}: {offName}  · {models}/{(unitCap > 0 ? unitCap.ToString() : "—")}u  · {usedUv}/{(capUv > 0 ? capUv.ToString() : "—")}UV";

                // Compact row style — large menu buttons clip text in ~22–28px rows.
                if (GUI.Button(new Rect(0, ry, innerW - 24, 32), header,
                        selected ? MenuStyle.CompactPrimary : MenuStyle.CompactButton))
                {
                    _selectedCompany = i;
                    if (co.Officer != null) _previewCard = co.Officer;
                    _typeFilter = co.Officer == null ? "Officer" : "Unit";
                    _status = co.Officer == null
                        ? $"Company {i + 1} — pick an Officer"
                        : $"Company {i + 1} selected — add Units from the pool";
                }
                ry += 36;

                if (co.Units != null)
                {
                    for (var u = 0; u < co.Units.Count; u++)
                    {
                        var unit = co.Units[u];
                        if (unit == null) continue;
                        if (GUI.Button(new Rect(16, ry, innerW - 100, 28), $"· {unit.displayName} ({unit.uv})",
                                MenuStyle.CompactButton))
                        {
                            _selectedCompany = i;
                            _previewCard = unit;
                        }
                        if (GUI.Button(new Rect(innerW - 74, ry, 50, 28), "−", MenuStyle.CompactButton))
                        {
                            co.Units.RemoveAt(u);
                            break;
                        }
                        ry += 30;
                    }
                }

                if (GUI.Button(new Rect(16, ry, 110, 28), "Remove co.", MenuStyle.CompactButton))
                {
                    companies.RemoveAt(i);
                    _selectedCompany = Mathf.Clamp(_selectedCompany, 0, Mathf.Max(0, companies.Count - 1));
                    break;
                }
                ry += 30;
            }
            GUI.EndScrollView();
        }

        void DrawArmyActions(Rect panel)
        {
            var x = panel.x + 12;
            var y = panel.y + 40;
            var bw = panel.width - 24;

            if (MenuStyle.Btn(new Rect(x, y, bw, 28), "Clear army"))
            {
                _draft = new DemoArmy();
                _previewCard = null;
            }
            y += 36;

            GUI.Label(new Rect(x, y, bw, 18), "Save name", MenuStyle.MutedLabel);
            y += 20;
            _saveName = GUI.TextField(new Rect(x, y, bw, 22), _saveName);
            y += 28;
            if (MenuStyle.Btn(new Rect(x, y, bw, 26), "Save army"))
            {
                var err = ArmyListUtil.Validate(_draft);
                if (err != null) _status = err;
                else
                {
                    ArmyListUtil.SaveNamed(_saveName, _draft);
                    _saved = ArmyListUtil.LoadSaved();
                    _status = $"Saved '{_saveName}'";
                }
            }
            y += 32;

            GUI.Label(new Rect(x, y, bw, 18), "Saved", MenuStyle.MutedLabel);
            y += 20;
            foreach (var s in _saved)
            {
                if (s == null) continue;
                if (GUI.Button(new Rect(x, y, bw, 22), $"{s.name} · {s.race} · {s.totalUv}"))
                {
                    _draft = ArmyListUtil.Resolve(s, _game?.Cards);
                    if (_draft.Commander != null)
                        _raceFilter = NormalizeRaceFilter(_draft.Commander.race);
                }
                y += 26;
                if (y > panel.yMax - 160) break;
            }

            y = panel.yMax - 150;
            GUI.Label(new Rect(x, y, bw, 40), _status, MenuStyle.MutedLabel);
            y += 44;

            if (_armyMode == ArmyBuilderMode.Workshop)
            {
                if (MenuStyle.Btn(new Rect(x, y, bw, 34), "Back to title"))
                    EnterTitle();
            }
            else if (_armyMode == ArmyBuilderMode.StartSkirmish)
            {
                if (MenuStyle.PrimaryBtn(new Rect(x, y, bw, 40), "Start battle"))
                    StartSkirmishFromDraft();
                y += 48;
                if (MenuStyle.Btn(new Rect(x, y, bw, 28), "Back to setup"))
                {
                    MatchLaunchContext.SetupKind = MatchSetupKind.Skirmish;
                    MatchLaunchContext.DeployUvMax = _deployUvMax;
                    MatchLaunchContext.ReserveUvMax = _reserveUvMax;
                    MatchLaunchContext.RandomMap = _randomMap;
                    MatchLaunchContext.OpenMatchSetupOnMenu = true;
                    if (Application.CanStreamedLevelBeLoaded(GameSceneIds.MainMenu))
                        GameSceneRouter.LoadMainMenu();
                    else
                        EnterMatchSetup(MatchSetupKind.Skirmish);
                }
            }
            else
            {
                if (MenuStyle.PrimaryBtn(new Rect(x, y, bw, 40), "Submit army"))
                    SubmitNetworkArmy();
                y += 48;
                if (MenuStyle.Btn(new Rect(x, y, bw, 28), "Disconnect / Title"))
                {
                    _socket?.Disconnect();
                    EnterTitle();
                }
            }
        }

        static string NormalizeRaceFilter(string race)
        {
            if (string.IsNullOrEmpty(race)) return "All";
            if (race.StartsWith("Lizard", System.StringComparison.OrdinalIgnoreCase)) return "Lizardman";
            return race;
        }

        void TryAddCard(CardDefinition card)
        {
            if (card == null) return;
            _draft ??= new DemoArmy();
            if (!ArmyListUtil.CanAdd(_draft, card, _selectedCompany, out var err))
            {
                _status = err;
                return;
            }

            if (card.cardType == "Commander")
            {
                _draft.Commander = card;
                _raceFilter = NormalizeRaceFilter(card.race);
                _status = $"Commander: {card.displayName}";
                return;
            }

            if (card.cardType == "Officer")
            {
                // Prefer filling the selected empty company; otherwise open a new company.
                DemoCompany co = null;
                if (_draft.Companies.Count > 0)
                {
                    _selectedCompany = Mathf.Clamp(_selectedCompany, 0, _draft.Companies.Count - 1);
                    if (_draft.Companies[_selectedCompany].Officer == null)
                        co = _draft.Companies[_selectedCompany];
                }
                if (co == null)
                {
                    co = new DemoCompany();
                    _draft.Companies.Add(co);
                    _selectedCompany = _draft.Companies.Count - 1;
                }
                co.Officer = card;
                _typeFilter = "Unit";
                _status = $"Company {_selectedCompany + 1} officer: {card.displayName} — now add Units";
                return;
            }

            if (_draft.Companies.Count == 0)
            {
                _status = "Add an Officer company first (+ Add company, then an Officer).";
                return;
            }
            _selectedCompany = Mathf.Clamp(_selectedCompany, 0, _draft.Companies.Count - 1);
            var company = _draft.Companies[_selectedCompany];
            if (company.Officer == null)
            {
                _status = "Set this company's officer first.";
                return;
            }
            company.Units.Add(card);
            var used = ArmyListUtil.CompanyUnitsUv(company);
            var cap = company.Officer.companyCapacity;
            var models = company.Units.Count;
            var unitCap = company.Officer.companyUnitCap;
            _status =
                $"Added {card.displayName} → Co {_selectedCompany + 1}  units {models}/{unitCap}  UV {used}/{cap}";
        }

        void StartSkirmishFromDraft()
        {
            var err = ArmyListUtil.Validate(_draft);
            if (err != null)
            {
                _status = err;
                return;
            }

            var roomSeed = _game != null ? _game.State?.RoomCode : null;
            if (string.IsNullOrEmpty(roomSeed))
                roomSeed = MatchLaunchContext.RoomSeed;

            MatchLaunchContext.PrepareBattleFromDraft(
                ArmyListUtil.Clone(_draft),
                _deployUvMax,
                _reserveUvMax,
                _randomMap,
                _defaultAiRace,
                roomSeed);

            if (Application.CanStreamedLevelBeLoaded(GameSceneIds.Battle))
            {
                GameSceneRouter.LoadBattle();
                return;
            }

            // Fallback when Battle scene is not in Build Settings yet.
            ApplyPendingBattleLaunch();
        }

        void ApplyPendingBattleLaunch()
        {
            EnsureRefs();
            if (_game == null) return;

            if (_bridge != null) _bridge.NetworkMode = false;
            if (!string.IsNullOrEmpty(MatchLaunchContext.RoomSeed))
                _game.SyncRoomSeed(MatchLaunchContext.RoomSeed);

            _deployUvMax = MatchLaunchContext.DeployUvMax;
            _reserveUvMax = MatchLaunchContext.ReserveUvMax;
            _randomMap = MatchLaunchContext.RandomMap;
            _defaultAiRace = MatchLaunchContext.DefaultAiRace ?? _defaultAiRace;
            _draft = MatchLaunchContext.DraftArmy ?? _draft;

            _game.RestartSkirmish();
            _game.ApplyMatchSetup(_deployUvMax, _reserveUvMax, _randomMap);
            var race = _draft?.Commander?.race ?? "Human";
            if (race.StartsWith("Lizard", System.StringComparison.OrdinalIgnoreCase))
                race = "Lizardmen";
            _game.SetArmyRace(SeatId.N, race);
            _game.SetArmyRace(SeatId.S, _defaultAiRace);
            if (_draft != null)
                _game.SetOfflineArmy(SeatId.N, ArmyListUtil.Clone(_draft));

            MatchLaunchContext.ClearBattlePending();
            EnterMatch();
            _game.BeginForceSelectFromArmyBuild(preserveArmies: true);
            _game.SetBattlefieldVisible(true);
            _game.RefreshBattlefieldOverlays();
        }

        void SubmitNetworkArmy()
        {
            var err = ArmyListUtil.Validate(_draft);
            if (err != null)
            {
                _status = err;
                return;
            }
            var json = ArmyListUtil.BuildSubmitArmyJson(_draft);
            if (string.IsNullOrEmpty(json) || _bridge == null || !_bridge.TrySendQuickPickArmy(json))
            {
                _status = "Failed to submit army.";
                return;
            }
            _status = "Army submitted.";
            EnterMatch();
        }
    }
}
