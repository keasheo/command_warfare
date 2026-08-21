using System.Collections;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Runs greedy AI on the configured seat after a short delay.</summary>
    [RequireComponent(typeof(BoardGameController))]
    public class SkirmishAi : MonoBehaviour
    {
        [SerializeField] SeatId _aiSeat = SeatId.S;
        [SerializeField] float _thinkDelay = 0.65f;
        [SerializeField] bool _enabled = true;

        BoardGameController _game;
        Coroutine _running;

        void Awake() => _game = GetComponent<BoardGameController>();

        void OnEnable() => _game.TurnChanged += OnTurnChanged;
        void OnDisable() => _game.TurnChanged -= OnTurnChanged;

        void OnTurnChanged()
        {
            if (!_enabled || _game.State?.Phase == Phase.Ended) return;
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
            if (_game.State.PendingCleave != null) return;
            if (_game.State.PendingTrample != null)
            {
                if (_game.State.ActiveSeat != _aiSeat) return;
                if (_running != null) StopCoroutine(_running);
                _running = StartCoroutine(ContinueTrampleAi());
                return;
            }
            if (_game.State.ActiveSeat != _aiSeat) return;
            if (_running != null) StopCoroutine(_running);
            _running = StartCoroutine(RunTurn());
        }

        IEnumerator ConfirmForceSelectAi()
        {
            yield return new WaitForSeconds(_thinkDelay * 0.4f);
            if (_game.State?.Phase != Phase.ForceSelect) yield break;
            _game.ConfirmForceSelect(_aiSeat);
            _running = null;
        }

        IEnumerator ConfirmTerrainAi()
        {
            yield return new WaitForSeconds(_thinkDelay * 0.4f);
            if (_game.State?.Phase != Phase.Terrain || _game.State.TerrainStage != "commandZone")
                yield break;
            if (OfflineTerrain.ModeFor(_game.State, _aiSeat) == null)
                _game.ChooseCommandZoneMode(_aiSeat, "flood");
            if (!_game.State.CommandZoneFlooded.TryGetValue(_aiSeat, out var flooded) || !flooded)
            {
                var race = OfflineTerrain.RaceForSeat(_game.State, _aiSeat);
                _game.FloodCommandZone(_aiSeat, OfflineTerrain.FavoredFloodKind(race));
                yield return new WaitForSeconds(_thinkDelay * 0.25f);
            }
            if (_game.State?.Phase != Phase.Terrain || _game.State.TerrainStage != "commandZone")
                yield break;
            _game.ConfirmTerrain(_aiSeat);
            _running = null;
        }

        IEnumerator SkipLandAi()
        {
            yield return new WaitForSeconds(_thinkDelay * 0.2f);
            while (_game.State?.Phase == Phase.Terrain &&
                   OfflineTerrain.IsLandStage(_game.State.TerrainStage) &&
                   _game.State.ActiveSeat == _aiSeat)
            {
                _game.SkipLandDrop(_aiSeat);
                yield return new WaitForSeconds(_thinkDelay * 0.15f);
            }
            _running = null;
        }

        IEnumerator ConfirmDeployAi()
        {
            yield return new WaitForSeconds(_thinkDelay * 0.5f);
            if (_game.State?.Phase != Phase.Deploy) yield break;
            _game.AutoPlaceDeploy(_aiSeat);
            yield return new WaitForSeconds(_thinkDelay * 0.2f);
            if (_game.State?.Phase != Phase.Deploy) yield break;
            _game.ConfirmDeploy(_aiSeat);
            _running = null;
        }

        IEnumerator ContinueTrampleAi()
        {
            yield return new WaitForSeconds(_thinkDelay * 0.35f);
            if (_game.State?.PendingTrample == null) yield break;
            _game.TryContinueTrample();
            _running = null;
        }

        IEnumerator RunTurn()
        {
            yield return new WaitForSeconds(_thinkDelay);
            if (_game.State?.Phase == Phase.Ended || _game.State?.Phase == Phase.Deploy) yield break;
            if (_game.State.ActiveSeat != _aiSeat) yield break;

            _game.EnsureCompanyActivatedForSeat(_aiSeat);

            const int maxSteps = 4;
            for (var step = 0; step < maxSteps; step++)
            {
                if (_game.State.ActiveSeat != _aiSeat || _game.State.Phase != Phase.Play)
                    break;

                if (_game.State.PendingCleave != null)
                {
                    _game.ConfirmCleave();
                    break;
                }

                if (_game.State.PendingTrample != null)
                {
                    _game.TryContinueTrample();
                    yield return new WaitForSeconds(_thinkDelay * 0.25f);
                    continue;
                }

                var action = SkirmishAiPlanner.PlanTurn(_game.State, _aiSeat);
                if (action.Kind == SkirmishActionKind.EndTurn)
                {
                    if (HasFollowup(_game.State, _aiSeat))
                        _game.EndTurn();
                    break;
                }

                _game.ExecuteSkirmishAction(action);

                if (_game.State.ActiveSeat != _aiSeat)
                    break;

                if (!HasFollowup(_game.State, _aiSeat) && _game.State.PendingTrample == null)
                    break;

                yield return new WaitForSeconds(_thinkDelay * 0.35f);
            }

            _running = null;
        }

        static bool HasFollowup(GameState state, SeatId seat)
        {
            if (state?.Units == null) return false;
            foreach (var u in state.Units)
            {
                if (u.Seat != seat) continue;
                if (u.FrenzyAttackPending || u.HarassMovePending) return true;
            }
            return false;
        }
    }
}
