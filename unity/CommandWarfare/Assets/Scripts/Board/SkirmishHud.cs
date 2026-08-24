using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Minimal play-mode HUD for offline skirmish (ArmyBuild → Deploy → Play).</summary>
    [RequireComponent(typeof(BoardGameController))]
    public class SkirmishHud : MonoBehaviour
    {
        static readonly string[] BucketOptions = { "Deploy", "Reserve", "Unused" };

        BoardGameController _game;
        BoardInputController _input;
        Vector2 _raceScroll;
        Vector2 _forceScroll;
        /// <summary>Vertical pixel offset for the play HUD scroll region.</summary>
        float _playHudScrollY;
        float _playHudContentH = 900f;
        float _playHudDrawScroll;
        Rect _playHudScreenRect;

        /// <summary>Content-space rect shifted by the current play-HUD scroll (fixes IMGUI hit tests).</summary>
        Rect Phr(float x, float contentY, float w, float h) =>
            new Rect(x, contentY - _playHudDrawScroll, w, h);

        void PlayDrawHRule(float contentY, float w) =>
            DrawHRule(0, contentY - _playHudDrawScroll, w);

        /// <summary>Screen-space X: board clicks left of this are ignored while the play HUD is up.</summary>
        public static float BoardClickBlockRightX { get; private set; }
        readonly Dictionary<string, bool> _bucketDropOpen = new();

        void Awake()
        {
            _game = GetComponent<BoardGameController>();
            _input = GetComponent<BoardInputController>();
        }

        void OnEnable()
        {
            if (_game != null)
                _game.SelectionChanged += Repaint;
        }

        void OnDisable()
        {
            if (_game != null)
                _game.SelectionChanged -= Repaint;
            BoardInputController.HudBlocksBoardClicks = false;
            BoardClickBlockRightX = 0f;
        }

        void LateUpdate()
        {
            var mouse = BoardInput.MousePosition();
            // Screen X matches GUI X; block the whole left HUD strip so clicks never hit the board.
            BoardInputController.HudBlocksBoardClicks =
                enabled && BoardClickBlockRightX > 1f && mouse.x <= BoardClickBlockRightX;
        }

        void Repaint() { }

        void OnGUI()
        {
            // GameFlowController disables this component on menu screens — that is the gate.
            // Do not also require IsInMatch; ForceSelect/Deploy can race EnterMatch by a frame.
            var state = _game.State;
            if (state == null) return;

            if (state.Phase == Phase.ArmyBuild)
            {
                DrawArmyBuild(state);
                return;
            }

            if (state.Phase == Phase.ForceSelect)
            {
                DrawForceSelect(state);
                return;
            }

            if (state.Phase == Phase.Terrain)
            {
                DrawTerrain(state);
                return;
            }

            if (state.Phase == Phase.Deploy)
            {
                CommandWarfare.UI.MenuStyle.Ensure();
                var panel = new Rect(12, 12, Mathf.Min(640f, Screen.width * 0.55f), 280f);
                CommandWarfare.UI.MenuStyle.DrawPanel(panel, "Deploy");

                var dx = panel.x + 16f;
                var dy = panel.y + 40f;
                var deployInnerW = panel.width - 32f;
                GUI.Label(new Rect(dx, dy, deployInnerW, 40),
                    "1) Select a company in the queue  ·  2) Click a highlighted hex to place\n" +
                    "Blue/red wedges = deployment zones  ·  Gold = objectives  ·  Click a placed unit to reposition",
                    CommandWarfare.UI.MenuStyle.MutedLabel);
                dy += 44f;
                DrawDeployQueue(state, SeatId.N, ref dy);
                dy += 6f;
                if (GUI.Button(new Rect(dx, dy, 150, 28), "Auto-place (N)"))
                    _game.AutoPlaceDeploy(SeatId.N);
                if (GUI.Button(new Rect(dx + 160, dy, 170, 28), "Confirm Deploy (N)"))
                    _game.ConfirmDeploy(SeatId.N);
                dy += 34f;
                GUI.Label(new Rect(dx, dy, deployInnerW, 40),
                    $"Ready: N={(OfflineDeploy.IsSeatReady(state, SeatId.N) ? "yes" : "no")}  " +
                    $"S={(OfflineDeploy.IsSeatReady(state, SeatId.S) ? "yes" : "no")} · [E] confirm N\n" +
                    $"{state.NorthRace} (N) vs {state.SouthRace} (S) · " +
                    $"Units on board: {state.Units?.Count ?? 0}\n" +
                    (state.LastActionLog ?? "Place Deploy companies on the north wedge."),
                    CommandWarfare.UI.MenuStyle.MutedLabel);

                UnitToken deploySel = null;
                if (state.SelectedUnitId != null)
                {
                    foreach (var u in state.Units)
                        if (u.Id == state.SelectedUnitId) { deploySel = u; break; }
                }
                DrawBattlefieldCard(state, deploySel);
                return;
            }

            if (state.Phase == Phase.Ended && state.WinnerSeat.HasValue)
            {
                var winnerName = SeatPlayerName(state, state.WinnerSeat.Value);
                GUI.color = SeatColors.Fill(state.WinnerSeat.Value);
                GUI.Label(new Rect(12, 12, 420, 28), $"{winnerName} wins!");
                GUI.color = Color.white;
                return;
            }

            DrawPlayHud(state);
        }

        void DrawPlayHud(GameState state)
        {
            CommandWarfare.UI.MenuStyle.Ensure();
            CombatFollowup.SanitizePendingFollowups(state);
            var panelW = Mathf.Min(300f, Screen.width * 0.3f);
            var panelH = Mathf.Min(Screen.height - 24f, Screen.height * 0.92f);
            var playPanel = new Rect(12, 12, panelW, panelH);
            _playHudScreenRect = playPanel;
            BoardClickBlockRightX = playPanel.xMax + 8f;

            var activeName = state.ActiveSeat.HasValue
                ? SeatPlayerName(state, state.ActiveSeat.Value)
                : "—";
            var title = $"Round {state.Round}/{GameConstants.MaxRounds}";
            CommandWarfare.UI.MenuStyle.DrawPanel(playPanel, title);

            var pad = 14f;
            var scrollBar = 14f;
            var view = new Rect(
                playPanel.x + pad,
                playPanel.y + 36f,
                playPanel.width - pad * 2f,
                playPanel.height - 48f);
            var contentW = Mathf.Max(40f, view.width - scrollBar);

            UnitToken selected = null;
            if (state.SelectedUnitId != null && state.Units != null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Id == state.SelectedUnitId)
                    {
                        selected = u;
                        break;
                    }
                }
            }

            var actionH = EstimateSelectedActionHeight(state, selected);
            var scrollH = Mathf.Max(80f, view.height - actionH);
            var scrollView = new Rect(view.x, view.y, view.width, scrollH);
            HandlePlayHudWheel(scrollView);

            var maxScroll = Mathf.Max(0f, _playHudContentH - scrollH);
            _playHudScrollY = Mathf.Clamp(_playHudScrollY, 0f, maxScroll);

            _playHudDrawScroll = _playHudScrollY;
            var iw = contentW;
            GUI.BeginGroup(view);
            try
            {
            GUI.BeginGroup(new Rect(0f, 0f, contentW, scrollH));
            try
            {
            var y = 0f;
            var color = state.ActiveSeat.HasValue
                ? SeatColors.Fill(state.ActiveSeat.Value)
                : Color.gray;

            GUI.color = color;
            GUI.Label(Phr(0, y, iw, 22), $"{activeName}'s turn",
                CommandWarfare.UI.MenuStyle.Body);
            GUI.color = Color.white;
            y += 22f;

            GUI.Label(Phr(0, y, iw, 32),
                "Green = move · Red = attack · Blue/purple = CR",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 28f;

            if (state.Scores != null && state.Scores.Count > 0)
            {
                var nVp = state.Scores.TryGetValue(SeatId.N, out var ns) ? ns : 0;
                var sVp = state.Scores.TryGetValue(SeatId.S, out var ss) ? ss : 0;
                var nName = ShortName(SeatPlayerName(state, SeatId.N));
                var sName = ShortName(SeatPlayerName(state, SeatId.S));
                GUI.Label(Phr(0, y, iw, 34),
                    $"VP  {nName} {nVp}  ·  {sName} {sVp}",
                    CommandWarfare.UI.MenuStyle.Body);
                y += 30f;
            }

            if (state.ActiveSeat.HasValue &&
                state.CommanderPools != null &&
                state.CommanderPools.TryGetValue(state.ActiveSeat.Value, out var cmdPool))
            {
                GUI.Label(Phr(0, y, iw, 18),
                    $"Cmd AP {cmdPool.Ap}/{cmdPool.ApMax} · CC {cmdPool.Cc}/{cmdPool.CcMax}",
                    CommandWarfare.UI.MenuStyle.Body);
                y += 18f;
            }

            if (state.ActiveSeat.HasValue &&
                !string.IsNullOrEmpty(state.ActiveCompanyOfficerId) &&
                state.CompanyPools != null &&
                state.CompanyPools.TryGetValue(state.ActiveCompanyOfficerId, out var coPool))
            {
                var activeOfficerName = "?";
                if (state.Units != null)
                {
                    foreach (var u in state.Units)
                    {
                        if (u.Id != state.ActiveCompanyOfficerId) continue;
                        activeOfficerName = u.CardName;
                        break;
                    }
                }
                GUI.Label(Phr(0, y, iw, 36),
                    $"Company: {activeOfficerName}\nAP {coPool.Ap}/{coPool.ApMax}",
                    CommandWarfare.UI.MenuStyle.Body);
                y += 36f;
            }
            else
            {
                GUI.Label(Phr(0, y, iw, 44),
                    "Activate one company per turn (officer once/round), or commander (once/round).",
                    CommandWarfare.UI.MenuStyle.MutedLabel);
                y += 44f;
            }

            if (GUI.Button(Phr(0, y, iw, 28), "End Turn [E]"))
                _game.EndTurn();
            y += 32f;
            var muteLabel = CommandWarfare.Units.BattleAudio.Muted ? "SFX: Off" : "SFX: On";
            if (GUI.Button(Phr(0, y, iw * 0.55f, 24), muteLabel))
                CommandWarfare.Units.BattleAudio.Muted = !CommandWarfare.Units.BattleAudio.Muted;
            if (GUI.Button(Phr(iw * 0.58f, y, iw * 0.42f, 24), "Menu"))
            {
                var flow = GetComponent<CommandWarfare.UI.GameFlowController>();
                flow?.ReturnToMainMenu();
            }
            y += 28f;
            GUI.Label(Phr(0, y, iw, 16),
                "Shift+hover card · Ctrl+scroll zoom",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 20f;

            DrawHRule(0, y - _playHudDrawScroll, iw);
            y += 8f;
            y = DrawUnitQuickSelect(state, y, iw);
            DrawHRule(0, y - _playHudDrawScroll, iw);
            y += 10f;

            if (selected != null)
            {
                y = DrawCastPanel(state, selected, y, iw);

                var isOwn = state.ActiveSeat.HasValue && selected.Seat == state.ActiveSeat.Value;
                if (isOwn)
                {
                    var fortKey = HexMath.Key(selected.Col, selected.Row);
                    var fortified = state.FortifiedHexes != null &&
                                    state.FortifiedHexes.TryGetValue(fortKey, out var f) && f;
                    if (GUI.Button(Phr(0, y, iw * 0.48f, 22), fortified ? "Unfortify" : "Fortify"))
                        _game.TryToggleFortifyAtSelected();
                    if (CanUndoMove(selected) &&
                        GUI.Button(Phr(iw * 0.52f, y, iw * 0.48f, 22), "Undo Move"))
                        _game.TryUndoMoveSelected();
                    y += 26f;
                    var bw = (iw - 12f) / 4f;
                    if (GUI.Button(Phr(0, y, bw, 22), "Dmg 1"))
                        _game.TryApplyDamageSelected(1);
                    if (GUI.Button(Phr(bw + 4f, y, bw, 22), "Heal 1"))
                        _game.TryApplyHealSelected(1);
                    if (GUI.Button(Phr((bw + 4f) * 2f, y, bw, 22), "1d6"))
                        _game.TryRollDice(1, 6);
                    if (GUI.Button(Phr((bw + 4f) * 3f, y, bw, 22), "Evade"))
                        _game.TryActivateEvade(selected);
                    y += 26f;
                }
            }

            PlayDrawHRule(y, iw);
            y += 10f;

            if (CombatFollowup.IsPendingCleaveValid(state, out _))
            {
                GUI.color = Color.yellow;
                GUI.Label(Phr(0, y, iw, 40),
                    $"Cleave {CleavePlanner.AssignedTotal(state.PendingCleave)}/{state.PendingCleave.TotalDamage} · leftover {CleavePlanner.Leftover(state.PendingCleave)}",
                    CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += 40f;
                if (GUI.Button(Phr(0, y, iw * 0.48f, 24), "Confirm"))
                    _game.ConfirmCleave();
                if (GUI.Button(Phr(iw * 0.52f, y, iw * 0.48f, 24), "Cancel"))
                    _game.CancelCleave();
                y += 28f;
            }
            else if (CombatFollowup.IsPendingTrampleValid(state, out var trampleAttacker))
            {
                GUI.color = Color.yellow;
                GUI.Label(Phr(0, y, iw, 36),
                    $"{trampleAttacker.CardName}: Trample — enter destroyed hex?",
                    CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += 36f;
                if (GUI.Button(Phr(0, y, iw * 0.48f, 24), "Continue"))
                    _game.TryContinueTrample();
                if (GUI.Button(Phr(iw * 0.52f, y, iw * 0.48f, 24), "Decline"))
                    _game.TryDeclineTrample();
                y += 28f;
            }
            else if (HasFollowup(state, out var followNote))
            {
                GUI.color = Color.yellow;
                GUI.Label(Phr(0, y, iw, 40), followNote, CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += 40f;
                if (GUI.Button(Phr(0, y, iw, 24), "Skip / End turn"))
                    _game.EndTurn();
                y += 28f;
            }
            else if (!string.IsNullOrEmpty(_game.PendingAttackTargetId) || _game.PendingAttackPick)
            {
                y = DrawPendingAttackConfirm(state, selected, y, iw);
            }
            else if (!string.IsNullOrEmpty(_game.PendingAbilityName))
            {
                y = DrawPendingCastConfirm(state, selected, y, iw);
            }
            else
            {
                GUI.Label(Phr(0, y, iw, 36),
                    "Select → Activate → Move / Attack / Cast",
                    CommandWarfare.UI.MenuStyle.MutedLabel);
                y += 36f;
            }

            if (!string.IsNullOrEmpty(state.LastCombatLog))
            {
                GUI.color = new Color(1f, 0.92f, 0.55f);
                var combatH = CommandWarfare.UI.MenuStyle.Body.CalcHeight(
                    new GUIContent(state.LastCombatLog), iw);
                GUI.Label(Phr(0, y, iw, combatH), state.LastCombatLog,
                    CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += combatH + 6f;
            }
            if (!string.IsNullOrEmpty(state.LastActionLog) &&
                state.LastActionLog != state.LastCombatLog)
            {
                var actionLogH = CommandWarfare.UI.MenuStyle.MutedLabel.CalcHeight(
                    new GUIContent(state.LastActionLog), iw);
                GUI.Label(Phr(0, y, iw, actionLogH), state.LastActionLog,
                    CommandWarfare.UI.MenuStyle.MutedLabel);
                y += actionLogH + 6f;
            }

            GUI.Label(Phr(0, y, iw, 18), $"Units on board: {state.Units?.Count ?? 0}",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 22f;
            DrawGraveyard(state, ref y, iw);

            _playHudContentH = Mathf.Max(y + 24f, scrollH);
            }
            finally
            {
                GUI.EndGroup();
            }

            maxScroll = Mathf.Max(0f, _playHudContentH - scrollH);
            _playHudScrollY = Mathf.Clamp(_playHudScrollY, 0f, maxScroll);
            DrawPlayHudScrollbar(new Rect(0f, 0f, contentW, scrollH), maxScroll);

            if (selected != null && actionH > 0f)
                DrawSelectedActionPanel(state, selected, new Rect(0f, scrollH, contentW, actionH), iw);

            }
            finally
            {
                GUI.EndGroup();
            }

            // Outside the HUD group — UnitInspectGui uses absolute screen coords.
            DrawBattlefieldCard(state, selected);
        }

        static float EstimateSelectedActionHeight(GameState state, UnitToken selected)
        {
            if (selected == null) return 0f;
            var h = 11f + 36f;
            var isOwn = state.ActiveSeat.HasValue && selected.Seat == state.ActiveSeat.Value;
            if (state.Phase == Phase.Play && isOwn)
            {
                if (selected.Kind == UnitKind.Officer || selected.Kind == UnitKind.Unit)
                    h += 30f;
                if (selected.Kind == UnitKind.Commander)
                    h += 30f;
                h += 30f;
            }
            else
                h += 22f;
            return h + 10f;
        }

        void DrawSelectedActionPanel(GameState state, UnitToken selected, Rect panel, float iw)
        {
            GUI.BeginGroup(panel);
            try
            {
                DrawHRule(0, 0f, iw);
                var y = 11f;
                GUI.Label(new Rect(0, y, iw, 36),
                    $"Selected\n{selected.CardName ?? "?"} ({selected.Race ?? "?"})",
                    CommandWarfare.UI.MenuStyle.Body);
                y += 36f;

                var isOwn = state.ActiveSeat.HasValue && selected.Seat == state.ActiveSeat.Value;
                if (isOwn)
                {
                    y = DrawActivationButtons(state, selected, y, iw);
                    y = DrawAttackButton(state, selected, y, iw);
                }
                else
                {
                    GUI.Label(new Rect(0, y, iw, 18), "Inspecting opponent",
                        CommandWarfare.UI.MenuStyle.MutedLabel);
                }
            }
            finally
            {
                GUI.EndGroup();
            }
        }

        void HandlePlayHudWheel(Rect view)
        {
            var e = Event.current;
            if (e == null || e.type != EventType.ScrollWheel) return;
            if (!view.Contains(e.mousePosition)) return;
            if (BoardInput.CtrlHeld()) return; // Ctrl+scroll = camera zoom
            _playHudScrollY += e.delta.y * 14f;
            e.Use();
        }

        void DrawPlayHudScrollbar(Rect view, float maxScroll)
        {
            if (maxScroll <= 1f) return;
            var barW = 10f;
            var track = new Rect(view.width - barW, 0f, barW, view.height);
            var prev = GUI.color;
            GUI.color = new Color(1f, 1f, 1f, 0.12f);
            GUI.DrawTexture(track, Texture2D.whiteTexture);
            var thumbH = Mathf.Max(28f, view.height * view.height / Mathf.Max(view.height, _playHudContentH));
            var thumbY = maxScroll > 0f ? (_playHudScrollY / maxScroll) * (view.height - thumbH) : 0f;
            GUI.color = new Color(1f, 1f, 1f, 0.35f);
            GUI.DrawTexture(new Rect(track.x, thumbY, barW, thumbH), Texture2D.whiteTexture);
            GUI.color = prev;
        }

        static void DrawHRule(float x, float y, float w)
        {
            var prev = GUI.color;
            GUI.color = new Color(1f, 1f, 1f, 0.12f);
            GUI.DrawTexture(new Rect(x, y, w, 1f), Texture2D.whiteTexture);
            GUI.color = prev;
        }

        static string SeatPlayerName(GameState state, SeatId seat)
        {
            if (state?.Units != null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Seat == seat && u.Kind == UnitKind.Commander &&
                        !string.IsNullOrEmpty(u.CardName))
                        return u.CardName;
                }
            }
            if (state?.OfflineArmies != null &&
                state.OfflineArmies.TryGetValue(seat, out var army) &&
                army?.Commander != null)
            {
                if (!string.IsNullOrEmpty(army.Commander.displayName))
                    return army.Commander.displayName;
                if (!string.IsNullOrEmpty(army.Commander.cardId))
                    return army.Commander.cardId;
            }
            if (seat == SeatId.N && !string.IsNullOrEmpty(state?.NorthRace))
                return state.NorthRace;
            if (seat == SeatId.S && !string.IsNullOrEmpty(state?.SouthRace))
                return state.SouthRace;
            return seat.ToString();
        }

        static string ShortName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "?";
            return name.Length <= 12 ? name : name[..11] + "…";
        }

        void DrawBattlefieldCard(GameState state, UnitToken selected)
        {
            UnitToken cardUnit = selected;
            if (BoardInput.ShiftHeld())
            {
                // Lazy-resolve input if Awake raced or component was added later.
                if (_input == null)
                    _input = GetComponent<BoardInputController>() ??
                             FindFirstObjectByType<BoardInputController>();

                var hoverId = _input != null ? _input.HoveredUnitId : null;
                if (!string.IsNullOrEmpty(hoverId) && state.Units != null)
                {
                    foreach (var u in state.Units)
                    {
                        if (u.Id != hoverId) continue;
                        cardUnit = u;
                        break;
                    }
                }
            }

            if (cardUnit != null)
                CommandWarfare.UI.UnitInspectGui.Draw(
                    state, cardUnit, _game.Cards, _game.Abilities);
        }

        float DrawUnitQuickSelect(GameState state, float y, float iw)
        {
            if (state.Phase != Phase.Play || !state.ActiveSeat.HasValue || state.Units == null)
                return y;

            var seat = state.ActiveSeat.Value;
            var mine = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat == seat) mine.Add(u);
            }
            if (mine.Count == 0) return y;

            // Officers/commanders first, then alphabetical.
            mine.Sort((a, b) =>
            {
                var ka = KindOrder(a.Kind);
                var kb = KindOrder(b.Kind);
                if (ka != kb) return ka.CompareTo(kb);
                return string.Compare(a.CardName, b.CardName, System.StringComparison.OrdinalIgnoreCase);
            });

            GUI.Label(Phr(0, y, iw, 18), "Your units", CommandWarfare.UI.MenuStyle.Body);
            y += 18f;

            // Flat list inside the play-HUD scroll region.
            const float rowH = 26f;
            for (var i = 0; i < mine.Count; i++)
            {
                var u = mine[i];
                var info = UnitBattleAvailability.Describe(state, u, _game.Abilities);
                var badge = u.Kind switch
                {
                    UnitKind.Commander => "C",
                    UnitKind.Officer => "O",
                    _ => "U",
                };
                var selected = state.SelectedUnitId == u.Id;
                var label = $"{badge} {ShortName(u.CardName)}";
                var tip = $"{u.CardName} — {info.StatusLabel}";
                var row = Phr(0, y, iw, rowH - 2f);

                GUI.enabled = info.Selectable || selected;
                GUI.color = selected
                    ? new Color(1f, 0.95f, 0.7f)
                    : info.Tone switch
                    {
                        UnitBattleAvailability.Tone.Ready => new Color(0.85f, 1f, 0.85f),
                        UnitBattleAvailability.Tone.Active => new Color(1f, 0.95f, 0.75f),
                        UnitBattleAvailability.Tone.Done => new Color(0.75f, 0.72f, 0.7f),
                        _ => Color.white,
                    };
                if (GUI.Button(row, new GUIContent(label, tip)))
                    _game.SelectUnit(u.Id);
                GUI.color = Color.white;
                GUI.enabled = true;
                y += rowH;
            }

            y += 6f;

            if (!string.IsNullOrEmpty(GUI.tooltip))
            {
                GUI.Label(Phr(0, y, iw, 28), GUI.tooltip, CommandWarfare.UI.MenuStyle.MutedLabel);
                y += 30f;
            }

            return y;
        }

        static int KindOrder(UnitKind kind) => kind switch
        {
            UnitKind.Commander => 0,
            UnitKind.Officer => 1,
            _ => 2,
        };

        float DrawActivationButtons(GameState state, UnitToken selected, float y)
            => DrawActivationButtons(state, selected, y, 220f);

        float DrawActivationButtons(GameState state, UnitToken selected, float y, float iw)
        {
            if (state.Phase != Phase.Play || !state.ActiveSeat.HasValue) return y;
            if (selected == null || selected.Seat != state.ActiveSeat.Value) return y;

            if (selected.Kind == UnitKind.Officer || selected.Kind == UnitKind.Unit)
            {
                var officer = selected.Kind == UnitKind.Officer
                    ? selected
                    : CompanyActivation.FindOfficerForUnit(state, selected);
                if (officer != null && officer.Kind == UnitKind.Officer)
                {
                    string label;
                    var disabled = false;
                    if (state.ActiveCompanyOfficerId == officer.Id)
                    {
                        label = "Company active";
                        disabled = true;
                    }
                    else if (state.CompaniesActivatedThisRound != null &&
                             state.CompaniesActivatedThisRound.TryGetValue(officer.Id, out var done) &&
                             done)
                    {
                        label = "Already activated this round";
                        disabled = true;
                    }
                    else if (state.CompanyActivatedThisTurn != null &&
                             state.CompanyActivatedThisTurn.TryGetValue(selected.Seat, out var other) &&
                             !string.IsNullOrEmpty(other) && other != officer.Id)
                    {
                        label = "One company per turn";
                        disabled = true;
                    }
                    else if (state.CommanderPools == null ||
                             !state.CommanderPools.TryGetValue(selected.Seat, out var cmdPool) ||
                             cmdPool.Cc < GameConstants.OfficerActivateCcCost)
                    {
                        label = "Activate company (need 1 CC)";
                        disabled = true;
                    }
                    else
                        label = "Activate company (−1 CC)";

                    GUI.enabled = !disabled;
                    if (GUI.Button(new Rect(0, y, iw, 26), label))
                        _game.TryActivateSelectedCompany();
                    GUI.enabled = true;
                    y += 30;
                }
            }

            if (selected.Kind == UnitKind.Commander)
            {
                var already = CommanderActivation.IsCommanderActivatedThisRound(state, selected.Seat);
                var label = already ? "Commander activated" : "Activate commander";
                GUI.enabled = !already;
                if (GUI.Button(new Rect(0, y, iw, 26), label))
                    _game.TryActivateSelectedCommander();
                GUI.enabled = true;
                y += 30;
            }

            return y;
        }

        float DrawAttackButton(GameState state, UnitToken selected, float y)
            => DrawAttackButton(state, selected, y, 180f);

        float DrawAttackButton(GameState state, UnitToken selected, float y, float iw)
        {
            if (state.Phase != Phase.Play || !state.ActiveSeat.HasValue) return y;
            if (selected == null || selected.Seat != state.ActiveSeat.Value) return y;

            var already = BoardGameController.UnitAlreadyAttacked(selected);
            var companyOk = selected.Kind == UnitKind.Commander ||
                            CompanyActivation.IsUnitInActiveCompany(state, selected);
            var busy = !string.IsNullOrEmpty(_game.PendingAbilityName) ||
                       (!string.IsNullOrEmpty(_game.PendingAttackTargetId) && !_game.PendingAttackPick);

            string label;
            if (already)
                label = "Already attacked";
            else if (!companyOk)
                label = "Activate company first";
            else if (_game.PendingAttackPick)
                label = "Click a target…";
            else
                label = "Attack";

            var canStart = !already && companyOk && (!busy || _game.PendingAttackPick);
            GUI.enabled = canStart;
            if (GUI.Button(new Rect(0, y, iw, 26), label) && canStart && !_game.PendingAttackPick)
                _game.BeginAttackPick();
            GUI.enabled = true;
            y += 30;
            return y;
        }

        float DrawCastPanel(GameState state, UnitToken selected, float y)
            => DrawCastPanel(state, selected, y, 600f);

        float DrawCastPanel(GameState state, UnitToken selected, float y, float iw)
        {
            if (state.Phase != Phase.Play || selected == null) return y;
            var names = new List<string>();
            if (selected.Abilities != null)
                names.AddRange(selected.Abilities);
            if (!string.IsNullOrEmpty(selected.Ultimate) && !names.Contains(selected.Ultimate))
                names.Add(selected.Ultimate);
            if (names.Count == 0) return y;

            var abilities = _game.Abilities;
            GUI.Label(Phr(0, y, iw, 18), "Cast", CommandWarfare.UI.MenuStyle.Body);
            y += 18;
            GUI.Label(Phr(0, y, iw, 32),
                "Click ability → target if needed → confirm.",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 30;

            var pendingBusy = !string.IsNullOrEmpty(_game.PendingAbilityName) ||
                              !string.IsNullOrEmpty(_game.PendingAttackTargetId);
            foreach (var name in names)
            {
                var def = abilities?.FindByName(name);
                var abilityDef = def != null
                    ? new AbilityCast.AbilityDef(
                        def.displayName, def.type, def.cost, def.costAmount, def.costResource, def.usedBy)
                    : default;

                if (def != null && AbilityCast.IsPassive(abilityDef)) continue;
                if (def != null && !AbilityCast.CasterMayUse(abilityDef, selected.Kind)) continue;

                var spendLabel = "?";
                var disabled = pendingBusy ||
                               !state.ActiveSeat.HasValue ||
                               selected.Seat != state.ActiveSeat.Value;
                var reason = "";
                if (def == null)
                {
                    disabled = true;
                    reason = "Unknown ability";
                    spendLabel = "—";
                }
                else
                {
                    var spend = AbilityCast.SpendForCaster(abilityDef, selected.Kind);
                    if (spend.HasError)
                    {
                        disabled = true;
                        reason = spend.Error;
                        spendLabel = "—";
                    }
                    else if (spend.Pool == AbilityCast.AbilityPool.None)
                    {
                        spendLabel = "Ultimate";
                        if (selected.UltimateUsed)
                        {
                            disabled = true;
                            reason = "Ultimate already used";
                        }
                    }
                    else if (spend.Pool == AbilityCast.AbilityPool.CommanderAp)
                    {
                        spendLabel = $"{spend.Amount} AP";
                        if (state.CommanderPools == null ||
                            !state.CommanderPools.TryGetValue(selected.Seat, out var cp) ||
                            cp.Ap < spend.Amount)
                        {
                            disabled = true;
                            reason = "Not enough AP";
                        }
                    }
                    else if (spend.Pool == AbilityCast.AbilityPool.CommanderCc)
                    {
                        spendLabel = $"{spend.Amount} CC";
                        if (state.CommanderPools == null ||
                            !state.CommanderPools.TryGetValue(selected.Seat, out var cp) ||
                            cp.Cc < spend.Amount)
                        {
                            disabled = true;
                            reason = "Not enough CC";
                        }
                    }
                    else if (spend.Pool == AbilityCast.AbilityPool.CompanyAp)
                    {
                        spendLabel = $"{spend.Amount} Co.AP";
                        var officer = CompanyActivation.FindOfficerForUnit(state, selected) ??
                                      (selected.Kind == UnitKind.Officer ? selected : null);
                        if (officer == null ||
                            !state.CompanyPools.TryGetValue(officer.Id, out var co) ||
                            co.Ap < spend.Amount)
                        {
                            disabled = true;
                            reason = "Not enough Company AP";
                        }
                    }
                }

                var label = $"{name} ({spendLabel})";
                var tip = !string.IsNullOrEmpty(reason) ? reason : (def?.description ?? name);
                GUI.enabled = !disabled;
                if (GUI.Button(Phr(0, y, iw, 24), new GUIContent(label, tip)))
                {
                    if (AbilityAliasMap.RequiresUnitTarget(name))
                        _game.BeginAbilityTarget(name);
                    else
                        _game.TryCastAbility(selected, name, null);
                }
                GUI.enabled = true;
                y += 26f;
            }
            y += 4f;
            return y;
        }

        float DrawPendingCastConfirm(GameState state, UnitToken selected, float y)
            => DrawPendingCastConfirm(state, selected, y, 800f);

        float DrawPendingCastConfirm(GameState state, UnitToken selected, float y, float iw)
        {
            UnitToken target = null;
            if (!string.IsNullOrEmpty(_game.PendingAbilityTargetId) && state.Units != null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Id != _game.PendingAbilityTargetId) continue;
                    target = u;
                    break;
                }
            }

            GUI.color = Color.yellow;
            if (target == null)
            {
                GUI.Label(Phr(0, y, iw, 36),
                    $"Choose target for {_game.PendingAbilityName}",
                    CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += 36;
                if (GUI.Button(Phr(0, y, iw, 24), "Cancel"))
                    _game.CancelPendingPlayAction();
                y += 28;
                return y;
            }

            GUI.Label(Phr(0, y, iw, 40),
                $"Cast {_game.PendingAbilityName}\non {target.CardName}?",
                CommandWarfare.UI.MenuStyle.Body);
            GUI.color = Color.white;
            y += 40;
            if (GUI.Button(Phr(0, y, iw * 0.48f, 24), "Confirm"))
                _game.TryConfirmPendingAbility();
            if (GUI.Button(Phr(iw * 0.52f, y, iw * 0.48f, 24), "Cancel"))
                _game.CancelPendingPlayAction();
            y += 28;
            return y;
        }

        float DrawPendingAttackConfirm(GameState state, UnitToken selected, float y)
            => DrawPendingAttackConfirm(state, selected, y, 800f);

        float DrawPendingAttackConfirm(GameState state, UnitToken selected, float y, float iw)
        {
            if (_game.PendingAttackPick && string.IsNullOrEmpty(_game.PendingAttackTargetId))
            {
                GUI.color = Color.yellow;
                GUI.Label(Phr(0, y, iw, 36),
                    "Attack: click an enemy (RMB cancel)",
                    CommandWarfare.UI.MenuStyle.Body);
                GUI.color = Color.white;
                y += 36;
                if (GUI.Button(Phr(0, y, iw, 24), "Cancel"))
                    _game.CancelPendingPlayAction();
                y += 28;
                return y;
            }

            UnitToken target = null;
            if (state.Units != null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Id == _game.PendingAttackTargetId)
                    {
                        target = u;
                        break;
                    }
                }
            }

            GUI.color = Color.yellow;
            GUI.Label(Phr(0, y, iw, 40),
                target != null
                    ? $"Attack {target.CardName}?"
                    : "Confirm attack (target missing)",
                CommandWarfare.UI.MenuStyle.Body);
            GUI.color = Color.white;
            y += 40;

            string summary = null;
            if (selected != null && target != null)
                _game.TryGetAttackPreview(selected, target, out summary);
            if (!string.IsNullOrEmpty(summary))
            {
                var sh = CommandWarfare.UI.MenuStyle.MutedLabel.CalcHeight(new GUIContent(summary), iw);
                GUI.Label(Phr(0, y, iw, sh), summary, CommandWarfare.UI.MenuStyle.MutedLabel);
                y += sh + 4f;
            }

            if (GUI.Button(Phr(0, y, iw * 0.55f, 26), "Confirm Attack"))
                _game.TryConfirmPendingAttack();
            if (GUI.Button(Phr(iw * 0.58f, y, iw * 0.42f, 26), "Cancel"))
                _game.CancelPendingPlayAction();
            y += 30;
            return y;
        }

        static bool CanUndoMove(UnitToken unit)
        {
            if (unit == null || !unit.ActivationCol.HasValue || !unit.ActivationRow.HasValue)
                return false;
            return unit.Col != unit.ActivationCol.Value ||
                   unit.Row != unit.ActivationRow.Value ||
                   unit.MoveRemaining != unit.Move;
        }

        void DrawGraveyard(GameState state, ref float y)
            => DrawGraveyard(state, ref y, 600f);

        void DrawGraveyard(GameState state, ref float y, float iw)
        {
            if (state.Deaths == null || state.Deaths.Count == 0) return;
            var seat = state.ActiveSeat;
            if (!seat.HasValue) return;

            var mine = 0;
            foreach (var d in state.Deaths)
                if (d != null && d.Seat == seat.Value) mine++;
            if (mine == 0) return;

            GUI.Label(Phr(0, y, iw, 20), $"Graveyard ({mine}) — revive at death hex:");
            y += 22;
            var shown = 0;
            foreach (var d in state.Deaths)
            {
                if (d == null || d.Seat != seat.Value) continue;
                if (shown >= 6) break;
                var label = d.CardName.Length > 18 ? d.CardName[..18] : d.CardName;
                if (GUI.Button(Phr(0, y, iw, 22), $"Revive {label}"))
                    _game.TryReviveFromGrave(d.Id);
                y += 24;
                shown++;
            }
        }

        static bool HasFollowup(GameState state, out string note)
        {
            note = null;
            if (state?.Units == null || state.ActiveSeat == null) return false;
            foreach (var u in state.Units)
            {
                if (u.Seat != state.ActiveSeat) continue;
                if (u.FrenzyAttackPending)
                {
                    note = $"Frenzy: {u.CardName} may attack again (or Skip).";
                    return true;
                }
                if (u.HarassMovePending)
                {
                    note = $"Harass: {u.CardName} may Move 1 (or Skip).";
                    return true;
                }
            }
            return false;
        }

        void DrawArmyBuild(GameState state)
        {
            GUI.Label(new Rect(12, 12, 640, 24), "Army Build — pick races, then Force Select (or open full builder)");
            var y = 40f;
            var flow = GetComponent<CommandWarfare.UI.GameFlowController>();
            if (flow != null && GUI.Button(new Rect(12, y, 280, 28), "Open Army Builder"))
            {
                flow.EnterArmyBuilder(CommandWarfare.UI.ArmyBuilderMode.StartSkirmish);
                return;
            }
            y += 34;
            GUI.Label(new Rect(12, y, 200, 20), $"North (you): {state.NorthRace}");
            y += 22;
            DrawRaceRow(SeatId.N, ref y);
            y += 8;
            GUI.Label(new Rect(12, y, 200, 20), $"South (AI): {state.SouthRace}");
            y += 22;
            DrawRaceRow(SeatId.S, ref y);
            y += 12;
            if (GUI.Button(new Rect(12, y, 220, 32), "Force Select [E]"))
                _game.BeginForceSelectFromArmyBuild();
            y += 36;
            if (GUI.Button(new Rect(12, y, 280, 28), "Skip to Deploy (defaults)"))
                _game.BeginDeployFromArmyBuild();
        }

        void DrawDeployQueue(GameState state, SeatId seat, ref float y)
        {
            var queue = OfflineDeploy.QueueFor(state, seat);
            var sel = OfflineDeploy.SelectedIndex(state, seat);
            GUI.Label(new Rect(12, y, 400, 20), $"Queue {seat} ({queue.Count} items)");
            y += 22;
            var x = 12f;
            for (var i = 0; i < queue.Count; i++)
            {
                var item = queue[i];
                if (item == null) continue;
                var label = item.Placed ? $"✓{item.CardName}" : item.CardName;
                if (label.Length > 16) label = label[..16];
                var prev = GUI.color;
                if (i == sel && !item.Placed) GUI.color = Color.yellow;
                else if (item.Placed) GUI.color = Color.gray;
                if (GUI.Button(new Rect(x, y, 120, 22), label) && !item.Placed)
                    _game.SelectDeployQueueItem(seat, i);
                GUI.color = prev;
                x += 124;
                if (x > 700) { x = 12f; y += 26; }
            }
            y += 28;
        }

        void DrawForceSelect(GameState state)
        {
            CommandWarfare.UI.MenuStyle.Ensure();
            var panel = new Rect(12, 12, Mathf.Min(560f, Screen.width * 0.48f), Screen.height - 24f);
            CommandWarfare.UI.MenuStyle.DrawPanel(panel, "Force Select");

            var x = panel.x + 16f;
            var y = panel.y + 40f;
            var innerW = panel.width - 32f;

            GUI.Label(new Rect(x, y, innerW, 54),
                "Assign each company to a battle bucket:\n" +
                "• Deploy — starts on the board this game\n" +
                "• Reserve — off-board reinforcement pool\n" +
                "• Unused — left out of this battle",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 60;

            var scrollH = Mathf.Max(48f, panel.yMax - y - 56f);
            var contentH = EstimateForceSelectHeight(state);
            var scrollRect = new Rect(x, y, innerW, scrollH);

            // Nested MenuStyle dropdowns use their own BeginScrollView; close them on
            // wheel so the outer force-select scroll cannot leave IMGUI unbalanced.
            var e = Event.current;
            if (e != null && e.type == EventType.ScrollWheel && scrollRect.Contains(e.mousePosition))
            {
                foreach (var key in new List<string>(_bucketDropOpen.Keys))
                    _bucketDropOpen[key] = false;
                CommandWarfare.UI.MenuStyle.DismissOpenDropdown();
            }

            _forceScroll = GUI.BeginScrollView(
                scrollRect,
                _forceScroll,
                new Rect(0, 0, Mathf.Max(1f, innerW - 20f), Mathf.Max(contentH, scrollH)));
            try
            {
                var ry = 0f;
                DrawForceSelectSeat(state, SeatId.N, "North (you)", innerW - 20f, ref ry);
                ry += 12f;
                DrawForceSelectSeat(state, SeatId.S, "South (AI)", innerW - 20f, ref ry);
            }
            finally
            {
                GUI.EndScrollView();
            }

            y = panel.yMax - 48f;
            GUI.Label(new Rect(x, y, innerW, 36),
                $"Ready: N={(state.ForceSelectReady.TryGetValue(SeatId.N, out var nr) && nr ? "yes" : "no")}  " +
                $"S={(state.ForceSelectReady.TryGetValue(SeatId.S, out var sr) && sr ? "yes" : "no")} · [E] confirm N\n" +
                (state.LastActionLog ?? ""),
                CommandWarfare.UI.MenuStyle.MutedLabel);
        }

        static float EstimateForceSelectHeight(GameState state)
        {
            var h = 40f;
            foreach (var seat in new[] { SeatId.N, SeatId.S })
            {
                h += 70f;
                if (state.OfflineArmies != null &&
                    state.OfflineArmies.TryGetValue(seat, out var army) &&
                    army?.Companies != null)
                    h += army.Companies.Count * 36f;
            }
            return Mathf.Max(200f, h);
        }

        void DrawForceSelectSeat(GameState state, SeatId seat, string label, float width, ref float y)
        {
            var ready = state.ForceSelectReady.TryGetValue(seat, out var r) && r;
            GUI.Label(new Rect(0, y, width, 22),
                $"{label}{(ready ? " — confirmed" : "")}",
                CommandWarfare.UI.MenuStyle.Body);
            y += 24f;

            if (state.OfflineArmies == null ||
                !state.OfflineArmies.TryGetValue(seat, out var army) ||
                army?.Companies == null)
            {
                GUI.Label(new Rect(0, y, width, 20), "(no army)", CommandWarfare.UI.MenuStyle.MutedLabel);
                y += 24f;
                return;
            }

            Dictionary<string, BattleBucket> loadout = null;
            if (state.BattleLoadouts != null)
                state.BattleLoadouts.TryGetValue(seat, out loadout);
            loadout ??= new Dictionary<string, BattleBucket>();
            var totals = BattleLoadoutUtil.Totals(army, loadout);
            var pools = state.LoadoutPools;
            var deployMax = pools.DeployMax;
            var reserveMax = pools.ReserveMax;
            GUI.Label(new Rect(0, y, width, 20),
                $"UV  Deploy {totals.Deploy}/{deployMax} · " +
                $"Reserve {totals.Reserve}/{reserveMax} · Unused {totals.Unused}",
                CommandWarfare.UI.MenuStyle.MutedLabel);
            y += 24f;

            foreach (var co in army.Companies)
            {
                if (co?.OfficerId == null) continue;
                var bucket = loadout.TryGetValue(co.OfficerId, out var b) ? b : BattleBucket.Unused;
                var nameW = Mathf.Max(120f, width - 150f);
                GUI.Label(new Rect(0, y, nameW, 28),
                    $"{co.OfficerName}  ({co.Uv} UV)",
                    CommandWarfare.UI.MenuStyle.Body);

                if (!ready)
                {
                    var dropKey = seat + ":" + co.OfficerId;
                    if (!_bucketDropOpen.ContainsKey(dropKey))
                        _bucketDropOpen[dropKey] = false;
                    var open = _bucketDropOpen[dropKey];
                    var ix = bucket switch
                    {
                        BattleBucket.Deploy => 0,
                        BattleBucket.Reserve => 1,
                        _ => 2,
                    };
                    if (CommandWarfare.UI.MenuStyle.Dropdown(
                            new Rect(nameW + 4f, y, 140f, 28f), BucketOptions, ref ix, ref open))
                    {
                        var next = ix switch
                        {
                            0 => BattleBucket.Deploy,
                            1 => BattleBucket.Reserve,
                            _ => BattleBucket.Unused,
                        };
                        _game.SetForceSelectBucket(seat, co.OfficerId, next);
                        foreach (var key in new List<string>(_bucketDropOpen.Keys))
                            _bucketDropOpen[key] = false;
                    }
                    else
                    {
                        if (open)
                        {
                            foreach (var key in new List<string>(_bucketDropOpen.Keys))
                                if (key != dropKey) _bucketDropOpen[key] = false;
                        }
                        _bucketDropOpen[dropKey] = open;
                    }
                    if (open) y += Mathf.Min(3 * 26f + 8f, 90f);
                }
                else
                {
                    GUI.Label(new Rect(nameW + 4f, y, 140f, 28f), bucket.ToString(),
                        CommandWarfare.UI.MenuStyle.MutedLabel);
                }
                y += 34f;
            }

            if (!ready && CommandWarfare.UI.MenuStyle.PrimaryBtn(new Rect(0, y, 200f, 32f), $"Confirm {seat}"))
                _game.ConfirmForceSelect(seat);
            y += 40f;
        }

        void DrawTerrain(GameState state)
        {
            if (OfflineTerrain.IsLandStage(state.TerrainStage))
            {
                DrawLandStage(state);
                return;
            }

            GUI.Label(new Rect(12, 12, 900, 24),
                "Terrain placement — pick Flood or Pieces for your CR, place land, then confirm · [E] confirm N");
            var y = 40f;
            DrawTerrainSeat(state, SeatId.N, "North (you)", ref y);
            y += 8;
            DrawTerrainSeat(state, SeatId.S, "South (AI)", ref y);
            y += 8;
            GUI.Label(new Rect(12, y, 720, 20),
                $"Ready: N={(OfflineTerrain.IsSeatReady(state, SeatId.N) ? "yes" : "no")}  " +
                $"S={(OfflineTerrain.IsSeatReady(state, SeatId.S) ? "yes" : "no")}");
            if (!string.IsNullOrEmpty(state.LastActionLog))
            {
                y += 22;
                GUI.Label(new Rect(12, y, 800, 20), state.LastActionLog);
            }
        }

        void DrawTerrainSeat(GameState state, SeatId seat, string label, ref float y)
        {
            var ready = OfflineTerrain.IsSeatReady(state, seat);
            var mode = OfflineTerrain.ModeFor(state, seat);
            var flooded = state.CommandZoneFlooded.TryGetValue(seat, out var f) && f;
            var race = OfflineTerrain.RaceForSeat(state, seat);
            var favored = OfflineTerrain.FavoredFloodKind(race);
            GUI.Label(new Rect(12, y, 640, 20),
                $"{label}{(ready ? " — confirmed" : mode != null ? $" — {mode}" : "")} · {race}");
            y += 22;
            if (ready) return;

            if (mode == null)
            {
                if (GUI.Button(new Rect(12, y, 120, 26), "Flood mode"))
                    _game.ChooseCommandZoneMode(seat, "flood");
                if (GUI.Button(new Rect(140, y, 140, 26), "Pieces mode"))
                    _game.ChooseCommandZoneMode(seat, "pieces");
                y += 32;
                return;
            }

            if (mode == "flood")
            {
                if (!flooded)
                {
                    if (GUI.Button(new Rect(12, y, 200, 26), $"Flood CR ({favored})"))
                        _game.FloodCommandZone(seat, favored);
                    y += 30;
                    var x = 12f;
                    foreach (var kind in TerrainPlacement.FloodTerrainKinds)
                    {
                        if (kind == TerrainKind.Water) continue;
                        if (GUI.Button(new Rect(x, y, 72, 22), kind.ToString()))
                            _game.FloodCommandZone(seat, kind);
                        x += 76;
                        if (x > 500) { x = 12f; y += 26; }
                    }
                    y += 28;
                }
            }
            else if (mode == "pieces" && seat == SeatId.N)
            {
                DrawCrPiecesPicker(state, seat, ref y);
            }

            if (OfflineTerrain.IsCommandZoneComplete(state, seat) &&
                GUI.Button(new Rect(12, y, 180, 28), $"Confirm {seat}"))
                _game.ConfirmTerrain(seat);
            y += 34;
        }

        void DrawCrPiecesPicker(GameState state, SeatId seat, ref float y)
        {
            var quota = CommandZonePieceQuota.ForMaxPlayers(state.MaxPlayers);
            GUI.Label(new Rect(12, y, 700, 20),
                $"CR pieces quota: {quota.Large}L + {quota.Medium}M + {quota.Small}S · pick, click hex · Rotate / Skip held");
            y += 22;
            if (GUI.Button(new Rect(12, y, 80, 22), "Rotate"))
                _game.RotateLandPiece();
            if (GUI.Button(new Rect(100, y, 100, 22), "Skip held"))
                _game.SkipCrHeldPiece(seat);
            y += 26;

            var catalog = TerrainPieceCatalog.CommandZoneCatalog(state.MaxPlayers);
            var x = 12f;
            var shown = 0;
            foreach (var p in catalog)
            {
                if (p == null || shown >= 12) break;
                var pieceLabel = p.name.Length > 12 ? p.name[..12] : p.name;
                if (GUI.Button(new Rect(x, y, 100, 22), $"{pieceLabel}"))
                    _game.PickCrPiece(seat, p.id);
                x += 104;
                if (x > 700) { x = 12f; y += 26; }
                shown++;
            }
            y += 28;
            var hand = OfflineTerrain.HandFor(state, seat);
            GUI.Label(new Rect(12, y, 700, 20),
                $"Hand: {hand.Count} · pending idx={(state.PendingCrHandIndex.TryGetValue(seat, out var pi) ? pi : -1)}");
            y += 22;
        }

        void DrawLandStage(GameState state)
        {
            var size = OfflineTerrain.SizeForStage(state.TerrainStage) ?? "?";
            var active = state.ActiveSeat?.ToString() ?? "?";
            GUI.Label(new Rect(12, 12, 800, 24),
                $"Land {state.TerrainStage} ({size}) — active {active} · pick piece, click hex · [E] skip");
            var y = 40f;
            var nUsed = state.LandDropsUsed.TryGetValue(SeatId.N, out var nu) ? nu : 0;
            var sUsed = state.LandDropsUsed.TryGetValue(SeatId.S, out var su) ? su : 0;
            GUI.Label(new Rect(12, y, 640, 20),
                $"Drops N {nUsed}/{TerrainPieceCatalog.LandDropsPerSize} · S {sUsed}/{TerrainPieceCatalog.LandDropsPerSize} · rot {state.PendingLandRotation}");
            y += 24;

            if (GUI.Button(new Rect(12, y, 100, 24), "Rotate"))
                _game.RotateLandPiece();
            if (GUI.Button(new Rect(120, y, 120, 24), $"Skip {active}"))
                _game.SkipLandDrop(state.ActiveSeat ?? SeatId.N);
            y += 30;

            var pieces = TerrainPieceCatalog.ForSize(size);
            var x = 12f;
            var shown = 0;
            foreach (var p in pieces)
            {
                if (p == null || (p.kind == "water" && size != "small")) continue;
                if (shown >= 10) break;
                var pieceLabel = p.name.Length > 14 ? p.name[..14] : p.name;
                var selected = state.PendingLandPieceId == p.id;
                var prev = GUI.color;
                if (selected) GUI.color = Color.yellow;
                if (GUI.Button(new Rect(x, y, 110, 22), pieceLabel))
                    _game.SelectLandPiece(p.id);
                GUI.color = prev;
                x += 114;
                if (x > 700) { x = 12f; y += 26; }
                shown++;
            }
            y += 30;
            if (!string.IsNullOrEmpty(state.PendingLandPieceId))
                GUI.Label(new Rect(12, y, 600, 20), $"Selected: {state.PendingLandPieceId} — click board to place");
            if (!string.IsNullOrEmpty(state.LastActionLog))
            {
                y += 22;
                GUI.Label(new Rect(12, y, 800, 20), state.LastActionLog);
            }
        }

        void DrawRaceRow(SeatId seat, ref float y)
        {
            var x = 12f;
            foreach (var race in GameSessionFactory.PlayableRaces)
            {
                if (x > 700)
                {
                    x = 12f;
                    y += 28;
                }
                if (GUI.Button(new Rect(x, y, 88, 24), race))
                    _game.SetArmyRace(seat, race);
                x += 92;
            }
            y += 28;
        }
    }
}
