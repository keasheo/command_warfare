using System.Collections;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>
    /// Prototype-parity AI driver: one scored action per think tick until endTurn
    /// (play/server/aiBot.ts scheduleAiThink loop).
    /// </summary>
    [RequireComponent(typeof(BoardGameController))]
    public class SkirmishAi : MonoBehaviour
    {
        [SerializeField] SeatId _aiSeat = SeatId.S;
        [SerializeField] AiDifficulty _difficulty = AiDifficulty.Medium;
        [SerializeField] bool _enabled = true;

        BoardGameController _game;
        Coroutine _running;
        SeededRng _rng;

        void Awake()
        {
            EnsureReady();
        }

        void OnEnable()
        {
            EnsureReady();
            if (_game != null)
                _game.TurnChanged += OnTurnChanged;
        }

        void OnDisable()
        {
            if (_game != null)
                _game.TurnChanged -= OnTurnChanged;
        }

        void EnsureReady()
        {
            if (_game == null)
                _game = GetComponent<BoardGameController>();
            if (_rng == null)
                _rng = new SeededRng(SeededRng.SeedFromRoomCode("ai", _aiSeat.ToString()));
        }

        void OnTurnChanged()
        {
            EnsureReady();
            if (!_enabled || _game == null || _game.State == null || _game.State.Phase == Phase.Ended) return;
            if (_game.State.Phase == Phase.ArmyBuild) return;
            if (_game.State.Phase == Phase.ForceSelect)
            {
                if (_game.State.ForceSelectReady.TryGetValue(_aiSeat, out var ready) && ready) return;
                if (_running != null) StopCoroutine(_running);
                _running = StartCoroutine(ConfirmForceSelectAi());
                return;
            }
            if (_game.State.Phase == Phase.Terrain)
            {
                if (OfflineTerrain.IsLandStage(_game.State.TerrainStage))
                {
                    if (_game.State.ActiveSeat != _aiSeat) return;
                    if (_running != null) StopCoroutine(_running);
                    _running = StartCoroutine(SkipLandAi());
                    return;
                }
                if (OfflineTerrain.IsSeatReady(_game.State, _aiSeat)) return;
                if (_running != null) StopCoroutine(_running);
                _running = StartCoroutine(ConfirmTerrainAi());
                return;
            }
            if (_game.State.Phase == Phase.Deploy)
            {
                if (OfflineDeploy.IsSeatReady(_game.State, _aiSeat)) return;
                if (_running != null) StopCoroutine(_running);
                _running = StartCoroutine(ConfirmDeployAi());
                return;
            }
            if (_game.State.ActiveSeat != _aiSeat) return;
            if (_running != null) StopCoroutine(_running);
            _running = StartCoroutine(RunTurn());
        }

        float ThinkDelay()
        {
            EnsureReady();
            var p = AiDifficultyPolicy.For(_difficulty);
            return p.ThinkDelayMin + _rng.NextFloat() * (p.ThinkDelayMax - p.ThinkDelayMin);
        }

        IEnumerator ConfirmForceSelectAi()
        {
            yield return new WaitForSeconds(ThinkDelay() * 0.5f);
            if (_game.State?.Phase != Phase.ForceSelect) yield break;
            _game.ConfirmForceSelect(_aiSeat);
            _running = null;
        }

        IEnumerator ConfirmTerrainAi()
        {
            yield return new WaitForSeconds(ThinkDelay() * 0.5f);
            if (_game.State?.Phase != Phase.Terrain || _game.State.TerrainStage != "commandZone")
                yield break;
            if (OfflineTerrain.ModeFor(_game.State, _aiSeat) == null)
                _game.ChooseCommandZoneMode(_aiSeat, "flood");
            if (!_game.State.CommandZoneFlooded.TryGetValue(_aiSeat, out var flooded) || !flooded)
            {
                var race = OfflineTerrain.RaceForSeat(_game.State, _aiSeat);
                _game.FloodCommandZone(_aiSeat, OfflineTerrain.FavoredFloodKind(race));
                yield return new WaitForSeconds(ThinkDelay() * 0.3f);
            }
            if (_game.State?.Phase != Phase.Terrain || _game.State.TerrainStage != "commandZone")
                yield break;
            _game.ConfirmTerrain(_aiSeat);
            _running = null;
        }

        IEnumerator SkipLandAi()
        {
            yield return new WaitForSeconds(ThinkDelay() * 0.25f);
            while (_game.State?.Phase == Phase.Terrain &&
                   OfflineTerrain.IsLandStage(_game.State.TerrainStage) &&
                   _game.State.ActiveSeat == _aiSeat)
            {
                _game.SkipLandDrop(_aiSeat);
                yield return new WaitForSeconds(ThinkDelay() * 0.2f);
            }
            _running = null;
        }

        IEnumerator ConfirmDeployAi()
        {
            yield return new WaitForSeconds(ThinkDelay() * 0.6f);
            if (_game.State?.Phase != Phase.Deploy) yield break;
            _game.AutoPlaceDeploy(_aiSeat);
            yield return new WaitForSeconds(ThinkDelay() * 0.25f);
            if (_game.State?.Phase != Phase.Deploy) yield break;
            _game.ConfirmDeploy(_aiSeat);
            _running = null;
        }

        IEnumerator RunTurn()
        {
            // Prototype: keep choosing scored actions until endTurn (or seat changes).
            const int maxActions = 28;
            for (var i = 0; i < maxActions; i++)
            {
                if (_game.State?.Phase != Phase.Play || _game.State.ActiveSeat != _aiSeat)
                    break;

                yield return new WaitForSeconds(ThinkDelay());

                if (_game.State?.Phase != Phase.Play || _game.State.ActiveSeat != _aiSeat)
                    break;

                if (_game.State.PendingCleave != null)
                {
                    _game.ConfirmCleave();
                    yield return new WaitForSeconds(ThinkDelay() * 0.35f);
                    continue;
                }

                if (_game.State.PendingTrample != null)
                {
                    var pending = _game.State.PendingTrample;
                    var trampler = _game.State.Units.Find(u => u.Id == pending.AttackerId);
                    if (trampler != null && trampler.Seat == _aiSeat)
                        _game.ExecuteSkirmishAction(SkirmishAction.ContinueTrample());
                    else
                        _game.TryDeclineTrample();
                    yield return new WaitForSeconds(ThinkDelay() * 0.35f);
                    continue;
                }

                var action = SkirmishAiPlanner.PlanTurn(
                    _game.State, _aiSeat, _difficulty, _game.Cards, _rng);

                if (action.Kind == SkirmishActionKind.EndTurn)
                {
                    _game.ExecuteSkirmishAction(action);
                    break;
                }

                _game.ExecuteSkirmishAction(action);

                if (_game.State.ActiveSeat != _aiSeat || _game.State.Phase != Phase.Play)
                    break;
            }

            _running = null;
        }
    }
}
