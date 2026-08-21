using System.Collections;
using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>Smooth hex-to-hex move with facing + optional animator hooks.</summary>
    public class UnitTokenMover : MonoBehaviour
    {
        UnitTokenView _view;
        Coroutine _move;

        void Awake() => _view = GetComponent<UnitTokenView>();

        public bool IsMoving => _move != null;

        public void SnapTo(Vector3 worldPos)
        {
            if (_move != null)
            {
                StopCoroutine(_move);
                _move = null;
                _view?.StopMove();
            }
            transform.position = worldPos;
        }

        public void MoveTo(Vector3 worldPos, float duration = 0.28f)
        {
            if (!Application.isPlaying)
            {
                transform.position = worldPos;
                return;
            }
            if (_move != null) StopCoroutine(_move);
            _move = StartCoroutine(MoveRoutine(worldPos, duration));
        }

        IEnumerator MoveRoutine(Vector3 dest, float duration)
        {
            var start = transform.position;
            var dir = dest - start;
            dir.y = 0f;
            if (dir.sqrMagnitude > 0.001f)
                transform.rotation = Quaternion.LookRotation(dir.normalized, Vector3.up);

            _view?.PlayMove();
            BattleAudio.PlayWalk();

            var t = 0f;
            duration = Mathf.Max(0.05f, duration);
            while (t < duration)
            {
                t += Time.deltaTime;
                var u = Mathf.SmoothStep(0f, 1f, t / duration);
                transform.position = Vector3.Lerp(start, dest, u);
                yield return null;
            }
            transform.position = dest;
            _view?.StopMove();
            _move = null;
        }
    }
}
